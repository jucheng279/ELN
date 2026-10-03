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

CREATE OR REPLACE FUNCTION public.resubmit_for_review(p_experiment_id uuid, p_review_id uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE v_user_id uuid; v_exp record; v_old_review record; v_rev jsonb; v_rev_id uuid; v_rev_num int; v_hash text; v_new_review_id uuid;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT * INTO v_exp FROM public.experiments WHERE id = p_experiment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Experiment not found'; END IF;
  IF v_exp.created_by != v_user_id THEN RAISE EXCEPTION 'Only the author can resubmit'; END IF;
  IF v_exp.status != 'changes_requested' THEN RAISE EXCEPTION 'Must be in changes_requested status'; END IF;
  SELECT * INTO v_old_review FROM public.reviews
    WHERE id = p_review_id AND experiment_id = p_experiment_id AND status = 'changes_requested' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Review that requested changes not found'; END IF;
  IF EXISTS (SELECT 1 FROM public.reviews r WHERE r.experiment_id = p_experiment_id
             AND (r.created_at, r.id) > (v_old_review.created_at, v_old_review.id)) THEN
    RAISE EXCEPTION 'Review is stale: a newer review exists' USING ERRCODE = '40001';
  END IF;
  v_rev := public._create_revision_internal(p_experiment_id, 'Resubmitted for review', 'resubmit', v_user_id, '{}'::jsonb);
  v_rev_id := (v_rev->>'revision_id')::uuid; v_rev_num := (v_rev->>'revision_number')::int; v_hash := v_rev->>'content_hash';
  INSERT INTO public.reviews (experiment_id, reviewer_id, status, revision_number, experiment_revision_id)
    VALUES (p_experiment_id, v_old_review.reviewer_id, 'pending', v_rev_num, v_rev_id) RETURNING id INTO v_new_review_id;
  UPDATE public.experiments SET status = 'in_review', updated_at = now() WHERE id = p_experiment_id;
  INSERT INTO public.notifications (user_id, type, title, body, experiment_id)
    VALUES (v_old_review.reviewer_id, 'review_resubmitted', 'Experiment resubmitted',
            'An experiment has been resubmitted for your review', p_experiment_id);
  INSERT INTO public.audit_events (workspace_id, object_type, object_id, event_type, actor_id, revision_number)
    VALUES (v_exp.workspace_id, 'experiment', p_experiment_id, 'resubmitted', v_user_id, v_rev_num);
  RETURN jsonb_build_object('review_id', v_new_review_id, 'revision_id', v_rev_id, 'revision_number', v_rev_num, 'content_hash', v_hash);
END;
$function$;

CREATE OR REPLACE FUNCTION public.sign_and_lock_experiment(p_experiment_id uuid, p_declaration text DEFAULT 'I hereby certify that the data and observations recorded in this experiment are accurate and complete to the best of my knowledge.'::text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE v_user_id uuid; v_exp record; v_review record; v_revision record; v_sig_id uuid; v_n int;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT public.can_sign_experiment(p_experiment_id) THEN RAISE EXCEPTION 'Not authorized to sign this experiment'; END IF;
  SELECT * INTO v_exp FROM public.experiments WHERE id = p_experiment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Experiment not found'; END IF;
  IF v_exp.status != 'approved' THEN RAISE EXCEPTION 'Experiment must be approved before signing'; END IF;
  -- The signable revision is the approval bound to the CURRENT revision; exactly one.
  SELECT count(*) INTO v_n FROM public.reviews
    WHERE experiment_id = p_experiment_id AND status = 'approved' AND revision_number = v_exp.current_revision;
  IF v_n != 1 THEN
    RAISE EXCEPTION 'No unique approval for the current revision' USING ERRCODE = '40001';
  END IF;
  SELECT * INTO v_review FROM public.reviews
    WHERE experiment_id = p_experiment_id AND status = 'approved' AND revision_number = v_exp.current_revision;
  IF EXISTS (SELECT 1 FROM public.reviews r WHERE r.experiment_id = p_experiment_id
             AND (r.created_at, r.id) > (v_review.created_at, v_review.id)) THEN
    RAISE EXCEPTION 'Approval is stale: a newer review exists' USING ERRCODE = '40001';
  END IF;
  SELECT * INTO v_revision FROM public.experiment_revisions
    WHERE id = v_review.experiment_revision_id AND experiment_id = p_experiment_id;
  IF NOT FOUND OR v_revision.revision_number != v_review.revision_number OR v_revision.content_hash IS NULL THEN
    RAISE EXCEPTION 'Approved revision binding is invalid' USING ERRCODE = '40001';
  END IF;
  INSERT INTO public.signatures (experiment_id, signer_id, revision_number, content_hash, declaration, experiment_revision_id)
    VALUES (p_experiment_id, v_user_id, v_revision.revision_number, v_revision.content_hash, p_declaration, v_revision.id)
    RETURNING id INTO v_sig_id;
  UPDATE public.experiments SET status = 'locked', is_locked = true, updated_at = now() WHERE id = p_experiment_id;
  INSERT INTO public.audit_events (workspace_id, object_type, object_id, event_type, actor_id, revision_number)
    VALUES (v_exp.workspace_id, 'experiment', p_experiment_id, 'signed_and_locked', v_user_id, v_revision.revision_number);
  RETURN jsonb_build_object('signature_id', v_sig_id, 'review_id', v_review.id, 'revision_id', v_revision.id,
    'revision_number', v_revision.revision_number, 'content_hash', v_revision.content_hash);
END;
$function$;

REVOKE ALL ON FUNCTION public.approve_experiment(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.request_experiment_changes(uuid, uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.resubmit_for_review(uuid, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.sign_and_lock_experiment(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_experiment(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.request_experiment_changes(uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resubmit_for_review(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sign_and_lock_experiment(uuid, text) TO authenticated;
