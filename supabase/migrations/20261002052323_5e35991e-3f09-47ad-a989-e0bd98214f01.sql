-- Cycle 31: scientific export integrity closure.

-- 1. Read-only snapshot builder becomes STABLE: all its statements then share the
--    snapshot of the calling statement, so one call is one database instant.
ALTER FUNCTION public._build_experiment_snapshot(uuid) STABLE;

-- 2. One canonical content-hash contract (jsonb canonical text, UTF-8, SHA-256 hex).
CREATE OR REPLACE FUNCTION public.canonical_snapshot_hash(p_snapshot jsonb)
RETURNS text LANGUAGE sql IMMUTABLE STRICT SET search_path TO ''
AS $$ SELECT encode(extensions.digest(convert_to(p_snapshot::text, 'UTF8'), 'sha256'), 'hex') $$;
REVOKE ALL ON FUNCTION public.canonical_snapshot_hash(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.canonical_snapshot_hash(jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public._create_revision_internal(p_experiment_id uuid, p_change_summary text, p_change_type text, p_created_by uuid, p_metadata jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE
  v_rev_number int; v_rev_id uuid; v_snapshot jsonb; v_hash text;
BEGIN
  PERFORM 1 FROM public.experiments WHERE id = p_experiment_id FOR UPDATE;
  PERFORM public._assert_experiment_edges_tenant_valid(p_experiment_id);

  SELECT COALESCE(MAX(revision_number), 0) + 1 INTO v_rev_number
  FROM public.experiment_revisions WHERE experiment_id = p_experiment_id;

  v_snapshot := public._build_experiment_snapshot(p_experiment_id);
  v_hash := public.canonical_snapshot_hash(v_snapshot);

  INSERT INTO public.experiment_revisions (
    experiment_id, revision_number, snapshot, content_hash,
    change_summary, change_type, created_by, metadata
  ) VALUES (
    p_experiment_id, v_rev_number, v_snapshot, v_hash,
    p_change_summary, p_change_type, p_created_by, p_metadata
  ) RETURNING id INTO v_rev_id;

  UPDATE public.experiments SET current_revision = v_rev_number, updated_at = now()
  WHERE id = p_experiment_id;

  RETURN jsonb_build_object('revision_id', v_rev_id, 'revision_number', v_rev_number, 'content_hash', v_hash);
END; $function$;
REVOKE ALL ON FUNCTION public._create_revision_internal(uuid, text, text, uuid, jsonb) FROM PUBLIC, anon, authenticated;

-- 3. Atomic working-draft capture (STABLE => single statement snapshot).
CREATE OR REPLACE FUNCTION public.capture_working_draft_export(p_experiment_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE v_uid uuid := auth.uid(); v_exp record;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501'; END IF;
  SELECT id, workspace_id, experiment_id, title, experiment_date, status, is_locked, is_archived,
         current_revision, metadata_version
    INTO v_exp FROM public.experiments WHERE id = p_experiment_id;
  IF NOT FOUND OR NOT public.is_workspace_member(v_exp.workspace_id) THEN
    RAISE EXCEPTION 'Experiment not found or access denied' USING ERRCODE = '42501';
  END IF;
  IF v_exp.is_locked THEN
    RAISE EXCEPTION 'EXPORT_DRAFT_LOCKED: locked experiments export their signed record' USING ERRCODE = 'P0001';
  END IF;
  RETURN jsonb_build_object(
    'experiment', jsonb_build_object(
      'id', v_exp.id, 'experiment_id', v_exp.experiment_id, 'title', v_exp.title,
      'experiment_date', v_exp.experiment_date, 'status', v_exp.status, 'is_locked', v_exp.is_locked,
      'is_archived', v_exp.is_archived, 'current_revision', v_exp.current_revision,
      'metadata_version', v_exp.metadata_version),
    'snapshot', public._build_experiment_snapshot(p_experiment_id),
    'captured_at', statement_timestamp());
END; $function$;
REVOKE ALL ON FUNCTION public.capture_working_draft_export(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.capture_working_draft_export(uuid) TO authenticated;

-- 4. Revision integrity verification (SECURITY INVOKER: revision RLS is the read boundary).
CREATE OR REPLACE FUNCTION public.verify_experiment_revision(p_revision_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path TO ''
AS $function$
DECLARE r record; v_computed text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '42501'; END IF;
  SELECT id, experiment_id, revision_number, snapshot, content_hash, change_type, change_summary,
         created_at, created_by, metadata
    INTO r FROM public.experiment_revisions WHERE id = p_revision_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Revision not found or access denied' USING ERRCODE = '42501'; END IF;
  v_computed := CASE WHEN r.snapshot IS NULL THEN NULL ELSE public.canonical_snapshot_hash(r.snapshot) END;
  RETURN jsonb_build_object(
    'id', r.id, 'experiment_id', r.experiment_id, 'revision_number', r.revision_number,
    'snapshot', r.snapshot, 'content_hash', r.content_hash, 'computed_hash', v_computed,
    'integrity_ok', (r.content_hash IS NOT NULL AND v_computed IS NOT NULL AND v_computed = r.content_hash),
    'change_type', r.change_type, 'change_summary', r.change_summary,
    'created_at', r.created_at, 'created_by', r.created_by, 'metadata', r.metadata);
END; $function$;
REVOKE ALL ON FUNCTION public.verify_experiment_revision(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.verify_experiment_revision(uuid) TO authenticated;
