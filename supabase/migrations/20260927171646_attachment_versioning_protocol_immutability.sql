-- ============================================================
-- 1. ATTACHMENT UPLOAD RPC (creates attachment + version + returns storage path)
-- ============================================================
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
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_user_id uuid; v_exp record; v_att_id uuid; v_ver_id uuid;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT public.can_edit_experiment(p_experiment_id) THEN
    RAISE EXCEPTION 'Not authorized to upload to this experiment';
  END IF;

  SELECT workspace_id INTO v_exp FROM public.experiments WHERE id = p_experiment_id;

  INSERT INTO public.attachments (experiment_id, original_filename, display_name, storage_path, mime_type, file_size, checksum, current_version, uploaded_by)
  VALUES (p_experiment_id, p_original_filename, p_display_name, p_storage_path, p_mime_type, p_file_size, p_checksum, 1, v_user_id)
  RETURNING id INTO v_att_id;

  INSERT INTO public.attachment_versions (attachment_id, version_number, storage_path, file_size, checksum, uploaded_by)
  VALUES (v_att_id, 1, p_storage_path, p_file_size, p_checksum, v_user_id)
  RETURNING id INTO v_ver_id;

  RETURN jsonb_build_object('attachment_id', v_att_id, 'version_id', v_ver_id, 'version_number', 1);
END; $$;

-- ============================================================
-- 2. REPLACE ATTACHMENT (new version, old version retained)
-- ============================================================
CREATE OR REPLACE FUNCTION public.replace_attachment(
  p_attachment_id uuid,
  p_storage_path text,
  p_file_size bigint,
  p_checksum text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_user_id uuid; v_att record; v_next_ver int; v_ver_id uuid;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT * INTO v_att FROM public.attachments WHERE id = p_attachment_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Attachment not found'; END IF;
  IF NOT public.can_edit_experiment(v_att.experiment_id) THEN
    RAISE EXCEPTION 'Not authorized to replace this attachment';
  END IF;

  v_next_ver := v_att.current_version + 1;

  INSERT INTO public.attachment_versions (attachment_id, version_number, storage_path, file_size, checksum, uploaded_by)
  VALUES (p_attachment_id, v_next_ver, p_storage_path, p_file_size, p_checksum, v_user_id)
  RETURNING id INTO v_ver_id;

  UPDATE public.attachments SET current_version = v_next_ver, storage_path = p_storage_path, file_size = p_file_size, checksum = p_checksum, updated_at = now()
  WHERE id = p_attachment_id;

  RETURN jsonb_build_object('version_id', v_ver_id, 'version_number', v_next_ver);
END; $$;

-- ============================================================
-- 3. ARCHIVE ATTACHMENT (soft delete, history retained)
-- ============================================================
CREATE OR REPLACE FUNCTION public.archive_attachment(p_attachment_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_att record;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT * INTO v_att FROM public.attachments WHERE id = p_attachment_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Attachment not found'; END IF;
  IF NOT public.can_edit_experiment(v_att.experiment_id) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;
  UPDATE public.attachments SET is_archived = true, updated_at = now() WHERE id = p_attachment_id;
END; $$;

-- ============================================================
-- 4. PROTOCOL VERSION IMMUTABILITY
-- Prevent updates to published/superseded protocol versions
-- ============================================================
CREATE OR REPLACE FUNCTION public.enforce_protocol_version_immutability()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status IN ('published', 'superseded') AND NEW.status != OLD.status THEN
    IF NEW.status NOT IN ('superseded') THEN
      RAISE EXCEPTION 'Published protocol versions are immutable';
    END IF;
  END IF;
  IF OLD.status IN ('published', 'superseded') THEN
    IF NEW.steps IS DISTINCT FROM OLD.steps
       OR NEW.parameters IS DISTINCT FROM OLD.parameters
       OR NEW.notes IS DISTINCT FROM OLD.notes THEN
      RAISE EXCEPTION 'Cannot modify content of a published protocol version';
    END IF;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_protocol_version_immutability ON public.protocol_versions;
CREATE TRIGGER trg_protocol_version_immutability
  BEFORE UPDATE ON public.protocol_versions
  FOR EACH ROW EXECUTE FUNCTION public.enforce_protocol_version_immutability();

-- Same for template versions
CREATE OR REPLACE FUNCTION public.enforce_template_version_immutability()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status IN ('published', 'superseded') AND NEW.status != OLD.status THEN
    IF NEW.status NOT IN ('superseded') THEN
      RAISE EXCEPTION 'Published template versions are immutable';
    END IF;
  END IF;
  IF OLD.status IN ('published', 'superseded') THEN
    IF NEW.content IS DISTINCT FROM OLD.content
       OR NEW.metadata IS DISTINCT FROM OLD.metadata THEN
      RAISE EXCEPTION 'Cannot modify content of a published template version';
    END IF;
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_template_version_immutability ON public.template_versions;
CREATE TRIGGER trg_template_version_immutability
  BEFORE UPDATE ON public.template_versions
  FOR EACH ROW EXECUTE FUNCTION public.enforce_template_version_immutability();

-- ============================================================
-- 5. PUBLISH PROTOCOL RPC
-- ============================================================
CREATE OR REPLACE FUNCTION public.publish_protocol_version(
  p_protocol_id uuid, p_version_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_user_id uuid; v_protocol record; v_version record;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT * INTO v_protocol FROM public.protocols WHERE id = p_protocol_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Protocol not found'; END IF;
  IF NOT public.is_workspace_editor(v_protocol.workspace_id) THEN
    RAISE EXCEPTION 'Not authorized to publish';
  END IF;

  SELECT * INTO v_version FROM public.protocol_versions WHERE id = p_version_id AND protocol_id = p_protocol_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Version not found'; END IF;
  IF v_version.status != 'draft' THEN RAISE EXCEPTION 'Only draft versions can be published'; END IF;

  -- Supersede current published version
  UPDATE public.protocol_versions SET status = 'superseded'
    WHERE protocol_id = p_protocol_id AND status = 'published';

  UPDATE public.protocol_versions SET status = 'published', published_at = now()
    WHERE id = p_version_id;

  UPDATE public.protocols SET current_version = v_version.version_number, status = 'published', updated_at = now()
    WHERE id = p_protocol_id;

  RETURN jsonb_build_object('version_id', p_version_id, 'version_number', v_version.version_number);
END; $$;

-- ============================================================
-- 6. TRANSACTIONAL EXPERIMENT CREATION RPC
-- ============================================================
CREATE OR REPLACE FUNCTION public.create_experiment_rpc(
  p_workspace_id uuid,
  p_notebook_id uuid,
  p_title text DEFAULT 'Untitled Experiment',
  p_template_version_id uuid DEFAULT NULL,
  p_folder_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_user_id uuid; v_exp_id uuid; v_exp_number int; v_exp_human_id text;
  v_tv record; v_prev_key text; v_block_key text;
  v_block record; v_rev_result jsonb;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT public.is_workspace_editor(p_workspace_id) THEN
    RAISE EXCEPTION 'Not authorized to create experiments in this workspace';
  END IF;

  INSERT INTO public.experiments (workspace_id, notebook_id, folder_id, title, status, experiment_date, template_version_id)
  VALUES (p_workspace_id, p_notebook_id, p_folder_id, p_title, 'draft', CURRENT_DATE, p_template_version_id)
  RETURNING id, experiment_number, experiment_id INTO v_exp_id, v_exp_number, v_exp_human_id;

  -- Instantiate template blocks if provided
  IF p_template_version_id IS NOT NULL THEN
    SELECT * INTO v_tv FROM public.template_versions WHERE id = p_template_version_id;
    IF v_tv IS NOT NULL AND v_tv.content IS NOT NULL AND jsonb_typeof(v_tv.content) = 'array' THEN
      v_prev_key := NULL;
      FOR v_block IN SELECT * FROM jsonb_array_elements(v_tv.content) AS elem
      LOOP
        -- Generate simple sequential keys: a0, a1, a2...
        v_block_key := 'a' || COALESCE(v_prev_key, '') || lpad((COALESCE(LENGTH(v_prev_key), 0))::text, 1, '0');
        -- Simpler: just use sequential numbered keys
        v_prev_key := v_block_key;

        INSERT INTO public.experiment_blocks (experiment_id, type, content, order_key)
        VALUES (v_exp_id,
                COALESCE(v_block.elem->>'type', 'paragraph'),
                COALESCE(v_block.elem->'content', '{}'::jsonb),
                v_block_key);
      END LOOP;
    END IF;
  END IF;

  -- Create initial audit event
  INSERT INTO public.audit_events (workspace_id, object_type, object_id, event_type, actor_id, metadata)
  VALUES (p_workspace_id, 'experiment', v_exp_id, 'created', v_user_id,
          jsonb_build_object('title', p_title, 'template_version_id', p_template_version_id));

  RETURN jsonb_build_object('id', v_exp_id, 'experiment_number', v_exp_number, 'experiment_id', v_exp_human_id);
END; $$;

-- ============================================================
-- 7. HARDEN STORAGE RLS — validate experiment existence + edit permission
-- ============================================================
DROP POLICY IF EXISTS "Workspace members can upload files" ON storage.objects;
CREATE POLICY "Authorized editors can upload files"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'eln-files'
  AND (storage.foldername(name))[1] IS NOT NULL
  AND (storage.foldername(name))[2] IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM public.experiments e
    WHERE e.workspace_id = ((storage.foldername(name))[1])::uuid
    AND e.id = ((storage.foldername(name))[2])::uuid
    AND NOT e.is_locked
  )
  AND public.is_workspace_editor(((storage.foldername(name))[1])::uuid)
);

DROP POLICY IF EXISTS "Workspace members can delete files" ON storage.objects;
CREATE POLICY "Authorized editors can delete files"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'eln-files'
  AND (storage.foldername(name))[1] IS NOT NULL
  AND (storage.foldername(name))[2] IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM public.experiments e
    WHERE e.workspace_id = ((storage.foldername(name))[1])::uuid
    AND e.id = ((storage.foldername(name))[2])::uuid
    AND NOT e.is_locked
  )
  AND public.is_workspace_editor(((storage.foldername(name))[1])::uuid)
);
