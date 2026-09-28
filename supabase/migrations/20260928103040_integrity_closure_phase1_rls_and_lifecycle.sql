/*
# Integrity Closure Phase 1: RLS Policy Fixes + Lifecycle Enforcement

## Changes
1. Drop old release_editor_session 2-arg overload
2. Tighten comment_threads UPDATE, comments INSERT policies
3. experiment_contributors gated on can_mutate_experiment_content
4. Missing DELETE policies for protocol_deviations, experiment_protocols
5. Lifecycle transition trigger prevents direct status bypass
6. Domain RPCs set app.domain_action marker before status changes
7. Revoke internal functions from PUBLIC/anon/authenticated
8. Re-grant domain RPCs to authenticated
*/

-- 1. Drop old 2-arg release_editor_session overload
DROP FUNCTION IF EXISTS public.release_editor_session(uuid, uuid);

-- 2. RLS Policy fixes
DROP POLICY IF EXISTS "update_ct" ON comment_threads;
CREATE POLICY "update_ct" ON comment_threads FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM experiments e WHERE e.id = comment_threads.experiment_id AND public.is_workspace_editor(e.workspace_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM experiments e WHERE e.id = comment_threads.experiment_id AND public.is_workspace_editor(e.workspace_id)));

DROP POLICY IF EXISTS "insert_comments" ON comments;
CREATE POLICY "insert_comments" ON comments FOR INSERT TO authenticated WITH CHECK (false);

DROP POLICY IF EXISTS "insert_ec" ON experiment_contributors;
CREATE POLICY "insert_ec" ON experiment_contributors FOR INSERT TO authenticated WITH CHECK (public.can_mutate_experiment_content(experiment_id));

DROP POLICY IF EXISTS "update_ec" ON experiment_contributors;
CREATE POLICY "update_ec" ON experiment_contributors FOR UPDATE TO authenticated
  USING (public.can_mutate_experiment_content(experiment_id)) WITH CHECK (public.can_mutate_experiment_content(experiment_id));

DROP POLICY IF EXISTS "delete_ec" ON experiment_contributors;
CREATE POLICY "delete_ec" ON experiment_contributors FOR DELETE TO authenticated USING (public.can_mutate_experiment_content(experiment_id));

DROP POLICY IF EXISTS "delete_pd" ON protocol_deviations;
CREATE POLICY "delete_pd" ON protocol_deviations FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM experiment_protocols ep JOIN experiments e ON e.id = ep.experiment_id WHERE ep.id = protocol_deviations.experiment_protocol_id AND public.can_mutate_experiment_content(e.id)));

DROP POLICY IF EXISTS "delete_ep" ON experiment_protocols;
CREATE POLICY "delete_ep" ON experiment_protocols FOR DELETE TO authenticated USING (false);

-- 3. Lifecycle transition trigger
CREATE OR REPLACE FUNCTION public.enforce_domain_status_transitions()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE v_caller text;
BEGIN
  IF OLD.status = NEW.status THEN RETURN NEW; END IF;
  v_caller := current_setting('app.domain_action', true);
  IF v_caller IS NOT NULL AND v_caller = 'true' THEN RETURN NEW; END IF;
  IF (OLD.status = 'draft' AND NEW.status = 'in_progress')
    OR (OLD.status = 'in_progress' AND NEW.status IN ('completed', 'draft'))
    OR (OLD.status = 'completed' AND NEW.status = 'in_progress')
  THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'Status transition from % to % must go through the appropriate domain action', OLD.status, NEW.status;
END; $$;

DROP TRIGGER IF EXISTS enforce_domain_status_transitions_trigger ON experiments;
CREATE TRIGGER enforce_domain_status_transitions_trigger BEFORE UPDATE OF status ON experiments FOR EACH ROW EXECUTE FUNCTION public.enforce_domain_status_transitions();

-- 4. Domain RPCs with app.domain_action marker

CREATE OR REPLACE FUNCTION public.submit_for_review(p_experiment_id uuid, p_reviewer_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE v_user_id uuid; v_exp record; v_reviewer record; v_rev_result jsonb;
BEGIN
  v_user_id := auth.uid(); IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT * INTO v_exp FROM public.experiments WHERE id = p_experiment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Experiment not found'; END IF;
  IF v_exp.created_by != v_user_id THEN RAISE EXCEPTION 'Only the experiment author can submit for review'; END IF;
  IF v_exp.status NOT IN ('completed', 'changes_requested') THEN RAISE EXCEPTION 'Experiment must be completed or have changes requested'; END IF;
  IF v_exp.is_locked OR v_exp.is_archived THEN RAISE EXCEPTION 'Experiment is locked or archived'; END IF;
  IF p_reviewer_id = v_user_id THEN RAISE EXCEPTION 'Cannot review your own experiment'; END IF;
  SELECT wm.* INTO v_reviewer FROM public.workspace_members wm WHERE wm.workspace_id = v_exp.workspace_id AND wm.user_id = p_reviewer_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Reviewer is not a workspace member'; END IF;
  IF v_reviewer.role = 'guest' THEN RAISE EXCEPTION 'Guests cannot review'; END IF;
  v_rev_result := public._create_revision_internal(p_experiment_id, 'Submitted for review', 'review_submit', v_user_id, NULL);
  PERFORM set_config('app.domain_action', 'true', true);
  UPDATE public.experiments SET status = 'in_review', updated_at = now() WHERE id = p_experiment_id;
  INSERT INTO public.reviews (experiment_id, reviewer_id, status, revision_number) VALUES (p_experiment_id, p_reviewer_id, 'pending', v_exp.current_revision + 1);
  INSERT INTO public.notifications (user_id, type, title, body, metadata, workspace_id) VALUES (p_reviewer_id, 'review_requested', 'Review requested', 'You have been asked to review an experiment', jsonb_build_object('experiment_id', p_experiment_id, 'experiment_title', v_exp.title), v_exp.workspace_id);
  INSERT INTO public.audit_events (workspace_id, object_type, object_id, event_type, actor_id, revision_number) VALUES (v_exp.workspace_id, 'experiment', p_experiment_id, 'submitted_for_review', v_user_id, v_exp.current_revision + 1);
  RETURN v_rev_result;
END; $$;

CREATE OR REPLACE FUNCTION public.approve_experiment(p_experiment_id uuid, p_review_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE v_user_id uuid; v_exp record; v_review record; v_rev_result jsonb;
BEGIN
  v_user_id := auth.uid(); IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT * INTO v_exp FROM public.experiments WHERE id = p_experiment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Experiment not found'; END IF;
  IF v_exp.status != 'in_review' THEN RAISE EXCEPTION 'Experiment is not in review'; END IF;
  SELECT * INTO v_review FROM public.reviews WHERE id = p_review_id AND experiment_id = p_experiment_id AND status = 'pending';
  IF NOT FOUND THEN RAISE EXCEPTION 'Pending review not found'; END IF;
  IF v_review.reviewer_id != v_user_id THEN RAISE EXCEPTION 'Not the assigned reviewer'; END IF;
  UPDATE public.reviews SET status = 'approved', reviewed_at = now(), comment = '' WHERE id = p_review_id;
  v_rev_result := public._create_revision_internal(p_experiment_id, 'Experiment approved', 'approval', v_user_id, NULL);
  PERFORM set_config('app.domain_action', 'true', true);
  UPDATE public.experiments SET status = 'approved', updated_at = now() WHERE id = p_experiment_id;
  INSERT INTO public.notifications (user_id, type, title, body, metadata, workspace_id) VALUES (v_exp.created_by, 'experiment_approved', 'Experiment approved', 'Your experiment has been approved', jsonb_build_object('experiment_id', p_experiment_id), v_exp.workspace_id);
  INSERT INTO public.audit_events (workspace_id, object_type, object_id, event_type, actor_id) VALUES (v_exp.workspace_id, 'experiment', p_experiment_id, 'approved', v_user_id);
  RETURN v_rev_result;
END; $$;

CREATE OR REPLACE FUNCTION public.request_experiment_changes(p_experiment_id uuid, p_review_id uuid, p_comment text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE v_user_id uuid; v_exp record; v_review record; v_rev_result jsonb;
BEGIN
  v_user_id := auth.uid(); IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT * INTO v_exp FROM public.experiments WHERE id = p_experiment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Experiment not found'; END IF;
  IF v_exp.status != 'in_review' THEN RAISE EXCEPTION 'Experiment is not in review'; END IF;
  SELECT * INTO v_review FROM public.reviews WHERE id = p_review_id AND experiment_id = p_experiment_id AND status = 'pending';
  IF NOT FOUND THEN RAISE EXCEPTION 'Pending review not found'; END IF;
  IF v_review.reviewer_id != v_user_id THEN RAISE EXCEPTION 'Not the assigned reviewer'; END IF;
  UPDATE public.reviews SET status = 'changes_requested', reviewed_at = now(), comment = p_comment WHERE id = p_review_id;
  v_rev_result := public._create_revision_internal(p_experiment_id, 'Changes requested: ' || left(COALESCE(p_comment, ''), 100), 'changes_requested', v_user_id, NULL);
  PERFORM set_config('app.domain_action', 'true', true);
  UPDATE public.experiments SET status = 'changes_requested', updated_at = now() WHERE id = p_experiment_id;
  INSERT INTO public.notifications (user_id, type, title, body, metadata, workspace_id) VALUES (v_exp.created_by, 'changes_requested', 'Changes requested', left(COALESCE(p_comment, ''), 200), jsonb_build_object('experiment_id', p_experiment_id), v_exp.workspace_id);
  INSERT INTO public.audit_events (workspace_id, object_type, object_id, event_type, actor_id) VALUES (v_exp.workspace_id, 'experiment', p_experiment_id, 'changes_requested', v_user_id);
  RETURN v_rev_result;
END; $$;

DROP FUNCTION IF EXISTS public.resubmit_for_review(uuid, uuid);
CREATE FUNCTION public.resubmit_for_review(p_experiment_id uuid, p_review_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE v_user_id uuid; v_exp record; v_review record; v_rev_result jsonb;
BEGIN
  v_user_id := auth.uid(); IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT * INTO v_exp FROM public.experiments WHERE id = p_experiment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Experiment not found'; END IF;
  IF v_exp.created_by != v_user_id THEN RAISE EXCEPTION 'Only the author can resubmit'; END IF;
  IF v_exp.status != 'changes_requested' THEN RAISE EXCEPTION 'Must be in changes_requested status'; END IF;
  SELECT * INTO v_review FROM public.reviews WHERE id = p_review_id AND experiment_id = p_experiment_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Review not found'; END IF;
  v_rev_result := public._create_revision_internal(p_experiment_id, 'Resubmitted for review', 'resubmit', v_user_id, NULL);
  PERFORM set_config('app.domain_action', 'true', true);
  UPDATE public.experiments SET status = 'in_review', updated_at = now() WHERE id = p_experiment_id;
  INSERT INTO public.reviews (experiment_id, reviewer_id, status, revision_number) VALUES (p_experiment_id, v_review.reviewer_id, 'pending', v_exp.current_revision + 1);
  INSERT INTO public.notifications (user_id, type, title, body, metadata, workspace_id) VALUES (v_review.reviewer_id, 'review_resubmitted', 'Experiment resubmitted', 'An experiment has been resubmitted for your review', jsonb_build_object('experiment_id', p_experiment_id), v_exp.workspace_id);
  INSERT INTO public.audit_events (workspace_id, object_type, object_id, event_type, actor_id) VALUES (v_exp.workspace_id, 'experiment', p_experiment_id, 'resubmitted', v_user_id);
  RETURN v_rev_result;
END; $$;

CREATE OR REPLACE FUNCTION public.sign_and_lock_experiment(p_experiment_id uuid, p_declaration text DEFAULT 'I hereby certify that the data and observations recorded in this experiment are accurate and complete to the best of my knowledge.')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE v_user_id uuid; v_exp record; v_rev_result jsonb; v_sig_id uuid;
BEGIN
  v_user_id := auth.uid(); IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT public.can_sign_experiment(p_experiment_id) THEN RAISE EXCEPTION 'Not authorized to sign this experiment'; END IF;
  SELECT * INTO v_exp FROM public.experiments WHERE id = p_experiment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Experiment not found'; END IF;
  v_rev_result := public._create_revision_internal(p_experiment_id, 'Signed and locked', 'signature', v_user_id, NULL);
  INSERT INTO public.signatures (experiment_id, signer_id, revision_number, declaration, content_hash) VALUES (p_experiment_id, v_user_id, v_exp.current_revision + 1, p_declaration, (v_rev_result->>'content_hash')) RETURNING id INTO v_sig_id;
  PERFORM set_config('app.domain_action', 'true', true);
  UPDATE public.experiments SET status = 'locked', is_locked = true, updated_at = now() WHERE id = p_experiment_id;
  INSERT INTO public.audit_events (workspace_id, object_type, object_id, event_type, actor_id, revision_number) VALUES (v_exp.workspace_id, 'experiment', p_experiment_id, 'signed_and_locked', v_user_id, v_exp.current_revision + 1);
  RETURN jsonb_build_object('signature_id', v_sig_id, 'revision', v_rev_result);
END; $$;

CREATE OR REPLACE FUNCTION public.archive_experiment_rpc(p_experiment_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE v_user_id uuid; v_exp record;
BEGIN
  v_user_id := auth.uid(); IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT * INTO v_exp FROM public.experiments WHERE id = p_experiment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Experiment not found'; END IF;
  IF NOT public.is_workspace_editor(v_exp.workspace_id) THEN RAISE EXCEPTION 'Not authorized'; END IF;
  IF v_exp.is_archived THEN RETURN; END IF;
  PERFORM set_config('app.domain_action', 'true', true);
  UPDATE public.experiments SET status = 'archived', is_archived = true, previous_status = v_exp.status, updated_at = now() WHERE id = p_experiment_id;
  INSERT INTO public.audit_events (workspace_id, object_type, object_id, event_type, actor_id, metadata) VALUES (v_exp.workspace_id, 'experiment', p_experiment_id, 'archived', v_user_id, jsonb_build_object('previous_status', v_exp.status, 'was_locked', v_exp.is_locked));
END; $$;

CREATE OR REPLACE FUNCTION public.restore_experiment_rpc(p_experiment_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE v_user_id uuid; v_exp record; v_restore_status text;
BEGIN
  v_user_id := auth.uid(); IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT * INTO v_exp FROM public.experiments WHERE id = p_experiment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Experiment not found'; END IF;
  IF NOT public.is_workspace_editor(v_exp.workspace_id) THEN RAISE EXCEPTION 'Not authorized'; END IF;
  IF NOT v_exp.is_archived THEN RAISE EXCEPTION 'Experiment is not archived'; END IF;
  v_restore_status := COALESCE(v_exp.previous_status, 'draft');
  IF v_restore_status = 'archived' THEN v_restore_status := 'draft'; END IF;
  PERFORM set_config('app.domain_action', 'true', true);
  UPDATE public.experiments SET status = v_restore_status, is_archived = false, previous_status = NULL, updated_at = now() WHERE id = p_experiment_id;
  INSERT INTO public.audit_events (workspace_id, object_type, object_id, event_type, actor_id, metadata) VALUES (v_exp.workspace_id, 'experiment', p_experiment_id, 'restored', v_user_id, jsonb_build_object('restored_status', v_restore_status));
  RETURN jsonb_build_object('status', v_restore_status);
END; $$;

-- 5. Revoke internal functions
REVOKE EXECUTE ON FUNCTION public._build_experiment_snapshot(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._create_revision_internal(uuid, text, text, uuid, jsonb) FROM PUBLIC, anon, authenticated;

-- Bulk revoke all SECURITY DEFINER from anon
DO $$ DECLARE fn record;
BEGIN
  FOR fn IN SELECT p.proname, pg_get_function_identity_arguments(p.oid) as args FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.prosecdef = true
  LOOP BEGIN EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%I(%s) FROM anon', fn.proname, fn.args); EXCEPTION WHEN OTHERS THEN NULL; END; END LOOP;
END; $$;

-- Grant all public domain RPCs to authenticated (exact signatures from catalog)
GRANT EXECUTE ON FUNCTION public.submit_for_review(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_experiment(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.request_experiment_changes(uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resubmit_for_review(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sign_and_lock_experiment(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.archive_experiment_rpc(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.restore_experiment_rpc(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_checkpoint(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.claim_editor_session(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.release_editor_session(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_experiment_blocks(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.insert_experiment_block(uuid, text, jsonb, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_experiment_block(uuid, uuid, bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_experiment_rpc(uuid, uuid, text, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.duplicate_experiment_rpc(uuid, boolean, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_experiment_metadata(uuid, text, date, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.start_experiment(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_experiment(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reopen_experiment(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_amendment(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.publish_protocol_version(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.publish_template_version(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_attachment(uuid, text, text, text, text, bigint, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.replace_attachment(uuid, text, bigint, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.archive_attachment(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.add_comment_with_mentions(uuid, uuid, text, uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.restore_experiment_revision(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_experiment_capabilities(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.search_experiments(uuid, text, text, uuid, uuid, date, date, uuid[], text, int, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_mutate_experiment_content(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_edit_experiment(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_sign_experiment(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_workspace_member(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_workspace_editor(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_workspace_role(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.generate_experiment_id() TO authenticated;
