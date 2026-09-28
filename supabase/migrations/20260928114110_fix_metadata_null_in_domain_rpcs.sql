/*
# Fix metadata NULL in domain RPCs

The _create_revision_internal function accepts p_metadata with default '{}'::jsonb,
but domain RPCs were passing explicit NULL which violates the NOT NULL constraint on
experiment_revisions.metadata. Fix all domain RPCs to pass '{}'::jsonb instead.
*/

-- Fix submit_for_review
CREATE OR REPLACE FUNCTION public.submit_for_review(
  p_experiment_id uuid,
  p_reviewer_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $$
DECLARE
  v_user_id  uuid;
  v_exp      record;
  v_reviewer record;
  v_rev      jsonb;
  v_rev_id   uuid;
  v_rev_num  int;
  v_hash     text;
  v_review_id uuid;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT * INTO v_exp FROM public.experiments
    WHERE id = p_experiment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Experiment not found'; END IF;
  IF v_exp.created_by != v_user_id THEN
    RAISE EXCEPTION 'Only the experiment author can submit for review';
  END IF;
  IF v_exp.status NOT IN ('completed', 'changes_requested') THEN
    RAISE EXCEPTION 'Experiment must be completed or have changes requested';
  END IF;
  IF v_exp.is_locked OR v_exp.is_archived THEN
    RAISE EXCEPTION 'Experiment is locked or archived';
  END IF;

  IF p_reviewer_id = v_user_id THEN
    RAISE EXCEPTION 'Cannot review your own experiment';
  END IF;
  SELECT wm.* INTO v_reviewer FROM public.workspace_members wm
    WHERE wm.workspace_id = v_exp.workspace_id AND wm.user_id = p_reviewer_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Reviewer is not a workspace member'; END IF;
  IF v_reviewer.role = 'guest' THEN RAISE EXCEPTION 'Guests cannot review'; END IF;

  v_rev := public._create_revision_internal(
    p_experiment_id, 'Submitted for review', 'review_submit', v_user_id, '{}'::jsonb
  );
  v_rev_id  := (v_rev->>'revision_id')::uuid;
  v_rev_num := (v_rev->>'revision_number')::int;
  v_hash    := v_rev->>'content_hash';

  INSERT INTO public.reviews (
    experiment_id, reviewer_id, status, revision_number, experiment_revision_id
  ) VALUES (
    p_experiment_id, p_reviewer_id, 'pending', v_rev_num, v_rev_id
  ) RETURNING id INTO v_review_id;

  UPDATE public.experiments
    SET status = 'in_review', updated_at = now()
    WHERE id = p_experiment_id;

  INSERT INTO public.notifications (user_id, type, title, body, experiment_id)
    VALUES (p_reviewer_id, 'review_requested', 'Review requested',
            'You have been asked to review: ' || left(v_exp.title, 200),
            p_experiment_id);

  INSERT INTO public.audit_events (
    workspace_id, object_type, object_id, event_type, actor_id, revision_number
  ) VALUES (
    v_exp.workspace_id, 'experiment', p_experiment_id,
    'submitted_for_review', v_user_id, v_rev_num
  );

  RETURN jsonb_build_object(
    'review_id', v_review_id,
    'revision_id', v_rev_id,
    'revision_number', v_rev_num,
    'content_hash', v_hash
  );
END;
$$;

-- Fix resubmit_for_review
DROP FUNCTION IF EXISTS public.resubmit_for_review(uuid, uuid);
CREATE FUNCTION public.resubmit_for_review(
  p_experiment_id uuid,
  p_review_id     uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $$
DECLARE
  v_user_id    uuid;
  v_exp        record;
  v_old_review record;
  v_rev        jsonb;
  v_rev_id     uuid;
  v_rev_num    int;
  v_hash       text;
  v_new_review_id uuid;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT * INTO v_exp FROM public.experiments
    WHERE id = p_experiment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Experiment not found'; END IF;
  IF v_exp.created_by != v_user_id THEN
    RAISE EXCEPTION 'Only the author can resubmit';
  END IF;
  IF v_exp.status != 'changes_requested' THEN
    RAISE EXCEPTION 'Must be in changes_requested status';
  END IF;

  SELECT * INTO v_old_review FROM public.reviews
    WHERE id = p_review_id AND experiment_id = p_experiment_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Review not found'; END IF;

  v_rev := public._create_revision_internal(
    p_experiment_id, 'Resubmitted for review', 'resubmit', v_user_id, '{}'::jsonb
  );
  v_rev_id  := (v_rev->>'revision_id')::uuid;
  v_rev_num := (v_rev->>'revision_number')::int;
  v_hash    := v_rev->>'content_hash';

  INSERT INTO public.reviews (
    experiment_id, reviewer_id, status, revision_number, experiment_revision_id
  ) VALUES (
    p_experiment_id, v_old_review.reviewer_id, 'pending', v_rev_num, v_rev_id
  ) RETURNING id INTO v_new_review_id;

  UPDATE public.experiments
    SET status = 'in_review', updated_at = now()
    WHERE id = p_experiment_id;

  INSERT INTO public.notifications (user_id, type, title, body, experiment_id)
    VALUES (v_old_review.reviewer_id, 'review_resubmitted',
            'Experiment resubmitted',
            'An experiment has been resubmitted for your review',
            p_experiment_id);

  INSERT INTO public.audit_events (
    workspace_id, object_type, object_id, event_type, actor_id, revision_number
  ) VALUES (
    v_exp.workspace_id, 'experiment', p_experiment_id,
    'resubmitted', v_user_id, v_rev_num
  );

  RETURN jsonb_build_object(
    'review_id', v_new_review_id,
    'revision_id', v_rev_id,
    'revision_number', v_rev_num,
    'content_hash', v_hash
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.submit_for_review(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resubmit_for_review(uuid, uuid) TO authenticated;
