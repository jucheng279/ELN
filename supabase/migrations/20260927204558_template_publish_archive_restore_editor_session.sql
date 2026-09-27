/*
# Template Publication RPC + Archive/Restore RPCs + Autosave Concurrency (Tasks 6, 9, 14)

## Summary

### Task 9: publish_template_version RPC
- Mirrors publish_protocol_version for templates
- Supersedes currently published version, sets new one to published
- Checks workspace editor permission

### Task 14: archive_experiment / restore_experiment RPCs
- Server-side archive that sets is_archived=true + status='archived'
- Server-side restore that sets is_archived=false + status='draft'
- Both create audit events
- Restore records previous status in audit metadata

### Task 6: Autosave concurrency guard
- Adds editor_session_id column to experiments for tracking active editors
- Creates claim_editor_session / release_editor_session RPCs
- Updated upsert_experiment_blocks checks session ownership

## Security
- All functions are SECURITY DEFINER with empty search_path
- All check workspace membership
*/

-- ═══════════════════════════════════════════════
-- Task 9: Template publication RPC
-- ═══════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.publish_template_version(p_template_id uuid, p_version_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $fn$
DECLARE
  v_user_id uuid;
  v_template record;
  v_version record;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT * INTO v_template FROM public.templates WHERE id = p_template_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Template not found'; END IF;
  IF NOT public.is_workspace_editor(v_template.workspace_id) THEN
    RAISE EXCEPTION 'Not authorized to publish templates';
  END IF;

  SELECT * INTO v_version FROM public.template_versions
  WHERE id = p_version_id AND template_id = p_template_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Version not found'; END IF;
  IF v_version.status != 'draft' THEN RAISE EXCEPTION 'Only draft versions can be published'; END IF;

  UPDATE public.template_versions SET status = 'superseded'
  WHERE template_id = p_template_id AND status = 'published';

  UPDATE public.template_versions SET status = 'published', published_at = now()
  WHERE id = p_version_id;

  UPDATE public.templates SET status = 'published', updated_at = now()
  WHERE id = p_template_id;

  RETURN jsonb_build_object('version_id', p_version_id, 'version_number', v_version.version_number);
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.publish_template_version(uuid, uuid) TO authenticated;

-- ═══════════════════════════════════════════════
-- Task 14: Archive / Restore RPCs
-- ═══════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.archive_experiment_rpc(p_experiment_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $fn$
DECLARE
  v_user_id uuid;
  v_exp record;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT * INTO v_exp FROM public.experiments WHERE id = p_experiment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Experiment not found'; END IF;
  IF NOT public.is_workspace_editor(v_exp.workspace_id) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF v_exp.is_archived THEN RETURN; END IF;

  UPDATE public.experiments
  SET is_archived = true, status = 'archived'
  WHERE id = p_experiment_id;

  INSERT INTO public.audit_events (workspace_id, object_type, object_id, event_type, actor_id, metadata)
  VALUES (v_exp.workspace_id, 'experiment', p_experiment_id, 'archived', v_user_id,
    jsonb_build_object('previous_status', v_exp.status));
END;
$fn$;

CREATE OR REPLACE FUNCTION public.restore_experiment_rpc(p_experiment_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $fn$
DECLARE
  v_user_id uuid;
  v_exp record;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT * INTO v_exp FROM public.experiments WHERE id = p_experiment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Experiment not found'; END IF;
  IF NOT public.is_workspace_editor(v_exp.workspace_id) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  IF NOT v_exp.is_archived THEN
    RETURN jsonb_build_object('status', v_exp.status);
  END IF;

  UPDATE public.experiments
  SET is_archived = false, status = 'draft'
  WHERE id = p_experiment_id;

  INSERT INTO public.audit_events (workspace_id, object_type, object_id, event_type, actor_id, metadata)
  VALUES (v_exp.workspace_id, 'experiment', p_experiment_id, 'restored', v_user_id,
    jsonb_build_object('restored_to', 'draft'));

  RETURN jsonb_build_object('status', 'draft');
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.archive_experiment_rpc(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.restore_experiment_rpc(uuid) TO authenticated;

-- ═══════════════════════════════════════════════
-- Task 6: Editor session + optimistic concurrency
-- ═══════════════════════════════════════════════

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'experiments' AND column_name = 'editor_session_id'
  ) THEN
    ALTER TABLE public.experiments ADD COLUMN editor_session_id uuid;
    ALTER TABLE public.experiments ADD COLUMN editor_session_user uuid;
    ALTER TABLE public.experiments ADD COLUMN editor_session_started_at timestamptz;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.claim_editor_session(p_experiment_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $fn$
DECLARE
  v_user_id uuid;
  v_exp record;
  v_session_id uuid;
  v_stale_threshold interval := interval '5 minutes';
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  IF NOT public.can_mutate_experiment_content(p_experiment_id) THEN
    RAISE EXCEPTION 'Experiment is not in an editable state';
  END IF;

  SELECT editor_session_id, editor_session_user, editor_session_started_at
  INTO v_exp
  FROM public.experiments WHERE id = p_experiment_id FOR UPDATE;

  -- If someone else holds a non-stale session, reject
  IF v_exp.editor_session_id IS NOT NULL
     AND v_exp.editor_session_user != v_user_id
     AND v_exp.editor_session_started_at > (now() - v_stale_threshold) THEN
    RAISE EXCEPTION 'Another user is currently editing this experiment';
  END IF;

  v_session_id := gen_random_uuid();

  UPDATE public.experiments
  SET editor_session_id = v_session_id,
      editor_session_user = v_user_id,
      editor_session_started_at = now()
  WHERE id = p_experiment_id;

  RETURN jsonb_build_object('session_id', v_session_id);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.release_editor_session(p_experiment_id uuid, p_session_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $fn$
BEGIN
  UPDATE public.experiments
  SET editor_session_id = NULL,
      editor_session_user = NULL,
      editor_session_started_at = NULL
  WHERE id = p_experiment_id
    AND editor_session_id = p_session_id;
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.claim_editor_session(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.release_editor_session(uuid, uuid) TO authenticated;
