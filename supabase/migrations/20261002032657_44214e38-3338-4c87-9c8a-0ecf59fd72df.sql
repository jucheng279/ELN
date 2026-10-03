CREATE OR REPLACE FUNCTION public.create_amendment(p_experiment_id uuid, p_reason text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE
  v_user_id uuid; v_src record; v_sig record; v_rev record; v_snap jsonb; v_schema int; v_n int;
  v_new_id uuid; v_new_number bigint; v_new_human_id text;
  v_block jsonb; v_content jsonb; v_prov jsonb; v_raw text; v_src_ver uuid; v_src_ep uuid;
  v_att_map jsonb := '{}'::jsonb; v_ep_map jsonb := '{}'::jsonb; v_block_map jsonb := '{}'::jsonb;
  v_new_att uuid; v_new_ver uuid; v_new_ep uuid; v_new_block uuid; v_dev jsonb; v_pv_ws uuid; v_ok boolean;
  v_missing_tags jsonb := '[]'::jsonb; v_missing_rel jsonb := '[]'::jsonb; v_rel jsonb; v_ref jsonb;
  v_rev_result jsonb; v_lineage jsonb;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN RAISE EXCEPTION 'Amendment reason is required'; END IF;

  SELECT * INTO v_src FROM public.experiments WHERE id = p_experiment_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Experiment not found'; END IF;
  IF NOT public.is_workspace_editor(v_src.workspace_id) THEN RAISE EXCEPTION 'Not authorized to create amendment'; END IF;
  IF v_src.status <> 'locked' OR NOT v_src.is_locked OR v_src.is_archived THEN
    RAISE EXCEPTION 'Only locked experiments can be amended';
  END IF;

  -- Domain contract: sign_and_lock is the only signing path and it locks, so a
  -- locked source has exactly one signature. Anything else is ambiguous.
  SELECT count(*) INTO v_n FROM public.signatures WHERE experiment_id = p_experiment_id;
  IF v_n = 0 THEN RAISE EXCEPTION 'Source has no signature bound to an exact revision'; END IF;
  IF v_n > 1 THEN RAISE EXCEPTION 'Source signature is ambiguous; amendment refused'; END IF;
  SELECT * INTO v_sig FROM public.signatures WHERE experiment_id = p_experiment_id;
  IF v_sig.experiment_revision_id IS NULL THEN RAISE EXCEPTION 'Source has no signature bound to an exact revision'; END IF;
  SELECT * INTO v_rev FROM public.experiment_revisions
   WHERE id = v_sig.experiment_revision_id AND experiment_id = p_experiment_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Signed revision not found for source experiment'; END IF;
  IF v_rev.revision_number IS DISTINCT FROM v_sig.revision_number
     OR v_rev.content_hash IS NULL OR v_rev.content_hash IS DISTINCT FROM v_sig.content_hash THEN
    RAISE EXCEPTION 'Signature does not match its signed revision; amendment refused';
  END IF;

  v_snap := v_rev.snapshot;
  v_schema := COALESCE(public._try_uuid(NULL)::text::int, (v_snap->>'schema_version')::int, 1);

  IF v_schema < 2 THEN
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(v_snap->'blocks','[]'::jsonb)) b
               WHERE b->>'type' IN ('image','attachment','protocol')) THEN
      RAISE EXCEPTION 'Signed revision uses schema v1 without exact file/protocol provenance; amendment refused';
    END IF;
  END IF;

  INSERT INTO public.experiments (workspace_id, notebook_id, folder_id, title, status, experiment_date,
    template_id, template_version_id, amended_from_id, amendment_reason)
  VALUES (v_src.workspace_id, v_src.notebook_id, v_src.folder_id,
    COALESCE(v_snap->>'title', v_src.title) || ' (Amendment)', 'draft',
    COALESCE((v_snap->>'experiment_date')::date, CURRENT_DATE),
    public._try_uuid(v_snap->>'template_id'), public._try_uuid(v_snap->>'template_version_id'),
    p_experiment_id, p_reason)
  RETURNING id, experiment_number, experiment_id INTO v_new_id, v_new_number, v_new_human_id;

  FOR v_block IN SELECT * FROM jsonb_array_elements(COALESCE(v_snap->'blocks','[]'::jsonb)) LOOP
    v_content := COALESCE(v_block->'content', '{}'::jsonb);
    IF v_block->>'type' IN ('image','attachment') THEN
      v_raw := v_content->>'attachmentVersionId';
      IF v_raw IS NULL OR v_raw = '' THEN
        IF COALESCE(v_content->>'attachmentId','') <> '' THEN
          RAISE EXCEPTION 'Signed file block % has no exact version; amendment refused', v_block->>'id';
        END IF;
      ELSE
        v_src_ver := public._try_uuid(v_raw);
        SELECT p INTO v_prov FROM jsonb_array_elements(COALESCE(v_snap->'attachment_provenance','[]'::jsonb)) p
         WHERE p->>'block_id' = v_block->>'id' AND p->>'attachment_version_id' = v_src_ver::text LIMIT 1;
        IF v_prov IS NULL THEN RAISE EXCEPTION 'Signed file block % lacks provenance; amendment refused', v_block->>'id'; END IF;
        IF v_att_map ? v_src_ver::text THEN
          v_new_att := (v_att_map->v_src_ver::text->>'attachment_id')::uuid;
          v_new_ver := (v_att_map->v_src_ver::text->>'attachment_version_id')::uuid;
        ELSE
          SELECT true INTO v_ok FROM public.attachment_versions av JOIN public.attachments a ON a.id = av.attachment_id
           WHERE av.id = v_src_ver AND a.experiment_id = p_experiment_id
             AND av.attachment_id::text = v_prov->>'attachment_id'
             AND av.checksum IS NOT DISTINCT FROM v_prov->>'checksum'
             AND av.storage_path = v_prov->>'storage_path';
          IF v_ok IS NULL THEN RAISE EXCEPTION 'Signed file version % is missing or altered; amendment refused', v_src_ver; END IF;
          v_ok := NULL;
          INSERT INTO public.attachments (experiment_id, original_filename, display_name, storage_path, mime_type,
            file_size, checksum, current_version, uploaded_by)
          VALUES (v_new_id, COALESCE(v_prov->>'original_filename', v_prov->>'display_name', 'file'),
            COALESCE(v_prov->>'display_name', v_prov->>'original_filename', 'file'), v_prov->>'storage_path',
            v_prov->>'mime_type', (v_prov->>'file_size')::bigint, v_prov->>'checksum', 1, v_user_id)
          RETURNING id INTO v_new_att;
          INSERT INTO public.attachment_versions (attachment_id, version_number, storage_path, file_size, checksum,
            uploaded_by, original_filename, display_name, mime_type, source_attachment_version_id)
          VALUES (v_new_att, 1, v_prov->>'storage_path', (v_prov->>'file_size')::bigint, v_prov->>'checksum',
            v_user_id, v_prov->>'original_filename', v_prov->>'display_name', v_prov->>'mime_type', v_src_ver)
          RETURNING id INTO v_new_ver;
          v_att_map := v_att_map || jsonb_build_object(v_src_ver::text,
            jsonb_build_object('attachment_id', v_new_att, 'attachment_version_id', v_new_ver));
        END IF;
        v_content := v_content || jsonb_build_object('attachmentId', v_new_att::text,
          'attachmentVersionId', v_new_ver::text, 'versionNumber', 1, 'checksum', v_prov->>'checksum');
      END IF;
    ELSIF v_block->>'type' = 'protocol' THEN
      v_raw := v_content->>'experiment_protocol_id';
      IF v_raw IS NOT NULL AND v_raw <> '' THEN
        v_src_ep := public._try_uuid(v_raw);
        SELECT p INTO v_prov FROM jsonb_array_elements(COALESCE(v_snap->'protocol_provenance','[]'::jsonb)) p
         WHERE p->>'block_id' = v_block->>'id' AND p->>'experiment_protocol_id' = v_src_ep::text LIMIT 1;
        IF v_prov IS NULL THEN RAISE EXCEPTION 'Signed protocol block % lacks provenance; amendment refused', v_block->>'id'; END IF;
        IF v_ep_map ? v_src_ep::text THEN
          v_new_ep := (v_ep_map->>v_src_ep::text)::uuid;
        ELSE
          SELECT p.workspace_id INTO v_pv_ws FROM public.protocol_versions pv JOIN public.protocols p ON p.id = pv.protocol_id
           WHERE pv.id = public._try_uuid(v_prov->>'protocol_version_id') AND pv.protocol_id = public._try_uuid(v_prov->>'protocol_id');
          IF v_pv_ws IS DISTINCT FROM v_src.workspace_id THEN
            RAISE EXCEPTION 'Signed protocol version is unavailable in this workspace; amendment refused';
          END IF;
          v_pv_ws := NULL;
          INSERT INTO public.experiment_protocols (experiment_id, protocol_id, protocol_version_id, snapshot)
          VALUES (v_new_id, (v_prov->>'protocol_id')::uuid, (v_prov->>'protocol_version_id')::uuid, COALESCE(v_prov->'snapshot','{}'::jsonb))
          RETURNING id INTO v_new_ep;
          FOR v_dev IN SELECT * FROM jsonb_array_elements(COALESCE(v_prov->'deviations','[]'::jsonb)) LOOP
            INSERT INTO public.protocol_deviations (experiment_protocol_id, step_index, original_value, actual_value, reason, created_by)
            VALUES (v_new_ep, (v_dev->>'step_index')::int, v_dev->>'original_value', v_dev->>'actual_value', v_dev->>'reason',
              COALESCE((SELECT pr.id FROM public.profiles pr WHERE pr.id = public._try_uuid(v_dev->>'created_by')), v_user_id));
          END LOOP;
          v_ep_map := v_ep_map || jsonb_build_object(v_src_ep::text, v_new_ep::text);
        END IF;
        v_content := v_content || jsonb_build_object('experiment_protocol_id', v_new_ep::text);
      END IF;
    END IF;
    v_prov := NULL;
    INSERT INTO public.experiment_blocks (experiment_id, type, content, order_key, created_by, updated_by)
    VALUES (v_new_id, v_block->>'type', v_content, v_block->>'order_key', v_user_id, v_user_id)
    RETURNING id INTO v_new_block;
    v_block_map := v_block_map || jsonb_build_object(v_block->>'id', v_new_block::text);
  END LOOP;

  -- Tags: signed names resolved in this workspace only; missing ones reported.
  IF jsonb_typeof(v_snap->'tags') = 'array' THEN
    INSERT INTO public.experiment_tags (experiment_id, tag_id)
    SELECT v_new_id, t.id FROM jsonb_array_elements_text(v_snap->'tags') tn
      JOIN public.tags t ON t.name = tn AND t.workspace_id = v_src.workspace_id ON CONFLICT DO NOTHING;
    SELECT COALESCE(jsonb_agg(tn ORDER BY tn), '[]'::jsonb) INTO v_missing_tags
      FROM jsonb_array_elements_text(v_snap->'tags') tn
     WHERE NOT EXISTS (SELECT 1 FROM public.tags t WHERE t.name = tn AND t.workspace_id = v_src.workspace_id);
  END IF;

  -- References are document content: recreated from the signed snapshot.
  FOR v_ref IN SELECT * FROM jsonb_array_elements(COALESCE(v_snap->'references','[]'::jsonb)) LOOP
    INSERT INTO public.experiment_references (experiment_id, doi, url, title, citation, notes, created_by)
    VALUES (v_new_id, v_ref->>'doi', v_ref->>'url', v_ref->>'title', v_ref->>'citation', v_ref->>'notes', v_user_id);
  END LOOP;

  -- Relations: signed edges whose target still exists in this workspace; others reported.
  FOR v_rel IN SELECT * FROM jsonb_array_elements(COALESCE(v_snap->'relations','[]'::jsonb)) LOOP
    IF EXISTS (SELECT 1 FROM public.experiments e WHERE e.id = public._try_uuid(v_rel->>'target_experiment_id')
               AND e.workspace_id = v_src.workspace_id AND e.id <> v_new_id) THEN
      INSERT INTO public.experiment_relations (source_experiment_id, target_experiment_id, relation_type, created_by)
      VALUES (v_new_id, (v_rel->>'target_experiment_id')::uuid, v_rel->>'relation_type', v_user_id);
    ELSE
      v_missing_rel := v_missing_rel || jsonb_build_array(v_rel - 'id');
    END IF;
  END LOOP;
  -- Contributors are attribution of the signed work, intentionally not carried.

  v_lineage := jsonb_build_object(
    'source_experiment_id', p_experiment_id, 'source_experiment_human_id', v_src.experiment_id,
    'amendment_reason', p_reason, 'source_revision_id', v_rev.id::text,
    'source_revision_number', v_rev.revision_number, 'source_content_hash', v_rev.content_hash,
    'source_signature_id', v_sig.id::text, 'source_schema_version', v_schema,
    'source_title', v_snap->>'title', 'reconstructed_from', 'signed_snapshot',
    'block_map', v_block_map, 'attachment_version_map', v_att_map, 'protocol_instance_map', v_ep_map,
    'unresolved_tags', v_missing_tags, 'unresolved_relations', v_missing_rel,
    'contributors_policy', 'not_carried');

  v_rev_result := public._create_revision_internal(v_new_id,
    'Amendment of ' || v_src.experiment_id || ' v' || v_rev.revision_number || ': ' || p_reason,
    'created', v_user_id, v_lineage);

  INSERT INTO public.audit_events (workspace_id, object_type, object_id, event_type, actor_id, revision_number, metadata)
  VALUES (v_src.workspace_id, 'experiment', v_new_id, 'amendment_created', v_user_id,
    (v_rev_result->>'revision_number')::int,
    (v_lineage - 'block_map' - 'attachment_version_map' - 'protocol_instance_map')
      || jsonb_build_object('reason', p_reason, 'new_revision_id', v_rev_result->>'revision_id',
                            'new_content_hash', v_rev_result->>'content_hash'));

  RETURN jsonb_build_object('id', v_new_id, 'experiment_number', v_new_number, 'experiment_id', v_new_human_id,
    'amended_from_id', p_experiment_id, 'source_experiment_human_id', v_src.experiment_id,
    'source_revision_id', v_rev.id, 'source_revision_number', v_rev.revision_number,
    'source_content_hash', v_rev.content_hash, 'source_signature_id', v_sig.id,
    'source_schema_version', v_schema,
    'revision_id', v_rev_result->>'revision_id', 'content_hash', v_rev_result->>'content_hash',
    'unresolved_tags', v_missing_tags, 'unresolved_relations', v_missing_rel);
END;
$function$;

REVOKE ALL ON FUNCTION public.create_amendment(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_amendment(uuid, text) TO authenticated;
