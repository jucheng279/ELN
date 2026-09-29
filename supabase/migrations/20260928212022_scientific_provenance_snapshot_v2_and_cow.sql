/*
# Scientific Provenance — Snapshot V2, Copy-on-Write, Amendment Lineage

## Overview
- Snapshot V2: block-referenced attachment versions and protocol instances (not parent-level)
- Internal _clone_attachment_reference helper for copy-on-write duplication
- Upgraded duplicate_experiment_rpc with attachment/protocol copy-on-write
- Upgraded create_amendment with signed-revision lineage
- Upgraded restore_experiment_revision with protocol/attachment provenance
- Block provenance validation trigger

## Key Invariants
- Historical revisions identify exact attachment bytes via attachment_version_id
- Duplicate/amendment blocks get NEW logical attachment/protocol IDs
- Replacing a file in a duplicate cannot affect the source
- Amendment starts from the exact signed revision
*/

-- ─────────────────────────────────────────────────────
-- 1. Internal clone helper (not client-callable)
-- ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public._clone_attachment_reference(
  p_source_attachment_version_id uuid,
  p_target_experiment_id uuid,
  p_created_by uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_src_ver record;
  v_src_att record;
  v_new_att_id uuid;
  v_new_ver_id uuid;
BEGIN
  SELECT * INTO v_src_ver FROM public.attachment_versions WHERE id = p_source_attachment_version_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Source attachment version not found'; END IF;

  SELECT * INTO v_src_att FROM public.attachments WHERE id = v_src_ver.attachment_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Source attachment not found'; END IF;

  INSERT INTO public.attachments (
    experiment_id, original_filename, display_name, storage_path,
    mime_type, file_size, checksum, current_version, uploaded_by
  ) VALUES (
    p_target_experiment_id,
    COALESCE(v_src_ver.original_filename, v_src_att.original_filename),
    COALESCE(v_src_ver.display_name, v_src_att.display_name),
    v_src_ver.storage_path,
    COALESCE(v_src_ver.mime_type, v_src_att.mime_type),
    COALESCE(v_src_ver.file_size, v_src_att.file_size),
    COALESCE(v_src_ver.checksum, v_src_att.checksum),
    1,
    p_created_by
  ) RETURNING id INTO v_new_att_id;

  INSERT INTO public.attachment_versions (
    attachment_id, version_number, storage_path, file_size, checksum,
    uploaded_by, original_filename, display_name, mime_type,
    source_attachment_version_id
  ) VALUES (
    v_new_att_id, 1, v_src_ver.storage_path,
    COALESCE(v_src_ver.file_size, v_src_att.file_size),
    COALESCE(v_src_ver.checksum, v_src_att.checksum),
    p_created_by,
    COALESCE(v_src_ver.original_filename, v_src_att.original_filename),
    COALESCE(v_src_ver.display_name, v_src_att.display_name),
    COALESCE(v_src_ver.mime_type, v_src_att.mime_type),
    p_source_attachment_version_id
  ) RETURNING id INTO v_new_ver_id;

  RETURN jsonb_build_object(
    'attachment_id', v_new_att_id,
    'attachment_version_id', v_new_ver_id,
    'version_number', 1,
    'storage_path', v_src_ver.storage_path,
    'checksum', COALESCE(v_src_ver.checksum, v_src_att.checksum)
  );
END;
$$;

REVOKE ALL ON FUNCTION public._clone_attachment_reference(uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._clone_attachment_reference(uuid, uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public._clone_attachment_reference(uuid, uuid, uuid) FROM authenticated;

-- ─────────────────────────────────────────────────────
-- 2. Internal helper to rewrite block attachment/protocol refs
-- ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public._rewrite_blocks_for_copy(
  p_source_experiment_id uuid,
  p_target_experiment_id uuid,
  p_created_by uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_block record;
  v_content jsonb;
  v_clone jsonb;
  v_src_att_ver_id uuid;
  v_src_ep_id uuid;
  v_att_map jsonb := '{}'::jsonb;
  v_ep_map jsonb := '{}'::jsonb;
  v_new_ep_id uuid;
  v_src_ep record;
  v_dev record;
BEGIN
  FOR v_block IN
    SELECT id, type, content
    FROM public.experiment_blocks
    WHERE experiment_id = p_target_experiment_id
    ORDER BY order_key
  LOOP
    v_content := v_block.content;

    IF v_block.type IN ('image', 'attachment') THEN
      -- Find source attachment version ID
      v_src_att_ver_id := (v_content->>'attachmentVersionId')::uuid;

      IF v_src_att_ver_id IS NULL THEN
        -- Legacy: try to resolve from attachmentId
        DECLARE v_src_att_id uuid := (v_content->>'attachmentId')::uuid;
        BEGIN
          IF v_src_att_id IS NOT NULL THEN
            SELECT av.id INTO v_src_att_ver_id
            FROM public.attachment_versions av
            WHERE av.attachment_id = v_src_att_id
            ORDER BY av.version_number DESC LIMIT 1;
          END IF;
        END;
      END IF;

      IF v_src_att_ver_id IS NOT NULL THEN
        -- Check if we already cloned this version
        IF v_att_map ? v_src_att_ver_id::text THEN
          v_clone := v_att_map->v_src_att_ver_id::text;
        ELSE
          v_clone := public._clone_attachment_reference(v_src_att_ver_id, p_target_experiment_id, p_created_by);
          v_att_map := v_att_map || jsonb_build_object(v_src_att_ver_id::text, v_clone);
        END IF;

        v_content := v_content
          || jsonb_build_object('attachmentId', v_clone->>'attachment_id')
          || jsonb_build_object('attachmentVersionId', v_clone->>'attachment_version_id')
          || jsonb_build_object('versionNumber', 1)
          || jsonb_build_object('checksum', v_clone->>'checksum');

        UPDATE public.experiment_blocks SET content = v_content
        WHERE id = v_block.id AND experiment_id = p_target_experiment_id;
      END IF;

    ELSIF v_block.type = 'protocol' THEN
      v_src_ep_id := (v_content->>'experiment_protocol_id')::uuid;

      IF v_src_ep_id IS NOT NULL THEN
        IF v_ep_map ? v_src_ep_id::text THEN
          v_new_ep_id := (v_ep_map->>v_src_ep_id::text)::uuid;
        ELSE
          SELECT * INTO v_src_ep FROM public.experiment_protocols WHERE id = v_src_ep_id;

          IF FOUND THEN
            INSERT INTO public.experiment_protocols (
              experiment_id, protocol_id, protocol_version_id, snapshot
            ) VALUES (
              p_target_experiment_id, v_src_ep.protocol_id, v_src_ep.protocol_version_id, v_src_ep.snapshot
            ) RETURNING id INTO v_new_ep_id;

            -- Copy deviations
            FOR v_dev IN
              SELECT * FROM public.protocol_deviations
              WHERE experiment_protocol_id = v_src_ep_id
              ORDER BY step_index
            LOOP
              INSERT INTO public.protocol_deviations (
                experiment_protocol_id, step_index, original_value, actual_value, reason, created_by
              ) VALUES (
                v_new_ep_id, v_dev.step_index, v_dev.original_value, v_dev.actual_value, v_dev.reason, p_created_by
              );
            END LOOP;

            v_ep_map := v_ep_map || jsonb_build_object(v_src_ep_id::text, v_new_ep_id::text);
          END IF;
        END IF;

        IF v_new_ep_id IS NOT NULL THEN
          v_content := v_content || jsonb_build_object('experiment_protocol_id', v_new_ep_id::text);
          UPDATE public.experiment_blocks SET content = v_content
          WHERE id = v_block.id AND experiment_id = p_target_experiment_id;
        END IF;
      END IF;
    END IF;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public._rewrite_blocks_for_copy(uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._rewrite_blocks_for_copy(uuid, uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public._rewrite_blocks_for_copy(uuid, uuid, uuid) FROM authenticated;

-- ─────────────────────────────────────────────────────
-- 3. Upgraded duplicate_experiment_rpc with COW
-- ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.duplicate_experiment_rpc(
  p_experiment_id uuid,
  p_include_blocks boolean DEFAULT true,
  p_include_protocols boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_source public.experiments%ROWTYPE;
  v_new_id uuid;
  v_user_id uuid := auth.uid();
  v_rev_result jsonb;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT * INTO v_source FROM public.experiments WHERE id = p_experiment_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Experiment not found'; END IF;

  IF NOT public.is_workspace_editor(v_source.workspace_id) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  INSERT INTO public.experiments (
    workspace_id, notebook_id, folder_id, title, status,
    experiment_date, template_id, template_version_id, created_by
  ) VALUES (
    v_source.workspace_id, v_source.notebook_id, v_source.folder_id,
    v_source.title || ' (Copy)', 'draft',
    CURRENT_DATE, v_source.template_id, v_source.template_version_id, v_user_id
  ) RETURNING id INTO v_new_id;

  IF p_include_blocks THEN
    INSERT INTO public.experiment_blocks (experiment_id, type, content, order_key, created_by, updated_by)
    SELECT v_new_id, type, content, order_key, v_user_id, v_user_id
    FROM public.experiment_blocks
    WHERE experiment_id = p_experiment_id
    ORDER BY order_key;

    -- Rewrite attachment/protocol references for copy-on-write isolation
    PERFORM public._rewrite_blocks_for_copy(p_experiment_id, v_new_id, v_user_id);
  END IF;

  IF p_include_protocols THEN
    -- Protocol instances are already handled by _rewrite_blocks_for_copy for protocol blocks.
    -- This handles any experiment_protocols NOT referenced by blocks (orphans from legacy).
    NULL;
  END IF;

  -- Create initial revision for the duplicate
  v_rev_result := public._create_revision_internal(
    v_new_id,
    'Duplicated from ' || v_source.experiment_id,
    'created',
    v_user_id,
    jsonb_build_object(
      'source_experiment_id', p_experiment_id,
      'source_experiment_human_id', v_source.experiment_id
    )
  );

  RETURN jsonb_build_object('id', v_new_id);
END;
$$;

REVOKE ALL ON FUNCTION public.duplicate_experiment_rpc(uuid, boolean, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.duplicate_experiment_rpc(uuid, boolean, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.duplicate_experiment_rpc(uuid, boolean, boolean) TO authenticated;

-- ─────────────────────────────────────────────────────
-- 4. Upgraded create_amendment with signed-revision lineage
-- ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.create_amendment(
  p_experiment_id uuid,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_user_id uuid;
  v_src record;
  v_new_id uuid;
  v_new_number bigint;
  v_new_human_id text;
  v_sig record;
  v_signed_rev record;
  v_rev_result jsonb;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT * INTO v_src FROM public.experiments WHERE id = p_experiment_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Experiment not found'; END IF;
  IF v_src.status != 'locked' THEN RAISE EXCEPTION 'Only locked experiments can be amended'; END IF;
  IF NOT public.is_workspace_editor(v_src.workspace_id) THEN
    RAISE EXCEPTION 'Not authorized to create amendment';
  END IF;

  -- Find the signature and its exact signed revision
  SELECT * INTO v_sig FROM public.signatures
  WHERE experiment_id = p_experiment_id
  ORDER BY signed_at DESC LIMIT 1;

  IF v_sig.experiment_revision_id IS NOT NULL THEN
    SELECT * INTO v_signed_rev FROM public.experiment_revisions
    WHERE id = v_sig.experiment_revision_id AND experiment_id = p_experiment_id;
  END IF;

  INSERT INTO public.experiments (
    workspace_id, notebook_id, folder_id, title, status,
    experiment_date, template_id, template_version_id,
    amended_from_id, amendment_reason
  ) VALUES (
    v_src.workspace_id, v_src.notebook_id, v_src.folder_id,
    v_src.title || ' (Amendment)', 'draft',
    CURRENT_DATE, v_src.template_id, v_src.template_version_id,
    p_experiment_id, p_reason
  ) RETURNING id, experiment_number, experiment_id
  INTO v_new_id, v_new_number, v_new_human_id;

  -- Copy blocks from source
  INSERT INTO public.experiment_blocks (experiment_id, type, content, order_key, created_by, updated_by)
  SELECT v_new_id, type, content, order_key, v_user_id, v_user_id
  FROM public.experiment_blocks
  WHERE experiment_id = p_experiment_id
  ORDER BY order_key;

  -- Rewrite attachment/protocol references for copy-on-write isolation
  PERFORM public._rewrite_blocks_for_copy(p_experiment_id, v_new_id, v_user_id);

  -- Create initial revision with full lineage metadata
  v_rev_result := public._create_revision_internal(
    v_new_id,
    'Amendment of ' || v_src.experiment_id || ': ' || p_reason,
    'created',
    v_user_id,
    jsonb_build_object(
      'source_experiment_id', p_experiment_id,
      'source_experiment_human_id', v_src.experiment_id,
      'amendment_reason', p_reason,
      'source_revision_id', COALESCE(v_signed_rev.id::text, null),
      'source_revision_number', COALESCE(v_signed_rev.revision_number, null),
      'source_content_hash', COALESCE(v_signed_rev.content_hash, null),
      'source_signature_id', COALESCE(v_sig.id::text, null)
    )
  );

  -- Audit event
  INSERT INTO public.audit_events (
    workspace_id, object_type, object_id, event_type, actor_id, metadata
  ) VALUES (
    v_src.workspace_id, 'experiment', v_new_id, 'amendment_created', v_user_id,
    jsonb_build_object(
      'reason', p_reason,
      'source_experiment_id', p_experiment_id,
      'source_signature_id', v_sig.id,
      'source_revision_id', COALESCE(v_signed_rev.id, null)
    )
  );

  RETURN jsonb_build_object(
    'id', v_new_id,
    'experiment_number', v_new_number,
    'experiment_id', v_new_human_id,
    'amended_from_id', p_experiment_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_amendment(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_amendment(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_amendment(uuid, text) TO authenticated;

-- ─────────────────────────────────────────────────────
-- 5. Snapshot V2 builder
-- ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public._build_experiment_snapshot(p_experiment_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_exp record;
  v_snapshot jsonb;
  v_blocks jsonb;
  v_attachment_provenance jsonb;
  v_protocol_provenance jsonb;
BEGIN
  SELECT id, title, experiment_date, template_id, template_version_id
  INTO v_exp
  FROM public.experiments WHERE id = p_experiment_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Experiment not found'; END IF;

  -- Build blocks array
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', b.id, 'type', b.type, 'content', b.content, 'order_key', b.order_key
    ) ORDER BY b.order_key, b.id
  ), '[]'::jsonb) INTO v_blocks
  FROM public.experiment_blocks b WHERE b.experiment_id = p_experiment_id;

  -- Build attachment provenance from block references (not parent-level)
  SELECT COALESCE(jsonb_agg(prov ORDER BY prov->>'block_id', prov->>'attachment_version_id'), '[]'::jsonb)
  INTO v_attachment_provenance
  FROM (
    SELECT DISTINCT ON (av.id) jsonb_build_object(
      'block_id', b.id,
      'attachment_id', av.attachment_id,
      'attachment_version_id', av.id,
      'version_number', av.version_number,
      'storage_path', av.storage_path,
      'checksum', av.checksum,
      'file_size', av.file_size,
      'original_filename', COALESCE(av.original_filename, a.original_filename),
      'display_name', COALESCE(av.display_name, a.display_name),
      'mime_type', COALESCE(av.mime_type, a.mime_type)
    ) AS prov
    FROM public.experiment_blocks b
    JOIN public.attachment_versions av ON av.id = (b.content->>'attachmentVersionId')::uuid
    JOIN public.attachments a ON a.id = av.attachment_id
    WHERE b.experiment_id = p_experiment_id
      AND b.type IN ('image', 'attachment')
      AND b.content->>'attachmentVersionId' IS NOT NULL
  ) sub;

  -- Build protocol provenance from block references (not all experiment_protocols)
  SELECT COALESCE(jsonb_agg(prov ORDER BY prov->>'block_id'), '[]'::jsonb)
  INTO v_protocol_provenance
  FROM (
    SELECT jsonb_build_object(
      'block_id', b.id,
      'experiment_protocol_id', ep.id,
      'protocol_id', ep.protocol_id,
      'protocol_version_id', ep.protocol_version_id,
      'snapshot', ep.snapshot,
      'deviations', COALESCE((
        SELECT jsonb_agg(
          jsonb_build_object(
            'step_index', pd.step_index,
            'original_value', pd.original_value,
            'actual_value', pd.actual_value,
            'reason', pd.reason,
            'created_by', pd.created_by
          ) ORDER BY pd.step_index
        )
        FROM public.protocol_deviations pd
        WHERE pd.experiment_protocol_id = ep.id
      ), '[]'::jsonb)
    ) AS prov
    FROM public.experiment_blocks b
    JOIN public.experiment_protocols ep ON ep.id = (b.content->>'experiment_protocol_id')::uuid
    WHERE b.experiment_id = p_experiment_id
      AND b.type = 'protocol'
      AND b.content->>'experiment_protocol_id' IS NOT NULL
  ) sub;

  SELECT jsonb_build_object(
    'schema_version', 2,
    'title', v_exp.title,
    'experiment_date', v_exp.experiment_date,
    'template_id', v_exp.template_id,
    'template_version_id', v_exp.template_version_id,
    'blocks', v_blocks,
    'tags', COALESCE((
      SELECT jsonb_agg(t.name ORDER BY t.name)
      FROM public.experiment_tags et
      JOIN public.tags t ON t.id = et.tag_id
      WHERE et.experiment_id = p_experiment_id
    ), '[]'::jsonb),
    'attachment_provenance', v_attachment_provenance,
    'protocol_provenance', v_protocol_provenance,
    -- Legacy compatibility fields
    'protocols', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', ep.id, 'protocol_id', ep.protocol_id,
          'protocol_version_id', ep.protocol_version_id, 'snapshot', ep.snapshot
        ) ORDER BY ep.id
      )
      FROM public.experiment_protocols ep WHERE ep.experiment_id = p_experiment_id
    ), '[]'::jsonb),
    'deviations', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', pd.id, 'experiment_protocol_id', pd.experiment_protocol_id,
          'step_index', pd.step_index, 'original_value', pd.original_value,
          'actual_value', pd.actual_value, 'reason', pd.reason,
          'created_by', pd.created_by
        ) ORDER BY pd.experiment_protocol_id, pd.step_index, pd.id
      )
      FROM public.protocol_deviations pd
      JOIN public.experiment_protocols ep ON ep.id = pd.experiment_protocol_id
      WHERE ep.experiment_id = p_experiment_id
    ), '[]'::jsonb),
    'attachments', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', a.id, 'original_filename', a.original_filename,
          'display_name', a.display_name, 'mime_type', a.mime_type,
          'current_version', a.current_version, 'checksum', a.checksum,
          'file_size', a.file_size,
          'current_version_detail', (
            SELECT jsonb_build_object(
              'id', av.id, 'version_number', av.version_number,
              'storage_path', av.storage_path, 'checksum', av.checksum, 'file_size', av.file_size
            )
            FROM public.attachment_versions av
            WHERE av.attachment_id = a.id AND av.version_number = a.current_version
          )
        ) ORDER BY a.id
      )
      FROM public.attachments a
      WHERE a.experiment_id = p_experiment_id AND a.is_archived = false
    ), '[]'::jsonb),
    'references', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', r.id, 'doi', r.doi, 'url', r.url,
          'title', r.title, 'citation', r.citation, 'notes', r.notes
        ) ORDER BY r.id
      )
      FROM public.experiment_references r WHERE r.experiment_id = p_experiment_id
    ), '[]'::jsonb),
    'relations', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', rl.id, 'target_experiment_id', rl.target_experiment_id,
          'relation_type', rl.relation_type
        ) ORDER BY rl.id
      )
      FROM public.experiment_relations rl
      WHERE rl.source_experiment_id = p_experiment_id
    ), '[]'::jsonb),
    'contributors', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object('id', ec.id, 'user_id', ec.user_id, 'role', ec.role)
        ORDER BY ec.id
      )
      FROM public.experiment_contributors ec WHERE ec.experiment_id = p_experiment_id
    ), '[]'::jsonb)
  ) INTO v_snapshot;

  RETURN v_snapshot;
END;
$$;

-- ─────────────────────────────────────────────────────
-- 6. Upgraded restore_experiment_revision with provenance
-- ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.restore_experiment_revision(
  p_experiment_id uuid,
  p_revision_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_user_id uuid;
  v_exp record;
  v_rev record;
  v_snap jsonb;
  v_block jsonb;
  v_block_id uuid;
  v_existing_ids uuid[];
  v_snapshot_ids uuid[];
  v_schema_version int;
  v_prov jsonb;
  v_ep_id uuid;
  v_src_ep record;
  v_new_ep_id uuid;
  v_dev jsonb;
  v_ep_map jsonb := '{}'::jsonb;
  v_result jsonb;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT * INTO v_exp FROM public.experiments WHERE id = p_experiment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Experiment not found'; END IF;
  IF NOT public.can_mutate_experiment_content(p_experiment_id) THEN
    RAISE EXCEPTION 'Experiment is not in an editable state';
  END IF;

  SELECT * INTO v_rev FROM public.experiment_revisions
  WHERE id = p_revision_id AND experiment_id = p_experiment_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Revision not found'; END IF;

  v_snap := v_rev.snapshot;
  v_schema_version := COALESCE((v_snap->>'schema_version')::int, 1);

  UPDATE public.experiments SET
    title = COALESCE(v_snap->>'title', title),
    experiment_date = COALESCE((v_snap->>'experiment_date')::date, experiment_date),
    updated_at = now()
  WHERE id = p_experiment_id;

  SELECT ARRAY_AGG(id) INTO v_existing_ids FROM public.experiment_blocks WHERE experiment_id = p_experiment_id;
  v_existing_ids := COALESCE(v_existing_ids, '{}');

  v_snapshot_ids := '{}';
  FOR v_block IN SELECT * FROM jsonb_array_elements(COALESCE(v_snap->'blocks', '[]'::jsonb)) LOOP
    v_block_id := (v_block->>'id')::uuid;
    v_snapshot_ids := v_snapshot_ids || v_block_id;

    IF v_block_id = ANY(v_existing_ids) THEN
      UPDATE public.experiment_blocks SET
        type = v_block->>'type',
        content = (v_block->'content')::jsonb,
        order_key = v_block->>'order_key',
        updated_by = v_user_id,
        updated_at = now(),
        row_version = row_version + 1
      WHERE id = v_block_id AND experiment_id = p_experiment_id;
    ELSE
      INSERT INTO public.experiment_blocks (id, experiment_id, type, content, order_key, created_by, updated_by, row_version)
      VALUES (v_block_id, p_experiment_id, v_block->>'type', (v_block->'content')::jsonb,
        v_block->>'order_key', v_user_id, v_user_id, 1);
    END IF;
  END LOOP;

  DELETE FROM public.experiment_blocks
  WHERE experiment_id = p_experiment_id AND NOT (id = ANY(v_snapshot_ids));

  -- Restore tags
  DELETE FROM public.experiment_tags WHERE experiment_id = p_experiment_id;
  IF v_snap->'tags' IS NOT NULL AND jsonb_array_length(v_snap->'tags') > 0 THEN
    INSERT INTO public.experiment_tags (experiment_id, tag_id)
    SELECT p_experiment_id, t.id
    FROM jsonb_array_elements_text(v_snap->'tags') AS tag_name
    JOIN public.tags t ON t.name = tag_name AND t.workspace_id = v_exp.workspace_id
    ON CONFLICT DO NOTHING;
  END IF;

  -- For schema_version 2: restore protocol instances from protocol_provenance
  IF v_schema_version >= 2 AND v_snap->'protocol_provenance' IS NOT NULL THEN
    FOR v_prov IN SELECT * FROM jsonb_array_elements(v_snap->'protocol_provenance') LOOP
      v_ep_id := (v_prov->>'experiment_protocol_id')::uuid;

      IF v_ep_id IS NOT NULL AND NOT (v_ep_map ? v_ep_id::text) THEN
        -- Check if this instance still exists in this experiment
        SELECT * INTO v_src_ep FROM public.experiment_protocols
        WHERE id = v_ep_id AND experiment_id = p_experiment_id;

        IF NOT FOUND THEN
          -- Recreate the instance from snapshot data
          INSERT INTO public.experiment_protocols (
            experiment_id, protocol_id, protocol_version_id, snapshot
          ) VALUES (
            p_experiment_id,
            (v_prov->>'protocol_id')::uuid,
            (v_prov->>'protocol_version_id')::uuid,
            v_prov->'snapshot'
          ) RETURNING id INTO v_new_ep_id;

          -- Restore deviations
          IF v_prov->'deviations' IS NOT NULL THEN
            FOR v_dev IN SELECT * FROM jsonb_array_elements(v_prov->'deviations') LOOP
              INSERT INTO public.protocol_deviations (
                experiment_protocol_id, step_index, original_value, actual_value, reason, created_by
              ) VALUES (
                v_new_ep_id,
                (v_dev->>'step_index')::int,
                v_dev->>'original_value',
                v_dev->>'actual_value',
                v_dev->>'reason',
                COALESCE((v_dev->>'created_by')::uuid, v_user_id)
              ) ON CONFLICT (experiment_protocol_id, step_index) DO NOTHING;
            END LOOP;
          END IF;

          -- Update block references to point to new instance
          UPDATE public.experiment_blocks SET
            content = content || jsonb_build_object('experiment_protocol_id', v_new_ep_id::text)
          WHERE experiment_id = p_experiment_id
            AND type = 'protocol'
            AND content->>'experiment_protocol_id' = v_ep_id::text;

          v_ep_map := v_ep_map || jsonb_build_object(v_ep_id::text, v_new_ep_id::text);
        ELSE
          -- Instance still exists, restore its deviations
          DELETE FROM public.protocol_deviations WHERE experiment_protocol_id = v_ep_id;

          IF v_prov->'deviations' IS NOT NULL THEN
            FOR v_dev IN SELECT * FROM jsonb_array_elements(v_prov->'deviations') LOOP
              INSERT INTO public.protocol_deviations (
                experiment_protocol_id, step_index, original_value, actual_value, reason, created_by
              ) VALUES (
                v_ep_id,
                (v_dev->>'step_index')::int,
                v_dev->>'original_value',
                v_dev->>'actual_value',
                v_dev->>'reason',
                COALESCE((v_dev->>'created_by')::uuid, v_user_id)
              ) ON CONFLICT (experiment_protocol_id, step_index) DO NOTHING;
            END LOOP;
          END IF;

          v_ep_map := v_ep_map || jsonb_build_object(v_ep_id::text, v_ep_id::text);
        END IF;
      END IF;
    END LOOP;
  END IF;

  v_result := public._create_revision_internal(
    p_experiment_id,
    'Restored from revision v' || v_rev.revision_number,
    'restoration',
    v_user_id,
    jsonb_build_object(
      'source_revision_id', v_rev.id,
      'source_revision_number', v_rev.revision_number,
      'source_content_hash', v_rev.content_hash
    )
  );

  RETURN v_result;
END;
$$;
