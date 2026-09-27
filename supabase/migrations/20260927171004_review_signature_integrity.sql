-- 1. Add experiment_revision_id FK to reviews and signatures
ALTER TABLE public.reviews
  ADD COLUMN IF NOT EXISTS experiment_revision_id uuid REFERENCES public.experiment_revisions(id);

ALTER TABLE public.signatures
  ADD COLUMN IF NOT EXISTS experiment_revision_id uuid REFERENCES public.experiment_revisions(id);

-- 2. Canonical notification types
DO $$ BEGIN
  ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
  ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check
    CHECK (type IN (
      'mention','comment_reply','review_requested','review_resubmitted',
      'changes_requested','experiment_approved','experiment_signed',
      'permission_changed'
    ));
EXCEPTION WHEN others THEN NULL;
END $$;

-- 3. Permission helpers
CREATE OR REPLACE FUNCTION public.can_edit_experiment(p_experiment_id uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_exp record;
BEGIN
  IF auth.uid() IS NULL THEN RETURN false; END IF;
  SELECT workspace_id, is_locked INTO v_exp FROM public.experiments WHERE id = p_experiment_id;
  IF NOT FOUND OR v_exp.is_locked THEN RETURN false; END IF;
  RETURN public.is_workspace_editor(v_exp.workspace_id);
END; $$;

CREATE OR REPLACE FUNCTION public.can_sign_experiment(p_experiment_id uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_exp record; v_role text;
BEGIN
  IF auth.uid() IS NULL THEN RETURN false; END IF;
  SELECT workspace_id, status INTO v_exp FROM public.experiments WHERE id = p_experiment_id;
  IF NOT FOUND OR v_exp.status != 'approved' THEN RETURN false; END IF;
  SELECT role INTO v_role FROM public.workspace_members
    WHERE workspace_id = v_exp.workspace_id AND user_id = auth.uid();
  RETURN v_role IN ('owner', 'admin');
END; $$;

-- 4. Rewrite submit_for_review to validate reviewer, prevent self-review, bind revision ID
CREATE OR REPLACE FUNCTION public.submit_for_review(
  p_experiment_id uuid,
  p_reviewer_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_user_id uuid; v_experiment record; v_rev_result jsonb;
  v_reviewer_role text; v_revision_id uuid; v_review_id uuid;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT * INTO v_experiment FROM public.experiments WHERE id = p_experiment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Experiment not found'; END IF;
  IF NOT public.is_workspace_editor(v_experiment.workspace_id) THEN
    RAISE EXCEPTION 'Not authorized to submit for review';
  END IF;
  IF v_experiment.status NOT IN ('completed', 'changes_requested') THEN
    RAISE EXCEPTION 'Experiment must be completed or have changes requested to submit for review';
  END IF;

  -- Validate reviewer
  IF p_reviewer_id = v_user_id THEN RAISE EXCEPTION 'Cannot review your own experiment'; END IF;
  SELECT role INTO v_reviewer_role FROM public.workspace_members
    WHERE workspace_id = v_experiment.workspace_id AND user_id = p_reviewer_id;
  IF v_reviewer_role IS NULL THEN RAISE EXCEPTION 'Reviewer is not a workspace member'; END IF;
  IF v_reviewer_role = 'guest' THEN RAISE EXCEPTION 'Guest members cannot review'; END IF;

  v_rev_result := public.create_revision(p_experiment_id, 'Submitted for review', 'review_submit');
  v_revision_id := (v_rev_result->>'revision_id')::uuid;

  UPDATE public.experiments SET status = 'in_review' WHERE id = p_experiment_id;

  INSERT INTO public.reviews (experiment_id, reviewer_id, revision_number, experiment_revision_id, status)
  VALUES (p_experiment_id, p_reviewer_id, (v_rev_result->>'revision_number')::int, v_revision_id, 'pending')
  RETURNING id INTO v_review_id;

  INSERT INTO public.audit_events (workspace_id, object_type, object_id, event_type, actor_id, revision_number, metadata)
  VALUES (v_experiment.workspace_id, 'experiment', p_experiment_id, 'review_submitted', v_user_id,
          (v_rev_result->>'revision_number')::int, jsonb_build_object('reviewer_id', p_reviewer_id, 'revision_id', v_revision_id));

  INSERT INTO public.notifications (user_id, type, title, body, experiment_id)
  VALUES (p_reviewer_id, 'review_requested', 'Review requested',
          'You have been asked to review ' || v_experiment.experiment_id, p_experiment_id);

  RETURN jsonb_build_object('review_id', v_review_id, 'revision_id', v_revision_id,
    'revision_number', (v_rev_result->>'revision_number')::int, 'content_hash', v_rev_result->>'content_hash');
END; $$;

-- 5. Rewrite approve to validate experiment binding and use revision ID
CREATE OR REPLACE FUNCTION public.approve_experiment(
  p_experiment_id uuid, p_review_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_user_id uuid; v_experiment record; v_review record;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT * INTO v_review FROM public.reviews WHERE id = p_review_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Review not found'; END IF;
  IF v_review.experiment_id != p_experiment_id THEN RAISE EXCEPTION 'Review does not belong to this experiment'; END IF;
  IF v_review.reviewer_id != v_user_id THEN RAISE EXCEPTION 'Not the assigned reviewer'; END IF;
  IF v_review.status != 'pending' THEN RAISE EXCEPTION 'Review already decided'; END IF;

  SELECT * INTO v_experiment FROM public.experiments WHERE id = p_experiment_id FOR UPDATE;
  IF v_experiment.status != 'in_review' THEN RAISE EXCEPTION 'Experiment is not in review'; END IF;

  UPDATE public.reviews SET status = 'approved', reviewed_at = now() WHERE id = p_review_id;
  UPDATE public.experiments SET status = 'approved' WHERE id = p_experiment_id;

  INSERT INTO public.audit_events (workspace_id, object_type, object_id, event_type, actor_id, revision_number, metadata)
  VALUES (v_experiment.workspace_id, 'experiment', p_experiment_id, 'approved', v_user_id, v_review.revision_number,
          jsonb_build_object('review_id', p_review_id, 'revision_id', v_review.experiment_revision_id));

  INSERT INTO public.notifications (user_id, type, title, body, experiment_id)
  VALUES (v_experiment.created_by, 'experiment_approved', 'Experiment approved',
          v_experiment.experiment_id || ' has been approved', p_experiment_id);

  RETURN jsonb_build_object('status', 'approved', 'revision_id', v_review.experiment_revision_id);
END; $$;

-- 6. Rewrite request_changes with experiment binding check
CREATE OR REPLACE FUNCTION public.request_experiment_changes(
  p_experiment_id uuid, p_review_id uuid, p_comment text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_user_id uuid; v_experiment record; v_review record;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT * INTO v_review FROM public.reviews WHERE id = p_review_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Review not found'; END IF;
  IF v_review.experiment_id != p_experiment_id THEN RAISE EXCEPTION 'Review does not belong to this experiment'; END IF;
  IF v_review.reviewer_id != v_user_id THEN RAISE EXCEPTION 'Not the assigned reviewer'; END IF;
  IF v_review.status != 'pending' THEN RAISE EXCEPTION 'Review already decided'; END IF;

  SELECT * INTO v_experiment FROM public.experiments WHERE id = p_experiment_id FOR UPDATE;
  IF v_experiment.status != 'in_review' THEN RAISE EXCEPTION 'Experiment is not in review'; END IF;

  UPDATE public.reviews SET status = 'changes_requested', comment = p_comment, reviewed_at = now() WHERE id = p_review_id;
  UPDATE public.experiments SET status = 'changes_requested' WHERE id = p_experiment_id;

  INSERT INTO public.audit_events (workspace_id, object_type, object_id, event_type, actor_id, revision_number, metadata)
  VALUES (v_experiment.workspace_id, 'experiment', p_experiment_id, 'changes_requested', v_user_id, v_review.revision_number,
          jsonb_build_object('comment', p_comment, 'review_id', p_review_id));

  INSERT INTO public.notifications (user_id, type, title, body, experiment_id)
  VALUES (v_experiment.created_by, 'changes_requested', 'Changes requested',
          'Changes have been requested on ' || v_experiment.experiment_id, p_experiment_id);

  RETURN jsonb_build_object('status', 'changes_requested');
END; $$;

-- 7. Resubmit for review RPC (new)
CREATE OR REPLACE FUNCTION public.resubmit_for_review(
  p_experiment_id uuid, p_review_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_user_id uuid; v_experiment record; v_review record;
  v_rev_result jsonb; v_new_revision_id uuid; v_new_review_id uuid;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT * INTO v_experiment FROM public.experiments WHERE id = p_experiment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Experiment not found'; END IF;
  IF v_experiment.status != 'changes_requested' THEN
    RAISE EXCEPTION 'Can only resubmit when changes were requested';
  END IF;
  IF NOT public.is_workspace_editor(v_experiment.workspace_id) THEN
    RAISE EXCEPTION 'Not authorized to resubmit';
  END IF;

  SELECT * INTO v_review FROM public.reviews WHERE id = p_review_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Original review not found'; END IF;
  IF v_review.experiment_id != p_experiment_id THEN RAISE EXCEPTION 'Review does not belong to this experiment'; END IF;

  v_rev_result := public.create_revision(p_experiment_id, 'Resubmitted for review', 'review_submit');
  v_new_revision_id := (v_rev_result->>'revision_id')::uuid;

  UPDATE public.experiments SET status = 'in_review' WHERE id = p_experiment_id;

  -- Create NEW review record preserving history; original review stays as-is
  INSERT INTO public.reviews (experiment_id, reviewer_id, revision_number, experiment_revision_id, status)
  VALUES (p_experiment_id, v_review.reviewer_id, (v_rev_result->>'revision_number')::int, v_new_revision_id, 'pending')
  RETURNING id INTO v_new_review_id;

  INSERT INTO public.audit_events (workspace_id, object_type, object_id, event_type, actor_id, revision_number, metadata)
  VALUES (v_experiment.workspace_id, 'experiment', p_experiment_id, 'review_resubmitted', v_user_id,
          (v_rev_result->>'revision_number')::int,
          jsonb_build_object('previous_review_id', p_review_id, 'new_review_id', v_new_review_id, 'revision_id', v_new_revision_id));

  INSERT INTO public.notifications (user_id, type, title, body, experiment_id)
  VALUES (v_review.reviewer_id, 'review_resubmitted', 'Experiment resubmitted',
          v_experiment.experiment_id || ' has been resubmitted for review', p_experiment_id);

  RETURN jsonb_build_object('review_id', v_new_review_id, 'revision_id', v_new_revision_id,
    'revision_number', (v_rev_result->>'revision_number')::int);
END; $$;

-- 8. Rewrite sign_and_lock to sign the EXACT approved revision, check can_sign
CREATE OR REPLACE FUNCTION public.sign_and_lock_experiment(
  p_experiment_id uuid,
  p_declaration text DEFAULT 'I hereby certify that the data and observations recorded in this experiment are accurate and complete to the best of my knowledge.'
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_user_id uuid; v_experiment record;
  v_approved_review record; v_approved_revision record; v_sig_id uuid;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  IF NOT public.can_sign_experiment(p_experiment_id) THEN
    RAISE EXCEPTION 'Not authorized to sign this experiment';
  END IF;

  SELECT * INTO v_experiment FROM public.experiments WHERE id = p_experiment_id FOR UPDATE;
  IF v_experiment.status != 'approved' THEN RAISE EXCEPTION 'Experiment must be approved before signing'; END IF;

  -- Find the approved review to get the exact revision
  SELECT * INTO v_approved_review FROM public.reviews
    WHERE experiment_id = p_experiment_id AND status = 'approved'
    ORDER BY created_at DESC LIMIT 1;
  IF NOT FOUND OR v_approved_review.experiment_revision_id IS NULL THEN
    RAISE EXCEPTION 'No approved review with a bound revision found';
  END IF;

  SELECT * INTO v_approved_revision FROM public.experiment_revisions
    WHERE id = v_approved_review.experiment_revision_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Approved revision not found'; END IF;

  INSERT INTO public.signatures (experiment_id, signer_id, revision_number, experiment_revision_id, content_hash, declaration)
  VALUES (p_experiment_id, v_user_id, v_approved_revision.revision_number, v_approved_revision.id, v_approved_revision.content_hash, p_declaration)
  RETURNING id INTO v_sig_id;

  UPDATE public.experiments SET status = 'locked', is_locked = true WHERE id = p_experiment_id;

  INSERT INTO public.audit_events (workspace_id, object_type, object_id, event_type, actor_id, revision_number, metadata)
  VALUES (v_experiment.workspace_id, 'experiment', p_experiment_id, 'signed_and_locked', v_user_id, v_approved_revision.revision_number,
          jsonb_build_object('signature_id', v_sig_id, 'content_hash', v_approved_revision.content_hash, 'revision_id', v_approved_revision.id));

  INSERT INTO public.notifications (user_id, type, title, body, experiment_id)
  VALUES (v_experiment.created_by, 'experiment_signed', 'Experiment signed and locked',
          v_experiment.experiment_id || ' has been signed and locked', p_experiment_id);

  RETURN jsonb_build_object('signature_id', v_sig_id, 'revision_number', v_approved_revision.revision_number,
    'revision_id', v_approved_revision.id, 'content_hash', v_approved_revision.content_hash);
END; $$;

-- 9. Fix create_revision to require edit permission, not just membership
CREATE OR REPLACE FUNCTION public.create_revision(
  p_experiment_id uuid,
  p_change_summary text DEFAULT NULL,
  p_change_type text DEFAULT 'content_edit'
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_user_id uuid; v_experiment record; v_next_rev int;
  v_snapshot jsonb; v_hash text; v_revision_id uuid;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT e.* INTO v_experiment FROM public.experiments e WHERE e.id = p_experiment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Experiment not found'; END IF;

  IF NOT public.is_workspace_editor(v_experiment.workspace_id) THEN
    RAISE EXCEPTION 'Not authorized to create revisions';
  END IF;
  IF v_experiment.is_locked THEN RAISE EXCEPTION 'Experiment is locked'; END IF;

  SELECT COALESCE(MAX(revision_number), 0) + 1 INTO v_next_rev
    FROM public.experiment_revisions WHERE experiment_id = p_experiment_id;

  SELECT jsonb_build_object(
    'experiment_id', v_experiment.experiment_id,
    'title', v_experiment.title,
    'status', v_experiment.status,
    'experiment_date', v_experiment.experiment_date,
    'template_id', v_experiment.template_id,
    'template_version_id', v_experiment.template_version_id,
    'blocks', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', b.id, 'type', b.type, 'content', b.content, 'order_key', b.order_key) ORDER BY b.order_key)
      FROM public.experiment_blocks b WHERE b.experiment_id = p_experiment_id
    ), '[]'::jsonb),
    'tags', COALESCE((
      SELECT jsonb_agg(t.name ORDER BY t.name)
      FROM public.experiment_tags et JOIN public.tags t ON t.id = et.tag_id WHERE et.experiment_id = p_experiment_id
    ), '[]'::jsonb),
    'protocols', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('protocol_id', ep.protocol_id, 'version_id', ep.protocol_version_id, 'snapshot', ep.snapshot))
      FROM public.experiment_protocols ep WHERE ep.experiment_id = p_experiment_id
    ), '[]'::jsonb),
    'attachments', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', a.id, 'filename', a.original_filename, 'storage_path', a.storage_path,
        'mime_type', a.mime_type, 'file_size', a.file_size, 'checksum', a.checksum, 'version', a.current_version))
      FROM public.attachments a WHERE a.experiment_id = p_experiment_id AND NOT a.is_archived
    ), '[]'::jsonb)
  ) INTO v_snapshot;

  v_hash := encode(digest(v_snapshot::text, 'sha256'), 'hex');

  INSERT INTO public.experiment_revisions (experiment_id, revision_number, snapshot, content_hash, change_summary, change_type, created_by)
  VALUES (p_experiment_id, v_next_rev, v_snapshot, v_hash, p_change_summary, p_change_type, v_user_id)
  RETURNING id INTO v_revision_id;

  UPDATE public.experiments SET current_revision = v_next_rev WHERE id = p_experiment_id;

  RETURN jsonb_build_object('revision_id', v_revision_id, 'revision_number', v_next_rev, 'content_hash', v_hash);
END; $$;
