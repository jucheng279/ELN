-- Cycle 1: scientific provenance convergence (forward-only)

-- 1. replace_attachment: server-derived lineage
CREATE OR REPLACE FUNCTION public.replace_attachment(
  p_attachment_id uuid, p_storage_path text, p_file_size bigint,
  p_checksum text DEFAULT NULL, p_original_filename text DEFAULT NULL,
  p_display_name text DEFAULT NULL, p_mime_type text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE
  v_user_id uuid; v_att record; v_prev record; v_next_ver int; v_ver_id uuid;
  v_checksum text; v_filename text; v_display text; v_mime text;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  -- Row lock serializes concurrent replacements of the same attachment
  SELECT * INTO v_att FROM public.attachments WHERE id = p_attachment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Attachment not found'; END IF;
  IF NOT public.can_edit_experiment(v_att.experiment_id) THEN
    RAISE EXCEPTION 'Not authorized to replace this attachment';
  END IF;

  IF p_checksum IS NOT NULL THEN
    v_checksum := lower(trim(p_checksum));
    IF v_checksum !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'Invalid SHA-256 checksum format'; END IF;
  END IF;

  SELECT id, version_number INTO v_prev
  FROM public.attachment_versions
  WHERE attachment_id = p_attachment_id
  ORDER BY version_number DESC LIMIT 1;

  v_next_ver := COALESCE(v_prev.version_number, 0) + 1;
  v_filename := COALESCE(p_original_filename, v_att.original_filename);
  v_display  := COALESCE(p_display_name, v_att.display_name);
  v_mime     := COALESCE(p_mime_type, v_att.mime_type);

  INSERT INTO public.attachment_versions (
    attachment_id, version_number, storage_path, file_size, checksum,
    uploaded_by, original_filename, display_name, mime_type, source_attachment_version_id
  ) VALUES (
    p_attachment_id, v_next_ver, p_storage_path, p_file_size, v_checksum,
    v_user_id, v_filename, v_display, v_mime, v_prev.id
  ) RETURNING id INTO v_ver_id;

  UPDATE public.attachments SET
    current_version = v_next_ver, storage_path = p_storage_path, file_size = p_file_size,
    checksum = v_checksum, original_filename = v_filename, display_name = v_display,
    mime_type = v_mime, updated_at = now()
  WHERE id = p_attachment_id;

  RETURN jsonb_build_object(
    'attachment_version_id', v_ver_id, 'version_id', v_ver_id,
    'version_number', v_next_ver, 'checksum', v_checksum,
    'storage_path', p_storage_path, 'source_attachment_version_id', v_prev.id);
END; $$;

-- Legacy 4-arg overload: delegate (previously skipped checksum validation, locking, lineage)
CREATE OR REPLACE FUNCTION public.replace_attachment(
  p_attachment_id uuid, p_storage_path text, p_file_size bigint, p_checksum text DEFAULT NULL)
RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path TO '' AS $$
  SELECT public.replace_attachment(p_attachment_id, p_storage_path, p_file_size, p_checksum,
    NULL::text, NULL::text, NULL::text);
$$;

REVOKE ALL ON FUNCTION public.replace_attachment(uuid, text, bigint, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.replace_attachment(uuid, text, bigint, text, text, text, text) TO authenticated;
REVOKE ALL ON FUNCTION public.replace_attachment(uuid, text, bigint, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.replace_attachment(uuid, text, bigint, text) TO authenticated;

-- 2. Safe UUID parse helper (internal)
CREATE OR REPLACE FUNCTION public._try_uuid(p text)
RETURNS uuid LANGUAGE sql IMMUTABLE SET search_path TO '' AS $$
  SELECT CASE WHEN p ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              THEN p::uuid END;
$$;
REVOKE ALL ON FUNCTION public._try_uuid(text) FROM PUBLIC, anon, authenticated;

-- 3. Deterministic schema-v2 snapshot, derived only from referenced pinned provenance
CREATE OR REPLACE FUNCTION public._build_experiment_snapshot(p_experiment_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE
  v_exp record; v_blocks jsonb; v_att_prov jsonb; v_prot_prov jsonb;
  v_legacy_protocols jsonb; v_legacy_devs jsonb; v_legacy_atts jsonb;
BEGIN
  SELECT id, title, experiment_date, template_id, template_version_id
  INTO v_exp FROM public.experiments WHERE id = p_experiment_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Experiment not found'; END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', b.id, 'type', b.type, 'content', b.content, 'order_key', b.order_key
  ) ORDER BY b.order_key, b.id), '[]'::jsonb) INTO v_blocks
  FROM public.experiment_blocks b WHERE b.experiment_id = p_experiment_id;

  -- One entry per (block, pinned version); all fields immutable version data
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'block_id', b.id,
      'attachment_id', av.attachment_id,
      'attachment_version_id', av.id,
      'version_number', av.version_number,
      'storage_path', av.storage_path,
      'checksum', av.checksum,
      'file_size', av.file_size,
      'original_filename', av.original_filename,
      'display_name', av.display_name,
      'mime_type', av.mime_type
    ) ORDER BY b.order_key, b.id, av.id), '[]'::jsonb)
  INTO v_att_prov
  FROM public.experiment_blocks b
  JOIN public.attachment_versions av ON av.id = public._try_uuid(b.content->>'attachmentVersionId')
  JOIN public.attachments a ON a.id = av.attachment_id AND a.experiment_id = p_experiment_id
  WHERE b.experiment_id = p_experiment_id AND b.type IN ('image', 'attachment');

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'block_id', b.id,
      'experiment_protocol_id', ep.id,
      'protocol_id', ep.protocol_id,
      'protocol_version_id', ep.protocol_version_id,
      'snapshot', ep.snapshot,
      'deviations', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'step_index', pd.step_index, 'original_value', pd.original_value,
          'actual_value', pd.actual_value, 'reason', pd.reason, 'created_by', pd.created_by
        ) ORDER BY pd.step_index)
        FROM public.protocol_deviations pd WHERE pd.experiment_protocol_id = ep.id), '[]'::jsonb)
    ) ORDER BY b.order_key, b.id), '[]'::jsonb)
  INTO v_prot_prov
  FROM public.experiment_blocks b
  JOIN public.experiment_protocols ep
    ON ep.id = public._try_uuid(b.content->>'experiment_protocol_id') AND ep.experiment_id = p_experiment_id
  WHERE b.experiment_id = p_experiment_id AND b.type = 'protocol';

  -- Legacy compatibility fields, derived from the referenced provenance set only
  SELECT COALESCE(jsonb_agg(x ORDER BY x->>'id'), '[]'::jsonb) INTO v_legacy_protocols
  FROM (SELECT DISTINCT jsonb_build_object(
          'id', p->>'experiment_protocol_id', 'protocol_id', p->>'protocol_id',
          'protocol_version_id', p->>'protocol_version_id', 'snapshot', p->'snapshot') x
        FROM jsonb_array_elements(v_prot_prov) p) s;

  SELECT COALESCE(jsonb_agg(x ORDER BY x->>'experiment_protocol_id', (x->>'step_index')::int), '[]'::jsonb)
  INTO v_legacy_devs
  FROM (SELECT DISTINCT d || jsonb_build_object('experiment_protocol_id', p->>'experiment_protocol_id') x
        FROM jsonb_array_elements(v_prot_prov) p, jsonb_array_elements(p->'deviations') d) s;

  SELECT COALESCE(jsonb_agg(x ORDER BY x->>'id', (x->>'current_version')::int), '[]'::jsonb)
  INTO v_legacy_atts
  FROM (SELECT DISTINCT jsonb_build_object(
          'id', p->>'attachment_id',
          'original_filename', p->>'original_filename',
          'display_name', p->>'display_name',
          'mime_type', p->>'mime_type',
          'current_version', (p->>'version_number')::int,
          'checksum', p->>'checksum',
          'file_size', p->'file_size',
          'current_version_detail', jsonb_build_object(
            'id', p->>'attachment_version_id', 'version_number', (p->>'version_number')::int,
            'storage_path', p->>'storage_path', 'checksum', p->>'checksum', 'file_size', p->'file_size')
        ) x FROM jsonb_array_elements(v_att_prov) p) s;

  RETURN jsonb_build_object(
    'schema_version', 2,
    'title', v_exp.title,
    'experiment_date', v_exp.experiment_date,
    'template_id', v_exp.template_id,
    'template_version_id', v_exp.template_version_id,
    'blocks', v_blocks,
    'tags', COALESCE((SELECT jsonb_agg(t.name ORDER BY t.name)
      FROM public.experiment_tags et JOIN public.tags t ON t.id = et.tag_id
      WHERE et.experiment_id = p_experiment_id), '[]'::jsonb),
    'attachment_provenance', v_att_prov,
    'protocol_provenance', v_prot_prov,
    'protocols', v_legacy_protocols,
    'deviations', v_legacy_devs,
    'attachments', v_legacy_atts,
    'references', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id', r.id, 'doi', r.doi, 'url', r.url, 'title', r.title,
        'citation', r.citation, 'notes', r.notes) ORDER BY r.id)
      FROM public.experiment_references r WHERE r.experiment_id = p_experiment_id), '[]'::jsonb),
    'relations', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id', rl.id, 'target_experiment_id', rl.target_experiment_id,
        'relation_type', rl.relation_type) ORDER BY rl.id)
      FROM public.experiment_relations rl WHERE rl.source_experiment_id = p_experiment_id), '[]'::jsonb),
    'contributors', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'id', ec.id, 'user_id', ec.user_id, 'role', ec.role) ORDER BY ec.id)
      FROM public.experiment_contributors ec WHERE ec.experiment_id = p_experiment_id), '[]'::jsonb)
  );
END; $$;
REVOKE ALL ON FUNCTION public._build_experiment_snapshot(uuid) FROM PUBLIC, anon, authenticated;

-- 4. Block provenance validation (deferred so duplicate/amend/restore can rewrite refs in-transaction)
CREATE OR REPLACE FUNCTION public._validate_block_provenance()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE
  v_cur record; v_raw text; v_id uuid; v_old_raw text;
BEGIN
  -- Validate the row's final state at commit
  SELECT id, experiment_id, type, content INTO v_cur
  FROM public.experiment_blocks WHERE id = NEW.id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  IF v_cur.type IN ('image', 'attachment') THEN
    v_raw := v_cur.content->>'attachmentVersionId';
    IF TG_OP = 'UPDATE' THEN v_old_raw := OLD.content->>'attachmentVersionId'; END IF;
    IF v_raw IS NOT NULL AND v_raw <> ''
       AND (TG_OP = 'INSERT' OR v_raw IS DISTINCT FROM v_old_raw
            OR OLD.experiment_id <> v_cur.experiment_id OR OLD.type <> v_cur.type) THEN
      v_id := public._try_uuid(v_raw);
      IF v_id IS NULL THEN
        RAISE EXCEPTION 'Invalid attachmentVersionId on block %', v_cur.id USING ERRCODE = '22023';
      END IF;
      PERFORM 1 FROM public.attachment_versions av
        JOIN public.attachments a ON a.id = av.attachment_id
        WHERE av.id = v_id AND a.experiment_id = v_cur.experiment_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'attachmentVersionId % does not belong to experiment %', v_id, v_cur.experiment_id
          USING ERRCODE = '23503';
      END IF;
    END IF;
  ELSIF v_cur.type = 'protocol' THEN
    v_raw := v_cur.content->>'experiment_protocol_id';
    IF TG_OP = 'UPDATE' THEN v_old_raw := OLD.content->>'experiment_protocol_id'; END IF;
    IF v_raw IS NOT NULL AND v_raw <> ''
       AND (TG_OP = 'INSERT' OR v_raw IS DISTINCT FROM v_old_raw
            OR OLD.experiment_id <> v_cur.experiment_id OR OLD.type <> v_cur.type) THEN
      v_id := public._try_uuid(v_raw);
      IF v_id IS NULL THEN
        RAISE EXCEPTION 'Invalid experiment_protocol_id on block %', v_cur.id USING ERRCODE = '22023';
      END IF;
      PERFORM 1 FROM public.experiment_protocols ep
        WHERE ep.id = v_id AND ep.experiment_id = v_cur.experiment_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'experiment_protocol_id % does not belong to experiment %', v_id, v_cur.experiment_id
          USING ERRCODE = '23503';
      END IF;
    END IF;
  END IF;
  RETURN NULL;
END; $$;
REVOKE ALL ON FUNCTION public._validate_block_provenance() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_validate_block_provenance ON public.experiment_blocks;
CREATE CONSTRAINT TRIGGER trg_validate_block_provenance
  AFTER INSERT OR UPDATE ON public.experiment_blocks
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public._validate_block_provenance();
