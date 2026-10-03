CREATE OR REPLACE FUNCTION public.create_amendment(p_experiment_id uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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

  -- FOR SHARE: source cannot change status/lock while we fork it.
  SELECT * INTO v_src FROM public.experiments WHERE id = p_experiment_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Experiment not found'; END IF;
  IF NOT public.is_workspace_editor(v_src.workspace_id) THEN
    RAISE EXCEPTION 'Not authorized to create amendment';
  END IF;
  IF v_src.status <> 'locked' OR NOT v_src.is_locked OR v_src.is_archived THEN
    RAISE EXCEPTION 'Only locked experiments can be amended';
  END IF;

  -- Exact signed revision is mandatory: fail closed without lineage.
  SELECT * INTO v_sig FROM public.signatures
   WHERE experiment_id = p_experiment_id AND experiment_revision_id IS NOT NULL
   ORDER BY signed_at DESC, id DESC LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Source has no signature bound to an exact revision';
  END IF;
  SELECT * INTO v_signed_rev FROM public.experiment_revisions
   WHERE id = v_sig.experiment_revision_id AND experiment_id = p_experiment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Signed revision not found for source experiment';
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

  -- Source blocks are immutable while locked (enforce_block_lock rejects all
  -- writes, including privileged ones), so they equal the signed content.
  INSERT INTO public.experiment_blocks (experiment_id, type, content, order_key, created_by, updated_by)
  SELECT v_new_id, type, content, order_key, v_user_id, v_user_id
  FROM public.experiment_blocks
  WHERE experiment_id = p_experiment_id
  ORDER BY order_key;

  PERFORM public._rewrite_blocks_for_copy(p_experiment_id, v_new_id, v_user_id);

  v_rev_result := public._create_revision_internal(
    v_new_id,
    'Amendment of ' || v_src.experiment_id || ': ' || p_reason,
    'created',
    v_user_id,
    jsonb_build_object(
      'source_experiment_id', p_experiment_id,
      'source_experiment_human_id', v_src.experiment_id,
      'amendment_reason', p_reason,
      'source_revision_id', v_signed_rev.id::text,
      'source_revision_number', v_signed_rev.revision_number,
      'source_content_hash', v_signed_rev.content_hash,
      'source_signature_id', v_sig.id::text
    )
  );

  INSERT INTO public.audit_events (
    workspace_id, object_type, object_id, event_type, actor_id, metadata
  ) VALUES (
    v_src.workspace_id, 'experiment', v_new_id, 'amendment_created', v_user_id,
    jsonb_build_object(
      'reason', p_reason,
      'source_experiment_id', p_experiment_id,
      'source_signature_id', v_sig.id,
      'source_revision_id', v_signed_rev.id
    )
  );

  RETURN jsonb_build_object(
    'id', v_new_id,
    'experiment_number', v_new_number,
    'experiment_id', v_new_human_id,
    'amended_from_id', p_experiment_id,
    'source_revision_id', v_signed_rev.id
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.create_amendment(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_amendment(uuid, text) TO authenticated;
