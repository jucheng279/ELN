/*
# Restore Canonical Review/Signature Contract

This corrective migration overrides the domain RPCs introduced in
20260928103040_integrity_closure_phase1_rls_and_lifecycle.sql which
regressed the scientifically-auditable review provenance model.

## Changes

1. **submit_for_review** — Creates a scientific revision via
   _create_revision_internal. Inserts a review row bound to the exact
   experiment_revision_id and revision_number. Uses real notification
   columns (no metadata/workspace_id). Returns review_id, revision_id,
   revision_number, content_hash.

2. **request_experiment_changes** — Pure workflow decision. Does NOT
   create a new scientific revision. Updates existing review to
   changes_requested. Sets experiment to changes_requested.

3. **resubmit_for_review** — Creates a NEW scientific revision (N+1).
   Creates a NEW review row (append-only; previous review untouched).
   New review bound to new experiment_revision_id. Uses notification
   type review_resubmitted (valid per current CHECK). Returns new
   review_id, revision_id, revision_number, content_hash.

4. **approve_experiment** — Pure workflow decision on the pending
   review. Does NOT create a new scientific revision. Uses notification
   type experiment_approved (valid per current CHECK).

5. **sign_and_lock_experiment** — Finds the most recent approved
   review, reads its exact experiment_revision_id. Signs that exact
   revision (revision_id, revision_number, content_hash). Does NOT
   create a new scientific revision. Signature row includes
   experiment_revision_id.

6. **Remove app.domain_action bypass** — The lifecycle transition
   trigger that depended on a user-settable GUC is dropped. Domain
   RPCs update status directly as SECURITY DEFINER without needing a
   magic session variable. RLS already prevents direct client writes.

7. **Revoke generate_experiment_id from authenticated** — Internal
   trigger function should not be client-callable.

## Security
- All domain RPCs remain SECURITY DEFINER with search_path = ''.
- Internal functions remain denied to authenticated/anon.
- generate_experiment_id revoked from authenticated.
*/

-- ────────────────────────────────────────────────────────────
-- 1. Drop the app.domain_action trigger mechanism
-- ────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS enforce_domain_status_transitions_trigger ON experiments;
DROP FUNCTION IF EXISTS public.enforce_domain_status_transitions();

-- ────────────────────────────────────────────────────────────
-- 2. Revoke generate_experiment_id from authenticated
-- ────────────────────────────────────────────────────────────
REVOKE EXECUTE ON FUNCTION public.generate_experiment_id() FROM authenticated;

-- ────────────────────────────────────────────────────────────
-- 3. submit_for_review — canonical version
-- ────────────────────────────────────────────────────────────
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

  -- Create scientific revision
  v_rev := public._create_revision_internal(
    p_experiment_id, 'Submitted for review', 'review_submit', v_user_id, NULL
  );
  v_rev_id  := (v_rev->>'revision_id')::uuid;
  v_rev_num := (v_rev->>'revision_number')::int;
  v_hash    := v_rev->>'content_hash';

  -- Create review bound to exact revision
  INSERT INTO public.reviews (
    experiment_id, reviewer_id, status, revision_number, experiment_revision_id
  ) VALUES (
    p_experiment_id, p_reviewer_id, 'pending', v_rev_num, v_rev_id
  ) RETURNING id INTO v_review_id;

  -- Update experiment status
  UPDATE public.experiments
    SET status = 'in_review', updated_at = now()
    WHERE id = p_experiment_id;

  -- Notification (real schema: user_id, type, title, body, experiment_id)
  INSERT INTO public.notifications (user_id, type, title, body, experiment_id)
    VALUES (p_reviewer_id, 'review_requested', 'Review requested',
            'You have been asked to review: ' || left(v_exp.title, 200),
            p_experiment_id);

  -- Audit
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

-- ────────────────────────────────────────────────────────────
-- 4. request_experiment_changes — no new revision
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.request_experiment_changes(
  p_experiment_id uuid,
  p_review_id     uuid,
  p_comment       text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $$
DECLARE
  v_user_id uuid;
  v_exp     record;
  v_review  record;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT * INTO v_exp FROM public.experiments
    WHERE id = p_experiment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Experiment not found'; END IF;
  IF v_exp.status != 'in_review' THEN
    RAISE EXCEPTION 'Experiment is not in review';
  END IF;

  SELECT * INTO v_review FROM public.reviews
    WHERE id = p_review_id AND experiment_id = p_experiment_id AND status = 'pending';
  IF NOT FOUND THEN RAISE EXCEPTION 'Pending review not found'; END IF;
  IF v_review.reviewer_id != v_user_id THEN
    RAISE EXCEPTION 'Not the assigned reviewer';
  END IF;

  -- Update existing review (workflow decision only)
  UPDATE public.reviews
    SET status = 'changes_requested',
        reviewed_at = now(),
        comment = p_comment
    WHERE id = p_review_id;

  -- Update experiment status
  UPDATE public.experiments
    SET status = 'changes_requested', updated_at = now()
    WHERE id = p_experiment_id;

  -- Notification
  INSERT INTO public.notifications (user_id, type, title, body, experiment_id)
    VALUES (v_exp.created_by, 'changes_requested', 'Changes requested',
            left(COALESCE(p_comment, 'The reviewer has requested changes.'), 200),
            p_experiment_id);

  -- Audit (reference the reviewed revision)
  INSERT INTO public.audit_events (
    workspace_id, object_type, object_id, event_type, actor_id, revision_number
  ) VALUES (
    v_exp.workspace_id, 'experiment', p_experiment_id,
    'changes_requested', v_user_id, v_review.revision_number
  );

  RETURN jsonb_build_object(
    'review_id', p_review_id,
    'status', 'changes_requested',
    'revision_number', v_review.revision_number
  );
END;
$$;

-- ────────────────────────────────────────────────────────────
-- 5. resubmit_for_review — new revision + new review row
-- ────────────────────────────────────────────────────────────
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

  -- Create new scientific revision
  v_rev := public._create_revision_internal(
    p_experiment_id, 'Resubmitted for review', 'resubmit', v_user_id, NULL
  );
  v_rev_id  := (v_rev->>'revision_id')::uuid;
  v_rev_num := (v_rev->>'revision_number')::int;
  v_hash    := v_rev->>'content_hash';

  -- Create NEW review row bound to new revision (append-only)
  INSERT INTO public.reviews (
    experiment_id, reviewer_id, status, revision_number, experiment_revision_id
  ) VALUES (
    p_experiment_id, v_old_review.reviewer_id, 'pending', v_rev_num, v_rev_id
  ) RETURNING id INTO v_new_review_id;

  -- Update experiment status
  UPDATE public.experiments
    SET status = 'in_review', updated_at = now()
    WHERE id = p_experiment_id;

  -- Notification (review_resubmitted is valid in current CHECK)
  INSERT INTO public.notifications (user_id, type, title, body, experiment_id)
    VALUES (v_old_review.reviewer_id, 'review_resubmitted',
            'Experiment resubmitted',
            'An experiment has been resubmitted for your review',
            p_experiment_id);

  -- Audit
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

-- ────────────────────────────────────────────────────────────
-- 6. approve_experiment — no new revision
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.approve_experiment(
  p_experiment_id uuid,
  p_review_id     uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $$
DECLARE
  v_user_id uuid;
  v_exp     record;
  v_review  record;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT * INTO v_exp FROM public.experiments
    WHERE id = p_experiment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Experiment not found'; END IF;
  IF v_exp.status != 'in_review' THEN
    RAISE EXCEPTION 'Experiment is not in review';
  END IF;

  SELECT * INTO v_review FROM public.reviews
    WHERE id = p_review_id AND experiment_id = p_experiment_id AND status = 'pending';
  IF NOT FOUND THEN RAISE EXCEPTION 'Pending review not found'; END IF;
  IF v_review.reviewer_id != v_user_id THEN
    RAISE EXCEPTION 'Not the assigned reviewer';
  END IF;

  -- Approve the review (workflow decision only)
  UPDATE public.reviews
    SET status = 'approved', reviewed_at = now()
    WHERE id = p_review_id;

  -- Update experiment status
  UPDATE public.experiments
    SET status = 'approved', updated_at = now()
    WHERE id = p_experiment_id;

  -- Notification (experiment_approved is valid in current CHECK)
  INSERT INTO public.notifications (user_id, type, title, body, experiment_id)
    VALUES (v_exp.created_by, 'experiment_approved', 'Experiment approved',
            'Your experiment has been approved',
            p_experiment_id);

  -- Audit (reference the review and its bound revision)
  INSERT INTO public.audit_events (
    workspace_id, object_type, object_id, event_type, actor_id, revision_number
  ) VALUES (
    v_exp.workspace_id, 'experiment', p_experiment_id,
    'approved', v_user_id, v_review.revision_number
  );

  RETURN jsonb_build_object(
    'review_id', p_review_id,
    'status', 'approved',
    'revision_number', v_review.revision_number,
    'experiment_revision_id', v_review.experiment_revision_id
  );
END;
$$;

-- ────────────────────────────────────────────────────────────
-- 7. sign_and_lock_experiment — binds approved revision
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.sign_and_lock_experiment(
  p_experiment_id uuid,
  p_declaration   text DEFAULT 'I hereby certify that the data and observations recorded in this experiment are accurate and complete to the best of my knowledge.'
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $$
DECLARE
  v_user_id  uuid;
  v_exp      record;
  v_review   record;
  v_revision record;
  v_sig_id   uuid;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  IF NOT public.can_sign_experiment(p_experiment_id) THEN
    RAISE EXCEPTION 'Not authorized to sign this experiment';
  END IF;

  SELECT * INTO v_exp FROM public.experiments
    WHERE id = p_experiment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Experiment not found'; END IF;
  IF v_exp.status != 'approved' THEN
    RAISE EXCEPTION 'Experiment must be approved before signing';
  END IF;

  -- Find the most recent approved review
  SELECT * INTO v_review FROM public.reviews
    WHERE experiment_id = p_experiment_id AND status = 'approved'
    ORDER BY created_at DESC LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No approved review found for this experiment';
  END IF;
  IF v_review.experiment_revision_id IS NULL THEN
    RAISE EXCEPTION 'Approved review has no bound revision';
  END IF;

  -- Fetch the exact approved revision
  SELECT * INTO v_revision FROM public.experiment_revisions
    WHERE id = v_review.experiment_revision_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Approved revision not found';
  END IF;

  -- Insert signature bound to exact approved revision
  INSERT INTO public.signatures (
    experiment_id, signer_id, revision_number,
    content_hash, declaration, experiment_revision_id
  ) VALUES (
    p_experiment_id, v_user_id, v_revision.revision_number,
    v_revision.content_hash, p_declaration, v_revision.id
  ) RETURNING id INTO v_sig_id;

  -- Lock the experiment
  UPDATE public.experiments
    SET status = 'locked', is_locked = true, updated_at = now()
    WHERE id = p_experiment_id;

  -- Audit
  INSERT INTO public.audit_events (
    workspace_id, object_type, object_id, event_type, actor_id, revision_number
  ) VALUES (
    v_exp.workspace_id, 'experiment', p_experiment_id,
    'signed_and_locked', v_user_id, v_revision.revision_number
  );

  RETURN jsonb_build_object(
    'signature_id', v_sig_id,
    'revision_id', v_revision.id,
    'revision_number', v_revision.revision_number,
    'content_hash', v_revision.content_hash
  );
END;
$$;

-- ────────────────────────────────────────────────────────────
-- 8. archive/restore RPCs without app.domain_action
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.archive_experiment_rpc(p_experiment_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE v_user_id uuid; v_exp record;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT * INTO v_exp FROM public.experiments WHERE id = p_experiment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Experiment not found'; END IF;
  IF NOT public.is_workspace_editor(v_exp.workspace_id) THEN RAISE EXCEPTION 'Not authorized'; END IF;
  IF v_exp.is_archived THEN RETURN; END IF;
  UPDATE public.experiments SET status = 'archived', is_archived = true, previous_status = v_exp.status, updated_at = now() WHERE id = p_experiment_id;
  INSERT INTO public.audit_events (workspace_id, object_type, object_id, event_type, actor_id, metadata)
    VALUES (v_exp.workspace_id, 'experiment', p_experiment_id, 'archived', v_user_id,
            jsonb_build_object('previous_status', v_exp.status, 'was_locked', v_exp.is_locked));
END;
$$;

CREATE OR REPLACE FUNCTION public.restore_experiment_rpc(p_experiment_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE v_user_id uuid; v_exp record; v_restore_status text;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT * INTO v_exp FROM public.experiments WHERE id = p_experiment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Experiment not found'; END IF;
  IF NOT public.is_workspace_editor(v_exp.workspace_id) THEN RAISE EXCEPTION 'Not authorized'; END IF;
  IF NOT v_exp.is_archived THEN RAISE EXCEPTION 'Experiment is not archived'; END IF;
  v_restore_status := COALESCE(v_exp.previous_status, 'draft');
  IF v_restore_status = 'archived' THEN v_restore_status := 'draft'; END IF;
  UPDATE public.experiments SET status = v_restore_status, is_archived = false, previous_status = NULL, updated_at = now() WHERE id = p_experiment_id;
  INSERT INTO public.audit_events (workspace_id, object_type, object_id, event_type, actor_id, metadata)
    VALUES (v_exp.workspace_id, 'experiment', p_experiment_id, 'restored', v_user_id,
            jsonb_build_object('restored_status', v_restore_status));
  RETURN jsonb_build_object('status', v_restore_status);
END;
$$;

-- ────────────────────────────────────────────────────────────
-- 9. Re-grant domain RPCs to authenticated
-- ────────────────────────────────────────────────────────────
GRANT EXECUTE ON FUNCTION public.submit_for_review(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_experiment(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.request_experiment_changes(uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resubmit_for_review(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sign_and_lock_experiment(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.archive_experiment_rpc(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.restore_experiment_rpc(uuid) TO authenticated;
