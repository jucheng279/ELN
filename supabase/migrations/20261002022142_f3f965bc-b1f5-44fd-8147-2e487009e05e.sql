CREATE OR REPLACE FUNCTION public.restore_experiment_revision(p_experiment_id uuid, p_revision_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE
  v_user_id uuid; v_exp record; v_rev record; v_snap jsonb; v_block jsonb; v_block_id uuid;
  v_existing_ids uuid[]; v_snapshot_ids uuid[]; v_schema_version int; v_prov jsonb; v_ep_id uuid;
  v_src_ep record; v_new_ep_id uuid; v_dev jsonb; v_ep_map jsonb := '{}'::jsonb; v_result jsonb;
  v_pv_ws uuid; v_missing_tags jsonb := '[]'::jsonb; v_reuse boolean;
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

  SELECT COALESCE(ARRAY_AGG(id), '{}') INTO v_existing_ids FROM public.experiment_blocks WHERE experiment_id = p_experiment_id;
  v_snapshot_ids := '{}';
  FOR v_block IN SELECT * FROM jsonb_array_elements(COALESCE(v_snap->'blocks', '[]'::jsonb)) LOOP
    v_block_id := (v_block->>'id')::uuid;
    v_snapshot_ids := v_snapshot_ids || v_block_id;
    IF v_block_id = ANY(v_existing_ids) THEN
      UPDATE public.experiment_blocks SET type = v_block->>'type', content = (v_block->'content')::jsonb,
        order_key = v_block->>'order_key', updated_by = v_user_id, updated_at = now(), row_version = row_version + 1
      WHERE id = v_block_id AND experiment_id = p_experiment_id;
    ELSE
      INSERT INTO public.experiment_blocks (id, experiment_id, type, content, order_key, created_by, updated_by, row_version)
      VALUES (v_block_id, p_experiment_id, v_block->>'type', (v_block->'content')::jsonb, v_block->>'order_key', v_user_id, v_user_id, 1);
    END IF;
  END LOOP;
  DELETE FROM public.experiment_blocks WHERE experiment_id = p_experiment_id AND NOT (id = ANY(v_snapshot_ids));

  -- Tags: resolved only inside this workspace; names no longer present are reported, never fabricated.
  DELETE FROM public.experiment_tags WHERE experiment_id = p_experiment_id;
  IF jsonb_typeof(v_snap->'tags') = 'array' AND jsonb_array_length(v_snap->'tags') > 0 THEN
    INSERT INTO public.experiment_tags (experiment_id, tag_id)
    SELECT p_experiment_id, t.id FROM jsonb_array_elements_text(v_snap->'tags') AS tag_name
    JOIN public.tags t ON t.name = tag_name AND t.workspace_id = v_exp.workspace_id
    ON CONFLICT DO NOTHING;
    SELECT COALESCE(jsonb_agg(tag_name ORDER BY tag_name), '[]'::jsonb) INTO v_missing_tags
    FROM jsonb_array_elements_text(v_snap->'tags') AS tag_name
    WHERE NOT EXISTS (SELECT 1 FROM public.tags t WHERE t.name = tag_name AND t.workspace_id = v_exp.workspace_id);
  END IF;

  IF v_schema_version >= 2 AND jsonb_typeof(v_snap->'protocol_provenance') = 'array' THEN
    FOR v_prov IN SELECT * FROM jsonb_array_elements(v_snap->'protocol_provenance') LOOP
      v_ep_id := public._try_uuid(v_prov->>'experiment_protocol_id');
      IF v_ep_id IS NULL OR v_ep_map ? v_ep_id::text THEN CONTINUE; END IF;

      SELECT p.workspace_id INTO v_pv_ws FROM public.protocol_versions pv
        JOIN public.protocols p ON p.id = pv.protocol_id
       WHERE pv.id = public._try_uuid(v_prov->>'protocol_version_id');
      IF v_pv_ws IS DISTINCT FROM v_exp.workspace_id THEN
        RAISE EXCEPTION 'Pinned protocol version is unavailable in this workspace; restore refused';
      END IF;

      SELECT * INTO v_src_ep FROM public.experiment_protocols WHERE id = v_ep_id AND experiment_id = p_experiment_id;
      v_reuse := FOUND AND v_src_ep.protocol_version_id = public._try_uuid(v_prov->>'protocol_version_id');

      IF v_reuse THEN
        DELETE FROM public.protocol_deviations WHERE experiment_protocol_id = v_ep_id;
        v_new_ep_id := v_ep_id;
      ELSE
        INSERT INTO public.experiment_protocols (experiment_id, protocol_id, protocol_version_id, snapshot)
        VALUES (p_experiment_id, public._try_uuid(v_prov->>'protocol_id'), public._try_uuid(v_prov->>'protocol_version_id'),
                COALESCE(v_prov->'snapshot', '{}'::jsonb))
        RETURNING id INTO v_new_ep_id;
        UPDATE public.experiment_blocks SET content = content || jsonb_build_object('experiment_protocol_id', v_new_ep_id::text)
        WHERE experiment_id = p_experiment_id AND type = 'protocol' AND content->>'experiment_protocol_id' = v_ep_id::text;
      END IF;

      IF jsonb_typeof(v_prov->'deviations') = 'array' THEN
        FOR v_dev IN SELECT * FROM jsonb_array_elements(v_prov->'deviations') LOOP
          INSERT INTO public.protocol_deviations (experiment_protocol_id, step_index, original_value, actual_value, reason, created_by)
          VALUES (v_new_ep_id, (v_dev->>'step_index')::int, v_dev->>'original_value', v_dev->>'actual_value', v_dev->>'reason',
                  COALESCE(public._try_uuid(v_dev->>'created_by'), v_user_id))
          ON CONFLICT (experiment_protocol_id, step_index) DO NOTHING;
        END LOOP;
      END IF;
      v_ep_map := v_ep_map || jsonb_build_object(v_ep_id::text, v_new_ep_id::text);
    END LOOP;
  END IF;

  v_result := public._create_revision_internal(
    p_experiment_id, 'Restored from revision v' || v_rev.revision_number, 'restoration', v_user_id,
    jsonb_build_object('source_revision_id', v_rev.id, 'source_revision_number', v_rev.revision_number,
      'source_content_hash', v_rev.content_hash, 'source_schema_version', v_schema_version,
      'unresolved_tags', v_missing_tags, 'protocol_instance_map', v_ep_map));

  INSERT INTO public.audit_events (workspace_id, object_type, object_id, event_type, actor_id, revision_number, metadata)
  VALUES (v_exp.workspace_id, 'experiment', p_experiment_id, 'revision_restored', v_user_id,
    (v_result->>'revision_number')::int,
    jsonb_build_object('source_revision_id', v_rev.id, 'source_revision_number', v_rev.revision_number,
      'source_content_hash', v_rev.content_hash, 'source_schema_version', v_schema_version,
      'new_revision_id', v_result->>'revision_id', 'new_content_hash', v_result->>'content_hash',
      'unresolved_tags', v_missing_tags));

  RETURN v_result || jsonb_build_object('source_schema_version', v_schema_version, 'unresolved_tags', v_missing_tags);
END;
$function$;
REVOKE ALL ON FUNCTION public.restore_experiment_revision(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.restore_experiment_revision(uuid, uuid) TO authenticated;
