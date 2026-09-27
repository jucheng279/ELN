/*
# Create Storage Bucket + Domain RPCs

## 1. Storage
- Create private `eln-files` bucket for scientific file storage
- Add storage policies for workspace-scoped file access

## 2. Domain RPCs (SECURITY DEFINER, transactional)
- `create_revision(p_experiment_id, p_change_summary, p_change_type)` — server-side atomic revision creation with sequential numbering
- `submit_for_review(p_experiment_id, p_reviewer_id)` — atomic: flush revision + create review + status change + audit + notification
- `approve_experiment(p_experiment_id, p_review_id)` — atomic: update review + status + audit + notification
- `request_experiment_changes(p_experiment_id, p_review_id, p_comment)` — atomic review decision
- `sign_and_lock_experiment(p_experiment_id)` — server-side hash, signature, lock, audit
- `create_amendment(p_experiment_id, p_reason)` — controlled amendment from locked state

## 3. Fix invitation acceptance
- `accept_invitation` now verifies email matches

## 4. Security
- All RPCs use SECURITY DEFINER with empty search_path
- All validate auth.uid() server-side
- Revision numbers are server-computed with row-level locking
*/

-- ============================================================
-- 1. STORAGE BUCKET
-- ============================================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('eln-files', 'eln-files', false, 104857600, NULL)
ON CONFLICT (id) DO NOTHING;

-- Storage policies: workspace members can access their workspace files
DROP POLICY IF EXISTS "Workspace members can upload files" ON storage.objects;
CREATE POLICY "Workspace members can upload files"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'eln-files'
  AND (storage.foldername(name))[1] IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM public.workspace_members wm
    WHERE wm.workspace_id = ((storage.foldername(name))[1])::uuid
    AND wm.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "Workspace members can read files" ON storage.objects;
CREATE POLICY "Workspace members can read files"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'eln-files'
  AND EXISTS (
    SELECT 1 FROM public.workspace_members wm
    WHERE wm.workspace_id = ((storage.foldername(name))[1])::uuid
    AND wm.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "Workspace members can delete files" ON storage.objects;
CREATE POLICY "Workspace members can delete files"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'eln-files'
  AND EXISTS (
    SELECT 1 FROM public.workspace_members wm
    WHERE wm.workspace_id = ((storage.foldername(name))[1])::uuid
    AND wm.user_id = auth.uid()
    AND wm.role IN ('owner', 'admin', 'member')
  )
);

-- ============================================================
-- 2. CREATE REVISION RPC (server-side, sequential, locked)
-- ============================================================
CREATE OR REPLACE FUNCTION public.create_revision(
  p_experiment_id uuid,
  p_change_summary text DEFAULT NULL,
  p_change_type text DEFAULT 'content_edit'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid;
  v_experiment record;
  v_next_rev int;
  v_snapshot jsonb;
  v_hash text;
  v_revision_id uuid;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Lock experiment row to prevent concurrent revision creation
  SELECT e.*, w.name as workspace_name
  INTO v_experiment
  FROM public.experiments e
  JOIN public.workspaces w ON w.id = e.workspace_id
  WHERE e.id = p_experiment_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Experiment not found';
  END IF;

  -- Verify membership
  IF NOT public.is_workspace_member(v_experiment.workspace_id) THEN
    RAISE EXCEPTION 'Not a workspace member';
  END IF;

  IF v_experiment.is_locked THEN
    RAISE EXCEPTION 'Experiment is locked';
  END IF;

  -- Compute next revision number
  SELECT COALESCE(MAX(revision_number), 0) + 1
  INTO v_next_rev
  FROM public.experiment_revisions
  WHERE experiment_id = p_experiment_id;

  -- Build snapshot from current blocks
  SELECT jsonb_build_object(
    'experiment_id', v_experiment.experiment_id,
    'title', v_experiment.title,
    'status', v_experiment.status,
    'experiment_date', v_experiment.experiment_date,
    'template_id', v_experiment.template_id,
    'template_version_id', v_experiment.template_version_id,
    'blocks', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', b.id,
          'type', b.type,
          'content', b.content,
          'order_key', b.order_key
        ) ORDER BY b.order_key
      )
      FROM public.experiment_blocks b
      WHERE b.experiment_id = p_experiment_id
    ), '[]'::jsonb),
    'tags', COALESCE((
      SELECT jsonb_agg(t.name ORDER BY t.name)
      FROM public.experiment_tags et
      JOIN public.tags t ON t.id = et.tag_id
      WHERE et.experiment_id = p_experiment_id
    ), '[]'::jsonb)
  )
  INTO v_snapshot;

  -- Compute deterministic hash
  v_hash := encode(digest(v_snapshot::text, 'sha256'), 'hex');

  -- Insert revision
  INSERT INTO public.experiment_revisions (
    experiment_id, revision_number, snapshot, content_hash,
    change_summary, change_type, created_by
  ) VALUES (
    p_experiment_id, v_next_rev, v_snapshot, v_hash,
    p_change_summary, p_change_type, v_user_id
  )
  RETURNING id INTO v_revision_id;

  -- Update experiment current_revision
  UPDATE public.experiments
  SET current_revision = v_next_rev
  WHERE id = p_experiment_id;

  RETURN jsonb_build_object(
    'revision_id', v_revision_id,
    'revision_number', v_next_rev,
    'content_hash', v_hash
  );
END;
$$;

-- ============================================================
-- 3. SUBMIT FOR REVIEW RPC
-- ============================================================
CREATE OR REPLACE FUNCTION public.submit_for_review(
  p_experiment_id uuid,
  p_reviewer_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid;
  v_experiment record;
  v_rev_result jsonb;
  v_review_id uuid;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO v_experiment
  FROM public.experiments
  WHERE id = p_experiment_id
  FOR UPDATE;

  IF NOT FOUND THEN RAISE EXCEPTION 'Experiment not found'; END IF;
  IF NOT public.is_workspace_editor(v_experiment.workspace_id) THEN
    RAISE EXCEPTION 'Not authorized to submit for review';
  END IF;
  IF v_experiment.status NOT IN ('completed', 'changes_requested') THEN
    RAISE EXCEPTION 'Experiment must be completed or have changes requested to submit for review';
  END IF;

  -- Create immutable revision
  v_rev_result := public.create_revision(p_experiment_id, 'Submitted for review', 'review_submit');

  -- Update status
  UPDATE public.experiments SET status = 'in_review' WHERE id = p_experiment_id;

  -- Create review record
  INSERT INTO public.reviews (experiment_id, reviewer_id, revision_number, status)
  VALUES (p_experiment_id, p_reviewer_id, (v_rev_result->>'revision_number')::int, 'pending')
  RETURNING id INTO v_review_id;

  -- Audit
  INSERT INTO public.audit_events (workspace_id, object_type, object_id, event_type, actor_id, revision_number, metadata)
  VALUES (v_experiment.workspace_id, 'experiment', p_experiment_id, 'review_submitted', v_user_id,
          (v_rev_result->>'revision_number')::int,
          jsonb_build_object('reviewer_id', p_reviewer_id));

  -- Notify reviewer
  INSERT INTO public.notifications (user_id, type, title, body, experiment_id)
  VALUES (p_reviewer_id, 'review_requested', 'Review requested',
          'You have been asked to review ' || v_experiment.experiment_id, p_experiment_id);

  RETURN jsonb_build_object(
    'review_id', v_review_id,
    'revision_number', (v_rev_result->>'revision_number')::int,
    'content_hash', v_rev_result->>'content_hash'
  );
END;
$$;

-- ============================================================
-- 4. APPROVE EXPERIMENT RPC
-- ============================================================
CREATE OR REPLACE FUNCTION public.approve_experiment(
  p_experiment_id uuid,
  p_review_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid;
  v_experiment record;
  v_review record;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT * INTO v_review FROM public.reviews WHERE id = p_review_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Review not found'; END IF;
  IF v_review.reviewer_id != v_user_id THEN RAISE EXCEPTION 'Not the assigned reviewer'; END IF;
  IF v_review.status != 'pending' THEN RAISE EXCEPTION 'Review already decided'; END IF;

  SELECT * INTO v_experiment FROM public.experiments WHERE id = p_experiment_id FOR UPDATE;
  IF v_experiment.status != 'in_review' THEN RAISE EXCEPTION 'Experiment is not in review'; END IF;

  UPDATE public.reviews SET status = 'approved', reviewed_at = now() WHERE id = p_review_id;
  UPDATE public.experiments SET status = 'approved' WHERE id = p_experiment_id;

  INSERT INTO public.audit_events (workspace_id, object_type, object_id, event_type, actor_id, revision_number, metadata)
  VALUES (v_experiment.workspace_id, 'experiment', p_experiment_id, 'approved', v_user_id, v_review.revision_number, '{}'::jsonb);

  INSERT INTO public.notifications (user_id, type, title, body, experiment_id)
  VALUES (v_experiment.created_by, 'review_completed', 'Experiment approved',
          v_experiment.experiment_id || ' has been approved', p_experiment_id);

  RETURN jsonb_build_object('status', 'approved');
END;
$$;

-- ============================================================
-- 5. REQUEST CHANGES RPC
-- ============================================================
CREATE OR REPLACE FUNCTION public.request_experiment_changes(
  p_experiment_id uuid,
  p_review_id uuid,
  p_comment text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid;
  v_experiment record;
  v_review record;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT * INTO v_review FROM public.reviews WHERE id = p_review_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Review not found'; END IF;
  IF v_review.reviewer_id != v_user_id THEN RAISE EXCEPTION 'Not the assigned reviewer'; END IF;
  IF v_review.status != 'pending' THEN RAISE EXCEPTION 'Review already decided'; END IF;

  SELECT * INTO v_experiment FROM public.experiments WHERE id = p_experiment_id FOR UPDATE;
  IF v_experiment.status != 'in_review' THEN RAISE EXCEPTION 'Experiment is not in review'; END IF;

  UPDATE public.reviews SET status = 'changes_requested', comment = p_comment, reviewed_at = now() WHERE id = p_review_id;
  UPDATE public.experiments SET status = 'changes_requested' WHERE id = p_experiment_id;

  INSERT INTO public.audit_events (workspace_id, object_type, object_id, event_type, actor_id, revision_number, metadata)
  VALUES (v_experiment.workspace_id, 'experiment', p_experiment_id, 'changes_requested', v_user_id, v_review.revision_number,
          jsonb_build_object('comment', p_comment));

  INSERT INTO public.notifications (user_id, type, title, body, experiment_id)
  VALUES (v_experiment.created_by, 'changes_requested', 'Changes requested',
          'Changes have been requested on ' || v_experiment.experiment_id, p_experiment_id);

  RETURN jsonb_build_object('status', 'changes_requested');
END;
$$;

-- ============================================================
-- 6. SIGN AND LOCK RPC (server-side hash + signature)
-- ============================================================
CREATE OR REPLACE FUNCTION public.sign_and_lock_experiment(
  p_experiment_id uuid,
  p_declaration text DEFAULT 'I hereby certify that the data and observations recorded in this experiment are accurate and complete to the best of my knowledge.'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid;
  v_experiment record;
  v_latest_rev record;
  v_sig_id uuid;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT * INTO v_experiment FROM public.experiments WHERE id = p_experiment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Experiment not found'; END IF;
  IF v_experiment.status != 'approved' THEN RAISE EXCEPTION 'Experiment must be approved before signing'; END IF;

  IF NOT public.is_workspace_editor(v_experiment.workspace_id) THEN
    RAISE EXCEPTION 'Not authorized to sign';
  END IF;

  -- Get latest revision (the approved one)
  SELECT * INTO v_latest_rev
  FROM public.experiment_revisions
  WHERE experiment_id = p_experiment_id
  ORDER BY revision_number DESC LIMIT 1;

  IF NOT FOUND THEN RAISE EXCEPTION 'No revision to sign'; END IF;

  -- Create signature using server-side revision hash
  INSERT INTO public.signatures (experiment_id, signer_id, revision_number, content_hash, declaration)
  VALUES (p_experiment_id, v_user_id, v_latest_rev.revision_number, v_latest_rev.content_hash, p_declaration)
  RETURNING id INTO v_sig_id;

  -- Lock the experiment
  UPDATE public.experiments SET status = 'locked', is_locked = true WHERE id = p_experiment_id;

  INSERT INTO public.audit_events (workspace_id, object_type, object_id, event_type, actor_id, revision_number, metadata)
  VALUES (v_experiment.workspace_id, 'experiment', p_experiment_id, 'signed_and_locked', v_user_id, v_latest_rev.revision_number,
          jsonb_build_object('signature_id', v_sig_id, 'content_hash', v_latest_rev.content_hash));

  INSERT INTO public.notifications (user_id, type, title, body, experiment_id)
  VALUES (v_experiment.created_by, 'experiment_signed', 'Experiment signed and locked',
          v_experiment.experiment_id || ' has been signed and locked', p_experiment_id);

  RETURN jsonb_build_object(
    'signature_id', v_sig_id,
    'revision_number', v_latest_rev.revision_number,
    'content_hash', v_latest_rev.content_hash
  );
END;
$$;

-- ============================================================
-- 7. CREATE AMENDMENT RPC
-- ============================================================
CREATE OR REPLACE FUNCTION public.create_amendment(
  p_experiment_id uuid,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid;
  v_experiment record;
  v_rev_result jsonb;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT * INTO v_experiment FROM public.experiments WHERE id = p_experiment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Experiment not found'; END IF;
  IF v_experiment.status != 'locked' THEN RAISE EXCEPTION 'Only locked experiments can be amended'; END IF;

  IF NOT public.is_workspace_editor(v_experiment.workspace_id) THEN
    RAISE EXCEPTION 'Not authorized to create amendment';
  END IF;

  -- Create amendment revision BEFORE unlocking (while still locked, captures locked state)
  -- We temporarily allow this by unlocking first in a controlled way
  UPDATE public.experiments SET is_locked = false WHERE id = p_experiment_id;

  v_rev_result := public.create_revision(p_experiment_id, 'Amendment: ' || p_reason, 'amendment');

  -- Set to in_progress for editing
  UPDATE public.experiments SET status = 'in_progress' WHERE id = p_experiment_id;

  INSERT INTO public.audit_events (workspace_id, object_type, object_id, event_type, actor_id, revision_number, metadata)
  VALUES (v_experiment.workspace_id, 'experiment', p_experiment_id, 'amendment_created', v_user_id,
          (v_rev_result->>'revision_number')::int,
          jsonb_build_object('reason', p_reason));

  RETURN jsonb_build_object(
    'revision_number', (v_rev_result->>'revision_number')::int,
    'status', 'in_progress'
  );
END;
$$;

-- ============================================================
-- 8. FIX INVITATION ACCEPTANCE (verify email)
-- ============================================================
CREATE OR REPLACE FUNCTION public.accept_invitation(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_invitation record;
  v_user_id uuid;
  v_user_email text;
  v_member_id uuid;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Must be authenticated to accept an invitation';
  END IF;

  -- Get user email
  SELECT email INTO v_user_email FROM auth.users WHERE id = v_user_id;

  SELECT * INTO v_invitation
  FROM public.workspace_invitations
  WHERE token = p_token
    AND accepted_at IS NULL
    AND expires_at > now();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invalid or expired invitation';
  END IF;

  -- Verify email matches (case-insensitive)
  IF lower(trim(v_user_email)) != lower(trim(v_invitation.email)) THEN
    RAISE EXCEPTION 'This invitation was sent to a different email address';
  END IF;

  -- Check if already a member
  IF EXISTS (
    SELECT 1 FROM public.workspace_members
    WHERE workspace_id = v_invitation.workspace_id AND user_id = v_user_id
  ) THEN
    UPDATE public.workspace_invitations SET accepted_at = now() WHERE id = v_invitation.id;
    RETURN jsonb_build_object('workspace_id', v_invitation.workspace_id, 'already_member', true);
  END IF;

  INSERT INTO public.workspace_members (workspace_id, user_id, role, invited_by)
  VALUES (v_invitation.workspace_id, v_user_id, v_invitation.role, v_invitation.invited_by)
  RETURNING id INTO v_member_id;

  UPDATE public.workspace_invitations SET accepted_at = now() WHERE id = v_invitation.id;

  RETURN jsonb_build_object('workspace_id', v_invitation.workspace_id, 'member_id', v_member_id, 'role', v_invitation.role);
END;
$$;

-- ============================================================
-- 9. DOMAIN STATUS ACTIONS (not arbitrary transitions)
-- ============================================================
CREATE OR REPLACE FUNCTION public.start_experiment(p_experiment_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_exp record;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT * INTO v_exp FROM public.experiments WHERE id = p_experiment_id FOR UPDATE;
  IF v_exp.status != 'draft' THEN RAISE EXCEPTION 'Can only start draft experiments'; END IF;
  IF NOT public.is_workspace_editor(v_exp.workspace_id) THEN RAISE EXCEPTION 'Not authorized'; END IF;
  UPDATE public.experiments SET status = 'in_progress' WHERE id = p_experiment_id;
  INSERT INTO public.audit_events (workspace_id, object_type, object_id, event_type, actor_id)
  VALUES (v_exp.workspace_id, 'experiment', p_experiment_id, 'started', auth.uid());
END; $$;

CREATE OR REPLACE FUNCTION public.complete_experiment(p_experiment_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_exp record;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT * INTO v_exp FROM public.experiments WHERE id = p_experiment_id FOR UPDATE;
  IF v_exp.status != 'in_progress' THEN RAISE EXCEPTION 'Can only complete in-progress experiments'; END IF;
  IF NOT public.is_workspace_editor(v_exp.workspace_id) THEN RAISE EXCEPTION 'Not authorized'; END IF;
  UPDATE public.experiments SET status = 'completed' WHERE id = p_experiment_id;
  INSERT INTO public.audit_events (workspace_id, object_type, object_id, event_type, actor_id)
  VALUES (v_exp.workspace_id, 'experiment', p_experiment_id, 'completed', auth.uid());
END; $$;

CREATE OR REPLACE FUNCTION public.reopen_experiment(p_experiment_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_exp record;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT * INTO v_exp FROM public.experiments WHERE id = p_experiment_id FOR UPDATE;
  IF v_exp.status NOT IN ('completed', 'changes_requested') THEN RAISE EXCEPTION 'Cannot reopen from current status'; END IF;
  IF NOT public.is_workspace_editor(v_exp.workspace_id) THEN RAISE EXCEPTION 'Not authorized'; END IF;
  UPDATE public.experiments SET status = 'in_progress' WHERE id = p_experiment_id;
  INSERT INTO public.audit_events (workspace_id, object_type, object_id, event_type, actor_id)
  VALUES (v_exp.workspace_id, 'experiment', p_experiment_id, 'reopened', auth.uid());
END; $$;

-- Ensure pgcrypto is available for digest()
CREATE EXTENSION IF NOT EXISTS pgcrypto;
