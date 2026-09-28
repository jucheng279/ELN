/*
  # Corrective migration: snapshot, revision lock, review model, template, delete version

  ## Summary
  Fixes function signatures and semantics for clean replay from zero.
  No manual/out-of-band SQL prerequisites.

  ## Changes
  - Adds metadata column to experiment_revisions (idempotent).
  - Replaces _build_experiment_snapshot with corrected column names
    (original_filename, original_value/actual_value, source/target_experiment_id, relation_type).
    Snapshot excludes workflow status and block row_version.
  - Drops old 4-arg _create_revision_internal(uuid,text,text,uuid) then creates
    canonical 5-arg version with p_metadata jsonb. FOR UPDATE serialization lock.
  - Replaces delete_experiment_block to make p_expected_version mandatory (not nullable).
  - Replaces resubmit_for_review with append-only review model.
  - Replaces create_experiment_rpc with corrected template validation (status='published'),
    folder-notebook validation, fractional-indexing-compatible order keys.
  - Replaces restore_experiment_revision with block-preserving diff/upsert/delete,
    tag restoration, structured provenance metadata.
  - Replaces complete_experiment to use canonical revision creator.

  ## Security
  - _build_experiment_snapshot: SECURITY DEFINER, revoked from PUBLIC/anon/authenticated.
  - _create_revision_internal: SECURITY DEFINER, revoked from PUBLIC/anon/authenticated.
  - All public RPCs: revoked from PUBLIC/anon, granted to authenticated only.
*/

-- ═══════════════════════════════════════════════════════════════════════
-- 0. Add metadata column to experiment_revisions for restore provenance
-- ═══════════════════════════════════════════════════════════════════════
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'experiment_revisions' AND column_name = 'metadata'
  ) THEN
    ALTER TABLE public.experiment_revisions ADD COLUMN metadata jsonb NOT NULL DEFAULT '{}'::jsonb;
  END IF;
END $$;

-- ═══════════════════════════════════════════════════════════════════════
-- 1. Canonical snapshot builder — scientific content only
--    Schema version 1: excludes status and row_version
-- ═══════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public._build_experiment_snapshot(p_experiment_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_exp record;
  v_snapshot jsonb;
BEGIN
  SELECT id, title, experiment_date, template_id, template_version_id
  INTO v_exp
  FROM public.experiments WHERE id = p_experiment_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Experiment not found'; END IF;

  SELECT jsonb_build_object(
    'schema_version', 1,
    'title', v_exp.title,
    'experiment_date', v_exp.experiment_date,
    'template_id', v_exp.template_id,
    'template_version_id', v_exp.template_version_id,
    'blocks', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', b.id, 'type', b.type, 'content', b.content, 'order_key', b.order_key
        ) ORDER BY b.order_key, b.id
      )
      FROM public.experiment_blocks b WHERE b.experiment_id = p_experiment_id
    ), '[]'::jsonb),
    'tags', COALESCE((
      SELECT jsonb_agg(t.name ORDER BY t.name)
      FROM public.experiment_tags et
      JOIN public.tags t ON t.id = et.tag_id
      WHERE et.experiment_id = p_experiment_id
    ), '[]'::jsonb),
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

REVOKE EXECUTE ON FUNCTION public._build_experiment_snapshot(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public._build_experiment_snapshot(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public._build_experiment_snapshot(uuid) FROM authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- 2. _create_revision_internal — canonical 5-arg version
--    First: remove old 4-arg overload created by prior migrations.
--    Then: create the 5-arg version (new identity).
-- ═══════════════════════════════════════════════════════════════════════
DROP FUNCTION IF EXISTS public._create_revision_internal(uuid, text, text, uuid);

CREATE FUNCTION public._create_revision_internal(
  p_experiment_id uuid,
  p_change_summary text,
  p_change_type text,
  p_created_by uuid,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_rev_number int;
  v_rev_id uuid;
  v_snapshot jsonb;
  v_hash text;
BEGIN
  PERFORM 1 FROM public.experiments WHERE id = p_experiment_id FOR UPDATE;

  SELECT COALESCE(MAX(revision_number), 0) + 1 INTO v_rev_number
  FROM public.experiment_revisions WHERE experiment_id = p_experiment_id;

  v_snapshot := public._build_experiment_snapshot(p_experiment_id);
  v_hash := encode(sha256(convert_to(v_snapshot::text, 'UTF8')), 'hex');

  INSERT INTO public.experiment_revisions (
    experiment_id, revision_number, snapshot, content_hash,
    change_summary, change_type, created_by, metadata
  ) VALUES (
    p_experiment_id, v_rev_number, v_snapshot, v_hash,
    p_change_summary, p_change_type, p_created_by, p_metadata
  ) RETURNING id INTO v_rev_id;

  UPDATE public.experiments
  SET current_revision = v_rev_number, updated_at = now()
  WHERE id = p_experiment_id;

  RETURN jsonb_build_object(
    'revision_id', v_rev_id,
    'revision_number', v_rev_number,
    'content_hash', v_hash
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public._create_revision_internal(uuid, text, text, uuid, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public._create_revision_internal(uuid, text, text, uuid, jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public._create_revision_internal(uuid, text, text, uuid, jsonb) FROM authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- 3. create_checkpoint — public wrapper
-- ═══════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.create_checkpoint(
  p_experiment_id uuid,
  p_change_summary text DEFAULT ''
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_user_id uuid;
  v_exp record;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT * INTO v_exp FROM public.experiments WHERE id = p_experiment_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Experiment not found'; END IF;
  IF NOT public.can_mutate_experiment_content(p_experiment_id) THEN
    RAISE EXCEPTION 'Experiment is not in an editable state';
  END IF;

  RETURN public._create_revision_internal(
    p_experiment_id, p_change_summary, 'checkpoint', v_user_id
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_checkpoint(uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_checkpoint(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_checkpoint(uuid, text) TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- 4. resubmit_for_review — append-only review history
-- ═══════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.resubmit_for_review(p_experiment_id uuid, p_review_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_user_id uuid; v_experiment record; v_old_review record;
  v_rev_result jsonb; v_revision_id uuid; v_new_review_id uuid;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT * INTO v_experiment FROM public.experiments WHERE id = p_experiment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Experiment not found'; END IF;
  IF NOT public.is_workspace_editor(v_experiment.workspace_id) THEN RAISE EXCEPTION 'Not authorized'; END IF;
  IF v_experiment.status != 'changes_requested' THEN
    RAISE EXCEPTION 'Experiment must have changes requested';
  END IF;

  SELECT * INTO v_old_review FROM public.reviews WHERE id = p_review_id AND experiment_id = p_experiment_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Review not found'; END IF;

  v_rev_result := public._create_revision_internal(p_experiment_id, 'Resubmitted for review', 'resubmit', v_user_id);
  v_revision_id := (v_rev_result->>'revision_id')::uuid;

  INSERT INTO public.reviews (experiment_id, reviewer_id, revision_number, experiment_revision_id, status)
  VALUES (p_experiment_id, v_old_review.reviewer_id,
    (v_rev_result->>'revision_number')::int, v_revision_id, 'pending')
  RETURNING id INTO v_new_review_id;

  UPDATE public.experiments SET status = 'in_review' WHERE id = p_experiment_id;

  INSERT INTO public.audit_events (workspace_id, object_type, object_id, event_type, actor_id, revision_number)
  VALUES (v_experiment.workspace_id, 'experiment', p_experiment_id, 'review_resubmitted', v_user_id,
    (v_rev_result->>'revision_number')::int);

  INSERT INTO public.notifications (user_id, type, title, body, experiment_id)
  VALUES (v_old_review.reviewer_id, 'review_requested', 'Experiment resubmitted',
    'An experiment has been resubmitted for your review', p_experiment_id);

  RETURN jsonb_build_object('review_id', v_new_review_id, 'revision_id', v_revision_id,
    'revision_number', (v_rev_result->>'revision_number')::int,
    'content_hash', v_rev_result->>'content_hash');
END;
$$;

REVOKE EXECUTE ON FUNCTION public.resubmit_for_review(uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.resubmit_for_review(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.resubmit_for_review(uuid, uuid) TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- 5. create_experiment_rpc — fix template validation + order keys
-- ═══════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.create_experiment_rpc(
  p_workspace_id uuid,
  p_notebook_id uuid,
  p_title text DEFAULT 'Untitled Experiment',
  p_template_version_id uuid DEFAULT NULL,
  p_folder_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_user_id uuid;
  v_experiment_id uuid;
  v_result jsonb;
  v_template_id uuid;
  v_block record;
  v_order_idx int := 0;
  v_order_key text;
  v_fi_chars text[] := ARRAY['a0','a1','a2','a3','a4','a5','a6','a7','a8','a9',
    'b0','b1','b2','b3','b4','b5','b6','b7','b8','b9',
    'c0','c1','c2','c3','c4','c5','c6','c7','c8','c9'];
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT public.is_workspace_editor(p_workspace_id) THEN RAISE EXCEPTION 'Not authorized'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.notebooks WHERE id = p_notebook_id AND workspace_id = p_workspace_id
  ) THEN
    RAISE EXCEPTION 'Notebook does not belong to this workspace';
  END IF;

  IF p_folder_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.folders WHERE id = p_folder_id AND notebook_id = p_notebook_id
    ) THEN
      RAISE EXCEPTION 'Folder does not belong to this notebook';
    END IF;
  END IF;

  IF p_template_version_id IS NOT NULL THEN
    SELECT t.id INTO v_template_id
    FROM public.template_versions tv
    JOIN public.templates t ON t.id = tv.template_id
    WHERE tv.id = p_template_version_id
      AND t.workspace_id = p_workspace_id
      AND tv.status = 'published';
    IF v_template_id IS NULL THEN
      RAISE EXCEPTION 'Template version not found or not published in this workspace';
    END IF;
  END IF;

  INSERT INTO public.experiments (
    workspace_id, notebook_id, folder_id, title, status,
    experiment_date, template_id, template_version_id, created_by
  ) VALUES (
    p_workspace_id, p_notebook_id, p_folder_id, p_title, 'draft',
    CURRENT_DATE, v_template_id, p_template_version_id, v_user_id
  ) RETURNING id INTO v_experiment_id;

  IF p_template_version_id IS NOT NULL THEN
    FOR v_block IN
      SELECT elem FROM jsonb_array_elements(
        (SELECT content FROM public.template_versions WHERE id = p_template_version_id)
      ) AS elem
    LOOP
      v_order_idx := v_order_idx + 1;
      IF v_order_idx <= array_length(v_fi_chars, 1) THEN
        v_order_key := v_fi_chars[v_order_idx];
      ELSE
        v_order_key := 'z' || lpad(v_order_idx::text, 6, '0');
      END IF;

      INSERT INTO public.experiment_blocks (experiment_id, type, content, order_key, created_by, updated_by)
      VALUES (
        v_experiment_id,
        v_block.elem->>'type',
        COALESCE(v_block.elem->'defaultContent', v_block.elem->'content', '{}'::jsonb),
        v_order_key,
        v_user_id, v_user_id
      );
    END LOOP;
  END IF;

  v_result := public._create_revision_internal(v_experiment_id, 'Experiment created', 'created', v_user_id);

  RETURN jsonb_build_object(
    'id', v_experiment_id,
    'experiment_number', (SELECT experiment_number FROM public.experiments WHERE id = v_experiment_id),
    'experiment_id', (SELECT experiment_id FROM public.experiments WHERE id = v_experiment_id)
  ) || v_result;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_experiment_rpc(uuid, uuid, text, uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_experiment_rpc(uuid, uuid, text, uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_experiment_rpc(uuid, uuid, text, uuid, uuid) TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- 6. delete_experiment_block — version MANDATORY, no default
--    Prior migration created (uuid,uuid,bigint DEFAULT NULL).
--    PostgreSQL cannot remove a default via CREATE OR REPLACE,
--    so we DROP the exact signature then recreate without a default.
-- ═══════════════════════════════════════════════════════════════════════
DROP FUNCTION IF EXISTS public.delete_experiment_block(uuid, uuid, bigint);

CREATE FUNCTION public.delete_experiment_block(
  p_experiment_id uuid,
  p_block_id uuid,
  p_expected_version bigint
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_actual_version bigint;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT public.can_mutate_experiment_content(p_experiment_id) THEN
    RAISE EXCEPTION 'Experiment is not in an editable state';
  END IF;

  IF p_expected_version IS NULL OR p_expected_version <= 0 THEN
    RAISE EXCEPTION 'p_expected_version is required and must be > 0';
  END IF;

  SELECT row_version INTO v_actual_version
  FROM public.experiment_blocks
  WHERE id = p_block_id AND experiment_id = p_experiment_id
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'Block not found'; END IF;

  IF v_actual_version != p_expected_version THEN
    RAISE EXCEPTION 'CONFLICT: block version mismatch (expected %, actual %)',
      p_expected_version, v_actual_version
    USING ERRCODE = 'serialization_failure';
  END IF;

  DELETE FROM public.experiment_blocks WHERE id = p_block_id AND experiment_id = p_experiment_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.delete_experiment_block(uuid, uuid, bigint) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.delete_experiment_block(uuid, uuid, bigint) FROM anon;
GRANT EXECUTE ON FUNCTION public.delete_experiment_block(uuid, uuid, bigint) TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- 7. restore_experiment_revision — full scientific content restoration
-- ═══════════════════════════════════════════════════════════════════════
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

  DELETE FROM public.experiment_tags WHERE experiment_id = p_experiment_id;
  IF v_snap->'tags' IS NOT NULL AND jsonb_array_length(v_snap->'tags') > 0 THEN
    INSERT INTO public.experiment_tags (experiment_id, tag_id)
    SELECT p_experiment_id, t.id
    FROM jsonb_array_elements_text(v_snap->'tags') AS tag_name
    JOIN public.tags t ON t.name = tag_name AND t.workspace_id = v_exp.workspace_id
    ON CONFLICT DO NOTHING;
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

REVOKE EXECUTE ON FUNCTION public.restore_experiment_revision(uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.restore_experiment_revision(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.restore_experiment_revision(uuid, uuid) TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- 8. Fix complete_experiment
-- ═══════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.complete_experiment(p_experiment_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE v_user_id uuid; v_exp record;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT * INTO v_exp FROM public.experiments e WHERE e.id = p_experiment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Experiment not found'; END IF;
  IF NOT public.is_workspace_editor(v_exp.workspace_id) THEN RAISE EXCEPTION 'Not authorized'; END IF;
  IF v_exp.status != 'in_progress' THEN RAISE EXCEPTION 'Can only complete an in-progress experiment'; END IF;

  PERFORM public._create_revision_internal(p_experiment_id, 'Experiment completed', 'completion', v_user_id);
  UPDATE public.experiments SET status = 'completed', updated_at = now() WHERE id = p_experiment_id;
  INSERT INTO public.audit_events (workspace_id, object_type, object_id, event_type, actor_id)
  VALUES (v_exp.workspace_id, 'experiment', p_experiment_id, 'completed', v_user_id);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.complete_experiment(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.complete_experiment(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.complete_experiment(uuid) TO authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- 9. Drop all legacy create_revision variants (if any survived)
-- ═══════════════════════════════════════════════════════════════════════
DROP FUNCTION IF EXISTS public.create_revision(uuid, text, text);
DROP FUNCTION IF EXISTS public.create_revision(uuid, text);
