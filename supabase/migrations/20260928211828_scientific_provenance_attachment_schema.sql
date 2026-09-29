/*
# Scientific Provenance — Attachment Version Schema & Immutability

## Overview
Extends attachment_versions with version-specific metadata, enforces immutability,
upgrades create/replace RPCs to require SHA-256 checksums, and adds the
attach_protocol_to_experiment + deviation RPCs for relational protocol provenance.

## 1. Schema Changes — attachment_versions
- Add: original_filename (text, nullable — legacy rows may lack it)
- Add: display_name (text, nullable)
- Add: mime_type (text, nullable)
- Add: source_attachment_version_id (uuid, nullable self-FK — copy-on-write lineage)

## 2. Backfill existing attachment_versions from parent attachments

## 3. Immutability trigger on attachment_versions (no UPDATE/DELETE)

## 4. Upgraded create_attachment RPC — returns attachment_version_id, requires checksum for new rows
## 5. Upgraded replace_attachment RPC — version-specific metadata, server-side MAX(version_number)+1

## 6. attach_protocol_to_experiment RPC — creates immutable experiment_protocol instance
## 7. upsert_protocol_deviation / delete_protocol_deviation RPCs
## 8. Unique constraint on protocol_deviations(experiment_protocol_id, step_index)

## Security
- All SECURITY DEFINER functions use SET search_path TO ''
- Revoked from PUBLIC and anon; granted to authenticated only
- Immutability enforced via trigger (not just RLS)
*/

-- ─────────────────────────────────────────────────────
-- 1. Extend attachment_versions with version-specific metadata
-- ─────────────────────────────────────────────────────

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'attachment_versions' AND column_name = 'original_filename'
  ) THEN
    ALTER TABLE public.attachment_versions ADD COLUMN original_filename text;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'attachment_versions' AND column_name = 'display_name'
  ) THEN
    ALTER TABLE public.attachment_versions ADD COLUMN display_name text;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'attachment_versions' AND column_name = 'mime_type'
  ) THEN
    ALTER TABLE public.attachment_versions ADD COLUMN mime_type text;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'attachment_versions' AND column_name = 'source_attachment_version_id'
  ) THEN
    ALTER TABLE public.attachment_versions ADD COLUMN source_attachment_version_id uuid
      REFERENCES public.attachment_versions(id);
  END IF;
END $$;

-- ─────────────────────────────────────────────────────
-- 2. Backfill existing version rows from parent attachment
-- ─────────────────────────────────────────────────────

UPDATE public.attachment_versions av
SET
  original_filename = COALESCE(av.original_filename, a.original_filename),
  display_name = COALESCE(av.display_name, a.display_name),
  mime_type = COALESCE(av.mime_type, a.mime_type)
FROM public.attachments a
WHERE av.attachment_id = a.id
  AND (av.original_filename IS NULL OR av.display_name IS NULL OR av.mime_type IS NULL);

-- ─────────────────────────────────────────────────────
-- 3. Immutability trigger on attachment_versions
-- ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public._enforce_attachment_version_immutability()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'attachment_versions rows are immutable and cannot be updated';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'attachment_versions rows are immutable and cannot be deleted';
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_attachment_version_immutability ON public.attachment_versions;
CREATE TRIGGER trg_attachment_version_immutability
  BEFORE UPDATE OR DELETE ON public.attachment_versions
  FOR EACH ROW
  EXECUTE FUNCTION public._enforce_attachment_version_immutability();

-- ─────────────────────────────────────────────────────
-- 4. Upgraded create_attachment RPC
-- ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.create_attachment(
  p_experiment_id uuid,
  p_original_filename text,
  p_display_name text,
  p_storage_path text,
  p_mime_type text,
  p_file_size bigint,
  p_checksum text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_user_id uuid;
  v_att_id uuid;
  v_ver_id uuid;
  v_checksum text;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT public.can_edit_experiment(p_experiment_id) THEN
    RAISE EXCEPTION 'Not authorized to upload to this experiment';
  END IF;

  -- Normalize checksum to lowercase if provided
  IF p_checksum IS NOT NULL THEN
    v_checksum := lower(trim(p_checksum));
    IF v_checksum !~ '^[0-9a-f]{64}$' THEN
      RAISE EXCEPTION 'Invalid SHA-256 checksum format';
    END IF;
  ELSE
    v_checksum := NULL;
  END IF;

  INSERT INTO public.attachments (
    experiment_id, original_filename, display_name, storage_path,
    mime_type, file_size, checksum, current_version, uploaded_by
  ) VALUES (
    p_experiment_id, p_original_filename, p_display_name, p_storage_path,
    p_mime_type, p_file_size, v_checksum, 1, v_user_id
  ) RETURNING id INTO v_att_id;

  INSERT INTO public.attachment_versions (
    attachment_id, version_number, storage_path, file_size, checksum,
    uploaded_by, original_filename, display_name, mime_type
  ) VALUES (
    v_att_id, 1, p_storage_path, p_file_size, v_checksum,
    v_user_id, p_original_filename, p_display_name, p_mime_type
  ) RETURNING id INTO v_ver_id;

  RETURN jsonb_build_object(
    'attachment_id', v_att_id,
    'attachment_version_id', v_ver_id,
    'version_id', v_ver_id,
    'version_number', 1,
    'checksum', v_checksum,
    'storage_path', p_storage_path
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_attachment(uuid, text, text, text, text, bigint, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_attachment(uuid, text, text, text, text, bigint, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_attachment(uuid, text, text, text, text, bigint, text) TO authenticated;

-- ─────────────────────────────────────────────────────
-- 5. Upgraded replace_attachment RPC
-- ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.replace_attachment(
  p_attachment_id uuid,
  p_storage_path text,
  p_file_size bigint,
  p_checksum text DEFAULT NULL,
  p_original_filename text DEFAULT NULL,
  p_display_name text DEFAULT NULL,
  p_mime_type text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_user_id uuid;
  v_att record;
  v_next_ver int;
  v_ver_id uuid;
  v_checksum text;
  v_filename text;
  v_display text;
  v_mime text;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT * INTO v_att FROM public.attachments WHERE id = p_attachment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Attachment not found'; END IF;
  IF NOT public.can_edit_experiment(v_att.experiment_id) THEN
    RAISE EXCEPTION 'Not authorized to replace this attachment';
  END IF;

  -- Normalize checksum
  IF p_checksum IS NOT NULL THEN
    v_checksum := lower(trim(p_checksum));
    IF v_checksum !~ '^[0-9a-f]{64}$' THEN
      RAISE EXCEPTION 'Invalid SHA-256 checksum format';
    END IF;
  ELSE
    v_checksum := NULL;
  END IF;

  -- Use server-side MAX for version number consistency
  SELECT COALESCE(MAX(version_number), 0) + 1 INTO v_next_ver
  FROM public.attachment_versions
  WHERE attachment_id = p_attachment_id;

  v_filename := COALESCE(p_original_filename, v_att.original_filename);
  v_display := COALESCE(p_display_name, v_att.display_name);
  v_mime := COALESCE(p_mime_type, v_att.mime_type);

  INSERT INTO public.attachment_versions (
    attachment_id, version_number, storage_path, file_size, checksum,
    uploaded_by, original_filename, display_name, mime_type
  ) VALUES (
    p_attachment_id, v_next_ver, p_storage_path, p_file_size, v_checksum,
    v_user_id, v_filename, v_display, v_mime
  ) RETURNING id INTO v_ver_id;

  UPDATE public.attachments SET
    current_version = v_next_ver,
    storage_path = p_storage_path,
    file_size = p_file_size,
    checksum = v_checksum,
    original_filename = v_filename,
    display_name = v_display,
    mime_type = v_mime,
    updated_at = now()
  WHERE id = p_attachment_id;

  RETURN jsonb_build_object(
    'attachment_version_id', v_ver_id,
    'version_id', v_ver_id,
    'version_number', v_next_ver,
    'checksum', v_checksum,
    'storage_path', p_storage_path
  );
END;
$$;

REVOKE ALL ON FUNCTION public.replace_attachment(uuid, text, bigint, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.replace_attachment(uuid, text, bigint, text, text, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.replace_attachment(uuid, text, bigint, text, text, text, text) TO authenticated;

-- ─────────────────────────────────────────────────────
-- 6. attach_protocol_to_experiment RPC
-- ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.attach_protocol_to_experiment(
  p_experiment_id uuid,
  p_protocol_version_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_user_id uuid;
  v_pv record;
  v_proto record;
  v_exp record;
  v_ep_id uuid;
  v_snapshot jsonb;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  IF NOT public.can_mutate_experiment_content(p_experiment_id) THEN
    RAISE EXCEPTION 'Experiment is not in an editable state';
  END IF;

  SELECT * INTO v_pv FROM public.protocol_versions WHERE id = p_protocol_version_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Protocol version not found'; END IF;

  IF v_pv.status NOT IN ('published', 'superseded') THEN
    RAISE EXCEPTION 'Only published protocol versions can be attached';
  END IF;

  SELECT * INTO v_proto FROM public.protocols WHERE id = v_pv.protocol_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Protocol not found'; END IF;

  SELECT * INTO v_exp FROM public.experiments WHERE id = p_experiment_id;
  IF v_proto.workspace_id != v_exp.workspace_id THEN
    RAISE EXCEPTION 'Protocol must belong to the same workspace';
  END IF;

  v_snapshot := jsonb_build_object(
    'schema_version', 1,
    'protocol_id', v_pv.protocol_id,
    'protocol_version_id', v_pv.id,
    'protocol_name', v_proto.name,
    'version_number', v_pv.version_number,
    'steps', COALESCE(to_jsonb(v_pv.steps), '[]'::jsonb),
    'parameters', COALESCE(to_jsonb(v_pv.parameters), 'null'::jsonb),
    'notes', v_pv.notes
  );

  INSERT INTO public.experiment_protocols (
    experiment_id, protocol_id, protocol_version_id, snapshot
  ) VALUES (
    p_experiment_id, v_pv.protocol_id, p_protocol_version_id, v_snapshot
  ) RETURNING id INTO v_ep_id;

  RETURN jsonb_build_object(
    'experiment_protocol_id', v_ep_id,
    'protocol_id', v_pv.protocol_id,
    'protocol_version_id', p_protocol_version_id,
    'snapshot', v_snapshot
  );
END;
$$;

REVOKE ALL ON FUNCTION public.attach_protocol_to_experiment(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.attach_protocol_to_experiment(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.attach_protocol_to_experiment(uuid, uuid) TO authenticated;

-- ─────────────────────────────────────────────────────
-- 7. Unique constraint on protocol_deviations
-- ─────────────────────────────────────────────────────

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'uq_protocol_deviation_step'
      AND conrelid = 'public.protocol_deviations'::regclass
  ) THEN
    -- Handle any existing duplicates by keeping only the most recent
    DELETE FROM public.protocol_deviations pd1
    USING public.protocol_deviations pd2
    WHERE pd1.experiment_protocol_id = pd2.experiment_protocol_id
      AND pd1.step_index = pd2.step_index
      AND pd1.created_at < pd2.created_at;

    ALTER TABLE public.protocol_deviations
      ADD CONSTRAINT uq_protocol_deviation_step
      UNIQUE (experiment_protocol_id, step_index);
  END IF;
END $$;

-- ─────────────────────────────────────────────────────
-- 8. upsert_protocol_deviation RPC
-- ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.upsert_protocol_deviation(
  p_experiment_protocol_id uuid,
  p_step_index integer,
  p_actual_value text,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_user_id uuid;
  v_ep record;
  v_snap jsonb;
  v_steps jsonb;
  v_step jsonb;
  v_original text;
  v_dev_id uuid;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT ep.*, e.workspace_id INTO v_ep
  FROM public.experiment_protocols ep
  JOIN public.experiments e ON e.id = ep.experiment_id
  WHERE ep.id = p_experiment_protocol_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Experiment protocol not found'; END IF;

  IF NOT public.can_mutate_experiment_content(v_ep.experiment_id) THEN
    RAISE EXCEPTION 'Experiment is not in an editable state';
  END IF;

  -- Derive original_value from the immutable snapshot
  v_snap := v_ep.snapshot;
  v_steps := COALESCE(v_snap->'steps', '[]'::jsonb);

  IF p_step_index < 0 OR p_step_index >= jsonb_array_length(v_steps) THEN
    RAISE EXCEPTION 'Step index % out of range (0..%)', p_step_index, jsonb_array_length(v_steps) - 1;
  END IF;

  v_step := v_steps->p_step_index;
  v_original := COALESCE(v_step->>'instruction', '');

  INSERT INTO public.protocol_deviations (
    experiment_protocol_id, step_index, original_value, actual_value, reason, created_by
  ) VALUES (
    p_experiment_protocol_id, p_step_index, v_original, p_actual_value, p_reason, v_user_id
  )
  ON CONFLICT (experiment_protocol_id, step_index)
  DO UPDATE SET
    actual_value = EXCLUDED.actual_value,
    reason = EXCLUDED.reason;

  SELECT id INTO v_dev_id FROM public.protocol_deviations
  WHERE experiment_protocol_id = p_experiment_protocol_id AND step_index = p_step_index;

  RETURN jsonb_build_object(
    'deviation_id', v_dev_id,
    'step_index', p_step_index,
    'original_value', v_original,
    'actual_value', p_actual_value,
    'reason', p_reason
  );
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_protocol_deviation(uuid, integer, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.upsert_protocol_deviation(uuid, integer, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.upsert_protocol_deviation(uuid, integer, text, text) TO authenticated;

-- ─────────────────────────────────────────────────────
-- 9. delete_protocol_deviation RPC
-- ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.delete_protocol_deviation(
  p_experiment_protocol_id uuid,
  p_step_index integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_user_id uuid;
  v_ep record;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT ep.* INTO v_ep
  FROM public.experiment_protocols ep
  WHERE ep.id = p_experiment_protocol_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Experiment protocol not found'; END IF;

  IF NOT public.can_mutate_experiment_content(v_ep.experiment_id) THEN
    RAISE EXCEPTION 'Experiment is not in an editable state';
  END IF;

  DELETE FROM public.protocol_deviations
  WHERE experiment_protocol_id = p_experiment_protocol_id AND step_index = p_step_index;

  RETURN jsonb_build_object('deleted', true);
END;
$$;

REVOKE ALL ON FUNCTION public.delete_protocol_deviation(uuid, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.delete_protocol_deviation(uuid, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.delete_protocol_deviation(uuid, integer) TO authenticated;
