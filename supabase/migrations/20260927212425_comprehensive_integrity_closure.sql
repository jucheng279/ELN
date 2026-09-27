/*
# Comprehensive Scientific Record Integrity Closure

## 1. Fix protocol_version immutability trigger (check steps/parameters/notes, not content)
## 2. Fix template_version immutability trigger (already correct, just re-set search_path)  
## 3. Fix can_mutate_experiment_content to include changes_requested
## 4. Fix experiment ID format back to EXP-YYYY-NNNNNN
## 5. Fix publish_template_version to update current_version
## 6. Fix archive/restore to preserve pre-archive status
## 7. Fix create_revision restrictions for user checkpoints
## 8. Close RLS bypasses on domain tables
## 9. Revoke EXECUTE from PUBLIC on all SECURITY DEFINER functions
## 10. Fix editor session ownership validation
## 11. Fix upsert_experiment_blocks to validate editor session
## 12. Fix complete_experiment to create revision before status change
## 13. Strengthen status transition trigger for archive restore
## 14. Close direct mutation on attachments, reviews, signatures, revisions, mentions
*/

-- 1. Fix protocol_version immutability trigger
CREATE OR REPLACE FUNCTION public.enforce_protocol_version_immutability()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
  IF OLD.status IN ('published', 'superseded') THEN
    IF OLD.steps IS DISTINCT FROM NEW.steps
    OR OLD.parameters IS DISTINCT FROM NEW.parameters
    OR OLD.notes IS DISTINCT FROM NEW.notes
    OR OLD.version_number IS DISTINCT FROM NEW.version_number THEN
      RAISE EXCEPTION 'Cannot modify content of a published or superseded protocol version';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- 2. Fix template_version immutability trigger
CREATE OR REPLACE FUNCTION public.enforce_template_version_immutability()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
  IF OLD.status IN ('published', 'superseded') THEN
    IF OLD.content IS DISTINCT FROM NEW.content
    OR OLD.version_number IS DISTINCT FROM NEW.version_number THEN
      RAISE EXCEPTION 'Cannot modify content of a published or superseded template version';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- 3. Fix can_mutate_experiment_content to include changes_requested
CREATE OR REPLACE FUNCTION public.can_mutate_experiment_content(p_experiment_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER STABLE SET search_path TO '' AS $$
DECLARE v_exp record;
BEGIN
  IF auth.uid() IS NULL THEN RETURN false; END IF;
  SELECT workspace_id, status, is_locked, is_archived INTO v_exp
  FROM public.experiments WHERE id = p_experiment_id;
  IF NOT FOUND THEN RETURN false; END IF;
  IF v_exp.is_locked THEN RETURN false; END IF;
  IF v_exp.is_archived THEN RETURN false; END IF;
  IF v_exp.status NOT IN ('draft', 'in_progress', 'changes_requested') THEN RETURN false; END IF;
  RETURN public.is_workspace_editor(v_exp.workspace_id);
END;
$$;

-- 4. Fix experiment ID format back to EXP-YYYY-NNNNNN
CREATE OR REPLACE FUNCTION public.generate_experiment_id()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE v_num bigint; v_year text;
BEGIN
  v_num := NEW.experiment_number;
  v_year := to_char(now(), 'YYYY');
  NEW.experiment_id := 'EXP-' || v_year || '-' || lpad(v_num::text, 6, '0');
  RETURN NEW;
END;
$$;

-- 5. Fix publish_template_version to update current_version
CREATE OR REPLACE FUNCTION public.publish_template_version(p_template_id uuid, p_version_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE v_user_id uuid; v_template record; v_version record;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT * INTO v_template FROM public.templates WHERE id = p_template_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Template not found'; END IF;
  IF NOT public.is_workspace_editor(v_template.workspace_id) THEN
    RAISE EXCEPTION 'Not authorized to publish templates'; END IF;
  SELECT * INTO v_version FROM public.template_versions
  WHERE id = p_version_id AND template_id = p_template_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Version not found'; END IF;
  IF v_version.status != 'draft' THEN RAISE EXCEPTION 'Only draft versions can be published'; END IF;
  UPDATE public.template_versions SET status = 'superseded'
  WHERE template_id = p_template_id AND status = 'published';
  UPDATE public.template_versions SET status = 'published', published_at = now()
  WHERE id = p_version_id;
  UPDATE public.templates SET status = 'published', current_version = v_version.version_number, updated_at = now()
  WHERE id = p_template_id;
  RETURN jsonb_build_object('version_id', p_version_id, 'version_number', v_version.version_number);
END;
$$;

-- 6. Fix archive/restore to preserve pre-archive status
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name = 'experiments' AND column_name = 'previous_status' AND table_schema = 'public')
  THEN ALTER TABLE public.experiments ADD COLUMN previous_status text;
  END IF;
END $$;

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
  UPDATE public.experiments SET is_archived = true, previous_status = v_exp.status, status = 'archived'
  WHERE id = p_experiment_id;
  INSERT INTO public.audit_events (workspace_id, object_type, object_id, event_type, actor_id, metadata)
  VALUES (v_exp.workspace_id, 'experiment', p_experiment_id, 'archived', v_user_id,
    jsonb_build_object('previous_status', v_exp.status));
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
  IF NOT v_exp.is_archived THEN RETURN jsonb_build_object('status', v_exp.status); END IF;
  v_restore_status := COALESCE(v_exp.previous_status, 'draft');
  IF v_restore_status = 'archived' THEN v_restore_status := 'draft'; END IF;
  UPDATE public.experiments SET is_archived = false, status = v_restore_status, previous_status = NULL
  WHERE id = p_experiment_id;
  INSERT INTO public.audit_events (workspace_id, object_type, object_id, event_type, actor_id, metadata)
  VALUES (v_exp.workspace_id, 'experiment', p_experiment_id, 'restored', v_user_id,
    jsonb_build_object('restored_to', v_restore_status));
  RETURN jsonb_build_object('status', v_restore_status);
END;
$$;

-- 7. Fix create_revision
CREATE OR REPLACE FUNCTION public.create_revision(
  p_experiment_id uuid, p_change_summary text DEFAULT '', p_change_type text DEFAULT 'checkpoint'
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE v_user_id uuid; v_experiment record; v_next_rev int; v_snapshot jsonb; v_hash text; v_revision_id uuid;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT e.* INTO v_experiment FROM public.experiments e WHERE e.id = p_experiment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Experiment not found'; END IF;
  IF NOT public.is_workspace_editor(v_experiment.workspace_id) THEN
    RAISE EXCEPTION 'Not authorized to create revisions'; END IF;
  IF p_change_type IN ('checkpoint', 'edit') THEN
    IF v_experiment.is_locked THEN RAISE EXCEPTION 'Experiment is locked'; END IF;
    IF v_experiment.is_archived THEN RAISE EXCEPTION 'Experiment is archived'; END IF;
    IF v_experiment.status NOT IN ('draft', 'in_progress', 'changes_requested') THEN
      RAISE EXCEPTION 'Cannot create checkpoint in current state'; END IF;
  END IF;
  SELECT COALESCE(MAX(revision_number), 0) + 1 INTO v_next_rev
  FROM public.experiment_revisions WHERE experiment_id = p_experiment_id;
  SELECT jsonb_build_object(
    'experiment_id', v_experiment.experiment_id, 'title', v_experiment.title,
    'status', v_experiment.status, 'experiment_date', v_experiment.experiment_date,
    'template_id', v_experiment.template_id, 'template_version_id', v_experiment.template_version_id,
    'blocks', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', b.id, 'type', b.type, 'content', b.content, 'order_key', b.order_key) ORDER BY b.order_key) FROM public.experiment_blocks b WHERE b.experiment_id = p_experiment_id), '[]'::jsonb),
    'tags', COALESCE((SELECT jsonb_agg(t.name ORDER BY t.name) FROM public.experiment_tags et JOIN public.tags t ON t.id = et.tag_id WHERE et.experiment_id = p_experiment_id), '[]'::jsonb),
    'protocols', COALESCE((SELECT jsonb_agg(jsonb_build_object('protocol_id', ep.protocol_id, 'version_id', ep.protocol_version_id, 'snapshot', ep.snapshot)) FROM public.experiment_protocols ep WHERE ep.experiment_id = p_experiment_id), '[]'::jsonb),
    'attachments', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', a.id, 'filename', a.original_filename, 'storage_path', a.storage_path, 'mime_type', a.mime_type, 'file_size', a.file_size, 'checksum', a.checksum, 'version', a.current_version)) FROM public.attachments a WHERE a.experiment_id = p_experiment_id AND NOT a.is_archived), '[]'::jsonb)
  ) INTO v_snapshot;
  v_hash := encode(extensions.digest(v_snapshot::text, 'sha256'), 'hex');
  INSERT INTO public.experiment_revisions (experiment_id, revision_number, snapshot, content_hash, change_summary, change_type, created_by)
  VALUES (p_experiment_id, v_next_rev, v_snapshot, v_hash, p_change_summary, p_change_type, v_user_id)
  RETURNING id INTO v_revision_id;
  UPDATE public.experiments SET current_revision = v_next_rev WHERE id = p_experiment_id;
  RETURN jsonb_build_object('revision_id', v_revision_id, 'revision_number', v_next_rev, 'content_hash', v_hash);
END;
$$;

-- 8. Close RLS bypasses
DROP POLICY IF EXISTS "insert_notif" ON public.notifications;
DROP POLICY IF EXISTS "select_notif" ON public.notifications;
DROP POLICY IF EXISTS "update_notif" ON public.notifications;
DROP POLICY IF EXISTS "delete_notif" ON public.notifications;

DROP POLICY IF EXISTS "insert_revisions" ON public.experiment_revisions;
CREATE POLICY "insert_revisions" ON public.experiment_revisions FOR INSERT TO authenticated WITH CHECK (false);

DROP POLICY IF EXISTS "insert_reviews" ON public.reviews;
CREATE POLICY "insert_reviews" ON public.reviews FOR INSERT TO authenticated WITH CHECK (false);
DROP POLICY IF EXISTS "update_reviews" ON public.reviews;
CREATE POLICY "update_reviews" ON public.reviews FOR UPDATE TO authenticated USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS "insert_sigs" ON public.signatures;
CREATE POLICY "insert_sigs" ON public.signatures FOR INSERT TO authenticated WITH CHECK (false);

DROP POLICY IF EXISTS "insert_ep" ON public.experiment_protocols;
CREATE POLICY "insert_ep" ON public.experiment_protocols FOR INSERT TO authenticated WITH CHECK (false);
DROP POLICY IF EXISTS "update_ep" ON public.experiment_protocols;
CREATE POLICY "update_ep" ON public.experiment_protocols FOR UPDATE TO authenticated USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS "insert_pd" ON public.protocol_deviations;
CREATE POLICY "insert_pd" ON public.protocol_deviations FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.experiment_protocols ep JOIN public.experiments e ON e.id = ep.experiment_id
    WHERE ep.id = protocol_deviations.experiment_protocol_id AND public.can_mutate_experiment_content(e.id)));
DROP POLICY IF EXISTS "update_pd" ON public.protocol_deviations;
CREATE POLICY "update_pd" ON public.protocol_deviations FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.experiment_protocols ep JOIN public.experiments e ON e.id = ep.experiment_id
    WHERE ep.id = protocol_deviations.experiment_protocol_id AND public.can_mutate_experiment_content(e.id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.experiment_protocols ep JOIN public.experiments e ON e.id = ep.experiment_id
    WHERE ep.id = protocol_deviations.experiment_protocol_id AND public.can_mutate_experiment_content(e.id)));

DROP POLICY IF EXISTS "insert_mentions" ON public.mentions;
CREATE POLICY "insert_mentions" ON public.mentions FOR INSERT TO authenticated WITH CHECK (false);

DROP POLICY IF EXISTS "insert_et" ON public.experiment_tags;
CREATE POLICY "insert_et" ON public.experiment_tags FOR INSERT TO authenticated
  WITH CHECK (public.can_mutate_experiment_content(experiment_id));
DROP POLICY IF EXISTS "delete_et" ON public.experiment_tags;
CREATE POLICY "delete_et" ON public.experiment_tags FOR DELETE TO authenticated
  USING (public.can_mutate_experiment_content(experiment_id));

DROP POLICY IF EXISTS "insert_er" ON public.experiment_references;
CREATE POLICY "insert_er" ON public.experiment_references FOR INSERT TO authenticated
  WITH CHECK (public.can_mutate_experiment_content(experiment_id));
DROP POLICY IF EXISTS "update_er" ON public.experiment_references;
CREATE POLICY "update_er" ON public.experiment_references FOR UPDATE TO authenticated
  USING (public.can_mutate_experiment_content(experiment_id))
  WITH CHECK (public.can_mutate_experiment_content(experiment_id));
DROP POLICY IF EXISTS "delete_er" ON public.experiment_references;
CREATE POLICY "delete_er" ON public.experiment_references FOR DELETE TO authenticated
  USING (public.can_mutate_experiment_content(experiment_id));

DROP POLICY IF EXISTS "insert_erl" ON public.experiment_relations;
CREATE POLICY "insert_erl" ON public.experiment_relations FOR INSERT TO authenticated
  WITH CHECK (public.can_mutate_experiment_content(source_experiment_id));
DROP POLICY IF EXISTS "update_erl" ON public.experiment_relations;
CREATE POLICY "update_erl" ON public.experiment_relations FOR UPDATE TO authenticated
  USING (public.can_mutate_experiment_content(source_experiment_id))
  WITH CHECK (public.can_mutate_experiment_content(source_experiment_id));
DROP POLICY IF EXISTS "delete_erl" ON public.experiment_relations;
CREATE POLICY "delete_erl" ON public.experiment_relations FOR DELETE TO authenticated
  USING (public.can_mutate_experiment_content(source_experiment_id));

DROP POLICY IF EXISTS "insert_ec" ON public.experiment_contributors;
CREATE POLICY "insert_ec" ON public.experiment_contributors FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.experiments e WHERE e.id = experiment_contributors.experiment_id AND public.is_workspace_editor(e.workspace_id)));
DROP POLICY IF EXISTS "update_ec" ON public.experiment_contributors;
CREATE POLICY "update_ec" ON public.experiment_contributors FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.experiments e WHERE e.id = experiment_contributors.experiment_id AND public.is_workspace_editor(e.workspace_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM public.experiments e WHERE e.id = experiment_contributors.experiment_id AND public.is_workspace_editor(e.workspace_id)));
DROP POLICY IF EXISTS "delete_ec" ON public.experiment_contributors;
CREATE POLICY "delete_ec" ON public.experiment_contributors FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.experiments e WHERE e.id = experiment_contributors.experiment_id AND public.is_workspace_editor(e.workspace_id)));

DROP POLICY IF EXISTS "insert_attach" ON public.attachments;
CREATE POLICY "insert_attach" ON public.attachments FOR INSERT TO authenticated WITH CHECK (false);
DROP POLICY IF EXISTS "update_attach" ON public.attachments;
CREATE POLICY "update_attach" ON public.attachments FOR UPDATE TO authenticated USING (false) WITH CHECK (false);
DROP POLICY IF EXISTS "delete_attach" ON public.attachments;
CREATE POLICY "delete_attach" ON public.attachments FOR DELETE TO authenticated USING (false);

DROP POLICY IF EXISTS "insert_av" ON public.attachment_versions;
CREATE POLICY "insert_av" ON public.attachment_versions FOR INSERT TO authenticated WITH CHECK (false);

DROP POLICY IF EXISTS "insert_pv" ON public.protocol_versions;
CREATE POLICY "insert_pv" ON public.protocol_versions FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.protocols p WHERE p.id = protocol_versions.protocol_id AND public.is_workspace_editor(p.workspace_id)) AND protocol_versions.status = 'draft');
DROP POLICY IF EXISTS "update_pv" ON public.protocol_versions;
CREATE POLICY "update_pv" ON public.protocol_versions FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.protocols p WHERE p.id = protocol_versions.protocol_id AND public.is_workspace_editor(p.workspace_id)) AND status = 'draft')
  WITH CHECK (EXISTS (SELECT 1 FROM public.protocols p WHERE p.id = protocol_versions.protocol_id AND public.is_workspace_editor(p.workspace_id)) AND protocol_versions.status = 'draft');

DROP POLICY IF EXISTS "insert_tv" ON public.template_versions;
CREATE POLICY "insert_tv" ON public.template_versions FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.templates t WHERE t.id = template_versions.template_id AND public.is_workspace_editor(t.workspace_id)) AND template_versions.status = 'draft');
DROP POLICY IF EXISTS "update_tv" ON public.template_versions;
CREATE POLICY "update_tv" ON public.template_versions FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.templates t WHERE t.id = template_versions.template_id AND public.is_workspace_editor(t.workspace_id)) AND status = 'draft')
  WITH CHECK (EXISTS (SELECT 1 FROM public.templates t WHERE t.id = template_versions.template_id AND public.is_workspace_editor(t.workspace_id)) AND template_versions.status = 'draft');

-- 9. Revoke EXECUTE from PUBLIC on ALL SECURITY DEFINER functions
DO $$
DECLARE fn record;
BEGIN
  FOR fn IN SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' AND p.prosecdef = true
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%I(%s) FROM PUBLIC', fn.proname, fn.args);
    EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%I(%s) FROM anon', fn.proname, fn.args);
    IF fn.proname NOT IN ('handle_new_user','handle_new_workspace','protect_last_owner',
      'enforce_experiment_lock','enforce_block_lock','enforce_protocol_version_immutability',
      'enforce_template_version_immutability','generate_experiment_id','update_experiment_search',
      'validate_experiment_status') THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I(%s) TO authenticated', fn.proname, fn.args);
    END IF;
  END LOOP;
END;
$$;

-- 10. Fix editor session ownership
CREATE OR REPLACE FUNCTION public.claim_editor_session(p_experiment_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE v_user_id uuid; v_exp record; v_session_id uuid;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT * INTO v_exp FROM public.experiments WHERE id = p_experiment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Experiment not found'; END IF;
  IF NOT public.can_mutate_experiment_content(p_experiment_id) THEN
    RAISE EXCEPTION 'Experiment is not in an editable state'; END IF;
  IF v_exp.editor_session_user = v_user_id AND v_exp.editor_session_id IS NOT NULL THEN
    UPDATE public.experiments SET editor_session_started_at = now() WHERE id = p_experiment_id;
    RETURN jsonb_build_object('session_id', v_exp.editor_session_id, 'renewed', true);
  END IF;
  IF v_exp.editor_session_user IS NOT NULL AND v_exp.editor_session_user != v_user_id
     AND v_exp.editor_session_started_at > (now() - interval '5 minutes') THEN
    RAISE EXCEPTION 'Experiment is being edited by another user'; END IF;
  v_session_id := gen_random_uuid();
  UPDATE public.experiments SET editor_session_id = v_session_id, editor_session_user = v_user_id, editor_session_started_at = now()
  WHERE id = p_experiment_id;
  RETURN jsonb_build_object('session_id', v_session_id, 'renewed', false);
END;
$$;

CREATE OR REPLACE FUNCTION public.release_editor_session(p_experiment_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE v_user_id uuid; v_session_user uuid;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT editor_session_user INTO v_session_user FROM public.experiments WHERE id = p_experiment_id FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;
  IF v_session_user IS NOT NULL AND v_session_user != v_user_id THEN
    RAISE EXCEPTION 'Cannot release another user''s editor session'; END IF;
  UPDATE public.experiments SET editor_session_id = NULL, editor_session_user = NULL, editor_session_started_at = NULL
  WHERE id = p_experiment_id;
END;
$$;

-- 11. Fix upsert_experiment_blocks to validate editor session
CREATE OR REPLACE FUNCTION public.upsert_experiment_blocks(p_experiment_id uuid, p_blocks jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE v_block jsonb; v_exp record;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT editor_session_user, editor_session_started_at INTO v_exp
  FROM public.experiments WHERE id = p_experiment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Experiment not found'; END IF;
  IF NOT public.can_mutate_experiment_content(p_experiment_id) THEN
    RAISE EXCEPTION 'Experiment is not in an editable state'; END IF;
  IF v_exp.editor_session_user IS NOT NULL AND v_exp.editor_session_user != auth.uid() THEN
    IF v_exp.editor_session_started_at > (now() - interval '5 minutes') THEN
      RAISE EXCEPTION 'Conflict: another user is editing this experiment'; END IF;
  END IF;
  FOR v_block IN SELECT * FROM jsonb_array_elements(p_blocks) LOOP
    INSERT INTO public.experiment_blocks (id, experiment_id, type, content, order_key, created_by, updated_by)
    VALUES ((v_block->>'id')::uuid, p_experiment_id, v_block->>'type', v_block->'content', v_block->>'order_key', auth.uid(), auth.uid())
    ON CONFLICT (id) DO UPDATE SET content = EXCLUDED.content, order_key = EXCLUDED.order_key, updated_by = auth.uid(), updated_at = now()
    WHERE experiment_blocks.experiment_id = p_experiment_id;
  END LOOP;
END;
$$;

-- Fix insert/delete block RPCs (keeping original return types)
CREATE OR REPLACE FUNCTION public.insert_experiment_block(p_experiment_id uuid, p_type text, p_content jsonb, p_order_key text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE v_block_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT public.can_mutate_experiment_content(p_experiment_id) THEN
    RAISE EXCEPTION 'Experiment is not in an editable state'; END IF;
  INSERT INTO public.experiment_blocks (experiment_id, type, content, order_key, created_by, updated_by)
  VALUES (p_experiment_id, p_type, p_content, p_order_key, auth.uid(), auth.uid())
  RETURNING id INTO v_block_id;
  RETURN jsonb_build_object('id', v_block_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_experiment_block(p_experiment_id uuid, p_block_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT public.can_mutate_experiment_content(p_experiment_id) THEN
    RAISE EXCEPTION 'Experiment is not in an editable state'; END IF;
  DELETE FROM public.experiment_blocks WHERE id = p_block_id AND experiment_id = p_experiment_id;
END;
$$;

-- 12. Fix complete_experiment to create revision
CREATE OR REPLACE FUNCTION public.complete_experiment(p_experiment_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE v_user_id uuid; v_exp record;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT * INTO v_exp FROM public.experiments e WHERE e.id = p_experiment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Experiment not found'; END IF;
  IF NOT public.is_workspace_editor(v_exp.workspace_id) THEN RAISE EXCEPTION 'Not authorized'; END IF;
  IF v_exp.status != 'in_progress' THEN RAISE EXCEPTION 'Can only complete an in-progress experiment'; END IF;
  PERFORM public.create_revision(p_experiment_id, 'Experiment completed', 'completion');
  UPDATE public.experiments SET status = 'completed' WHERE id = p_experiment_id;
  INSERT INTO public.audit_events (workspace_id, object_type, object_id, event_type, actor_id)
  VALUES (v_exp.workspace_id, 'experiment', p_experiment_id, 'completed', v_user_id);
END;
$$;

-- 13. Strengthen status transition for archive restore
CREATE OR REPLACE FUNCTION public.validate_experiment_status()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE v_allowed text[];
BEGIN
  IF OLD.status = NEW.status THEN RETURN NEW; END IF;
  CASE OLD.status
    WHEN 'draft' THEN v_allowed := ARRAY['in_progress', 'archived'];
    WHEN 'in_progress' THEN v_allowed := ARRAY['completed', 'draft', 'archived'];
    WHEN 'completed' THEN v_allowed := ARRAY['in_review', 'in_progress', 'archived'];
    WHEN 'in_review' THEN v_allowed := ARRAY['changes_requested', 'approved', 'archived'];
    WHEN 'changes_requested' THEN v_allowed := ARRAY['in_review', 'in_progress', 'archived'];
    WHEN 'approved' THEN v_allowed := ARRAY['locked', 'archived'];
    WHEN 'locked' THEN v_allowed := ARRAY['archived'];
    WHEN 'archived' THEN v_allowed := ARRAY['draft','in_progress','completed','in_review','changes_requested','approved','locked'];
    ELSE RAISE EXCEPTION 'Unknown status: %', OLD.status;
  END CASE;
  IF NOT (NEW.status = ANY(v_allowed)) THEN
    RAISE EXCEPTION 'Invalid status transition from % to %', OLD.status, NEW.status;
  END IF;
  RETURN NEW;
END;
$$;

-- 14. Final EXECUTE grant cleanup
DO $$
DECLARE fn record;
BEGIN
  FOR fn IN SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' AND p.prosecdef = true
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%I(%s) FROM PUBLIC', fn.proname, fn.args);
    EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%I(%s) FROM anon', fn.proname, fn.args);
    IF fn.proname NOT IN ('handle_new_user','handle_new_workspace','protect_last_owner',
      'enforce_experiment_lock','enforce_block_lock','enforce_protocol_version_immutability',
      'enforce_template_version_immutability','generate_experiment_id','update_experiment_search',
      'validate_experiment_status') THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I(%s) TO authenticated', fn.proname, fn.args);
    END IF;
  END LOOP;
END;
$$;
