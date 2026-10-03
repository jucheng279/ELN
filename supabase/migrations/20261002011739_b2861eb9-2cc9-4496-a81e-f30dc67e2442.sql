-- Cycle 27: capability truth == action authorization.
-- 1) Reviewer decisions require the assigned reviewer to still be an eligible
--    (non-guest) workspace member, matching submit_for_review's eligibility rule.
-- 2) get_experiment_capabilities mirrors the exact Cycle 26 review/sign checks
--    and echoes the identity/state it was computed for.

CREATE OR REPLACE FUNCTION public.approve_experiment(p_experiment_id uuid, p_review_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE v_user_id uuid; v_exp record; v_review record; v_rev record;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT * INTO v_exp FROM public.experiments WHERE id = p_experiment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Experiment not found'; END IF;
  IF v_exp.status != 'in_review' THEN RAISE EXCEPTION 'Experiment is not in review'; END IF;
  SELECT * INTO v_review FROM public.reviews
    WHERE id = p_review_id AND experiment_id = p_experiment_id AND status = 'pending' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pending review not found'; END IF;
  IF v_review.reviewer_id != v_user_id THEN RAISE EXCEPTION 'Not the assigned reviewer'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.workspace_members wm
                 WHERE wm.workspace_id = v_exp.workspace_id AND wm.user_id = v_user_id
                   AND wm.role IN ('owner','admin','member')) THEN
    RAISE EXCEPTION 'Reviewer is no longer an eligible workspace member';
  END IF;
  SELECT * INTO v_rev FROM public.experiment_revisions
    WHERE id = v_review.experiment_revision_id AND experiment_id = p_experiment_id;
  IF NOT FOUND OR v_rev.revision_number != v_review.revision_number
     OR v_rev.revision_number != v_exp.current_revision THEN
    RAISE EXCEPTION 'Review is stale: it is not bound to the current revision' USING ERRCODE = '40001';
  END IF;
  UPDATE public.reviews SET status = 'approved', reviewed_at = now() WHERE id = p_review_id;
  UPDATE public.experiments SET status = 'approved', updated_at = now() WHERE id = p_experiment_id;
  INSERT INTO public.notifications (user_id, type, title, body, experiment_id)
    VALUES (v_exp.created_by, 'experiment_approved', 'Experiment approved', 'Your experiment has been approved', p_experiment_id);
  INSERT INTO public.audit_events (workspace_id, object_type, object_id, event_type, actor_id, revision_number)
    VALUES (v_exp.workspace_id, 'experiment', p_experiment_id, 'approved', v_user_id, v_review.revision_number);
  RETURN jsonb_build_object('review_id', p_review_id, 'status', 'approved',
    'revision_number', v_review.revision_number, 'experiment_revision_id', v_review.experiment_revision_id,
    'content_hash', v_rev.content_hash);
END;
$function$;

CREATE OR REPLACE FUNCTION public.request_experiment_changes(p_experiment_id uuid, p_review_id uuid, p_comment text DEFAULT NULL::text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE v_user_id uuid; v_exp record; v_review record; v_rev record;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT * INTO v_exp FROM public.experiments WHERE id = p_experiment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Experiment not found'; END IF;
  IF v_exp.status != 'in_review' THEN RAISE EXCEPTION 'Experiment is not in review'; END IF;
  SELECT * INTO v_review FROM public.reviews
    WHERE id = p_review_id AND experiment_id = p_experiment_id AND status = 'pending' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Pending review not found'; END IF;
  IF v_review.reviewer_id != v_user_id THEN RAISE EXCEPTION 'Not the assigned reviewer'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.workspace_members wm
                 WHERE wm.workspace_id = v_exp.workspace_id AND wm.user_id = v_user_id
                   AND wm.role IN ('owner','admin','member')) THEN
    RAISE EXCEPTION 'Reviewer is no longer an eligible workspace member';
  END IF;
  SELECT * INTO v_rev FROM public.experiment_revisions
    WHERE id = v_review.experiment_revision_id AND experiment_id = p_experiment_id;
  IF NOT FOUND OR v_rev.revision_number != v_review.revision_number
     OR v_rev.revision_number != v_exp.current_revision THEN
    RAISE EXCEPTION 'Review is stale: it is not bound to the current revision' USING ERRCODE = '40001';
  END IF;
  UPDATE public.reviews SET status = 'changes_requested', reviewed_at = now(), comment = p_comment WHERE id = p_review_id;
  UPDATE public.experiments SET status = 'changes_requested', updated_at = now() WHERE id = p_experiment_id;
  INSERT INTO public.notifications (user_id, type, title, body, experiment_id)
    VALUES (v_exp.created_by, 'changes_requested', 'Changes requested',
            left(COALESCE(p_comment, 'The reviewer has requested changes.'), 200), p_experiment_id);
  INSERT INTO public.audit_events (workspace_id, object_type, object_id, event_type, actor_id, revision_number)
    VALUES (v_exp.workspace_id, 'experiment', p_experiment_id, 'changes_requested', v_user_id, v_review.revision_number);
  RETURN jsonb_build_object('review_id', p_review_id, 'status', 'changes_requested',
    'revision_number', v_review.revision_number, 'experiment_revision_id', v_review.experiment_revision_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_experiment_capabilities(p_experiment_id uuid)
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE
  v_user_id uuid; v_exp record; v_role text;
  v_is_editor boolean; v_is_author boolean; v_is_mutable boolean;
  v_review_ok boolean := false; v_can_sign boolean := false;
  v_n int; v_appr record; v_none jsonb;
BEGIN
  v_user_id := auth.uid();
  v_none := jsonb_build_object(
      'can_edit_content', false, 'can_edit_metadata', false,
      'can_start', false, 'can_complete', false, 'can_reopen', false,
      'can_submit_review', false, 'can_review', false,
      'can_request_changes', false, 'can_approve', false,
      'can_sign', false, 'can_archive', false, 'can_restore', false,
      'can_restore_revision', false, 'can_create_amendment', false,
      'can_duplicate', false, 'can_comment', false, 'is_read_only', true,
      'experiment_id', p_experiment_id);
  IF v_user_id IS NULL THEN RETURN v_none || jsonb_build_object('role','anonymous'); END IF;

  SELECT e.* INTO v_exp FROM public.experiments e WHERE e.id = p_experiment_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', 'not_found'); END IF;

  SELECT wm.role INTO v_role FROM public.workspace_members wm
   WHERE wm.workspace_id = v_exp.workspace_id AND wm.user_id = v_user_id;
  IF v_role IS NULL THEN RETURN v_none || jsonb_build_object('role','none'); END IF;

  v_is_editor := v_role IN ('owner', 'admin', 'member');
  v_is_author := v_exp.created_by = v_user_id;
  v_is_mutable := v_exp.status IN ('draft', 'in_progress', 'changes_requested')
    AND NOT v_exp.is_locked AND NOT v_exp.is_archived;

  -- Mirrors approve_experiment/request_experiment_changes exactly.
  IF v_exp.status = 'in_review' AND v_is_editor THEN
    v_review_ok := EXISTS (
      SELECT 1 FROM public.reviews r
      JOIN public.experiment_revisions er
        ON er.id = r.experiment_revision_id AND er.experiment_id = r.experiment_id
      WHERE r.experiment_id = p_experiment_id AND r.status = 'pending'
        AND r.reviewer_id = v_user_id
        AND er.revision_number = r.revision_number
        AND er.revision_number = v_exp.current_revision);
  END IF;

  -- Mirrors sign_and_lock_experiment exactly.
  IF v_exp.status = 'approved' AND NOT v_exp.is_locked AND v_role IN ('owner','admin') THEN
    SELECT count(*) INTO v_n FROM public.reviews
     WHERE experiment_id = p_experiment_id AND status = 'approved' AND revision_number = v_exp.current_revision;
    IF v_n = 1 THEN
      SELECT * INTO v_appr FROM public.reviews
       WHERE experiment_id = p_experiment_id AND status = 'approved' AND revision_number = v_exp.current_revision;
      v_can_sign := NOT EXISTS (SELECT 1 FROM public.reviews r WHERE r.experiment_id = p_experiment_id
                                AND (r.created_at, r.id) > (v_appr.created_at, v_appr.id))
        AND EXISTS (SELECT 1 FROM public.experiment_revisions er
                    WHERE er.id = v_appr.experiment_revision_id AND er.experiment_id = p_experiment_id
                      AND er.revision_number = v_appr.revision_number AND er.content_hash IS NOT NULL);
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'can_edit_content', v_is_editor AND v_is_mutable,
    'can_edit_metadata', v_is_editor AND v_is_mutable,
    'can_start', v_is_editor AND v_exp.status = 'draft' AND NOT v_exp.is_locked AND NOT v_exp.is_archived,
    'can_complete', v_is_editor AND v_exp.status = 'in_progress' AND NOT v_exp.is_locked,
    'can_reopen', v_is_editor AND v_exp.status = 'completed' AND NOT v_exp.is_locked AND NOT v_exp.is_archived,
    'can_submit_review', v_is_editor AND v_is_author
      AND v_exp.status IN ('completed', 'changes_requested') AND NOT v_exp.is_locked AND NOT v_exp.is_archived,
    'can_review', v_review_ok,
    'can_request_changes', v_review_ok,
    'can_approve', v_review_ok,
    'can_sign', v_can_sign,
    'can_archive', v_is_editor AND NOT v_exp.is_archived AND NOT v_exp.is_locked,
    'can_restore', v_is_editor AND v_exp.is_archived,
    'can_restore_revision', v_is_editor AND v_is_mutable,
    'can_create_amendment', v_is_editor AND v_exp.is_locked AND v_exp.status = 'locked' AND NOT v_exp.is_archived,
    'can_duplicate', v_is_editor,
    'can_comment', v_role != 'guest',
    'is_read_only', NOT (v_is_editor AND v_is_mutable),
    'role', v_role,
    'experiment_id', p_experiment_id,
    'status', v_exp.status,
    'is_locked', v_exp.is_locked,
    'is_archived', v_exp.is_archived,
    'current_revision', v_exp.current_revision
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.approve_experiment(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.request_experiment_changes(uuid, uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_experiment_capabilities(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_experiment(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.request_experiment_changes(uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_experiment_capabilities(uuid) TO authenticated;
