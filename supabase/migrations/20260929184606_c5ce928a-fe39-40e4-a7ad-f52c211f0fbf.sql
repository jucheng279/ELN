ALTER TABLE public.experiments ADD COLUMN IF NOT EXISTS metadata_version bigint NOT NULL DEFAULT 1;

DROP FUNCTION IF EXISTS public.update_experiment_metadata(uuid, text, date, uuid, uuid);

CREATE FUNCTION public.update_experiment_metadata(
  p_experiment_id uuid,
  p_expected_version bigint,
  p_title text DEFAULT NULL,
  p_experiment_date date DEFAULT NULL,
  p_notebook_id uuid DEFAULT NULL,
  p_folder_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE
  v_exp public.experiments%ROWTYPE;
  v_target_notebook uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF p_expected_version IS NULL THEN RAISE EXCEPTION 'Expected metadata version is required'; END IF;

  SELECT * INTO v_exp FROM public.experiments WHERE id = p_experiment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Experiment not found'; END IF;

  IF NOT public.is_workspace_editor(v_exp.workspace_id) THEN RAISE EXCEPTION 'Not authorized'; END IF;
  IF NOT public.can_mutate_experiment_content(p_experiment_id) THEN
    RAISE EXCEPTION 'Experiment is not in an editable state';
  END IF;

  IF v_exp.metadata_version <> p_expected_version THEN
    RAISE EXCEPTION 'Experiment metadata was changed by someone else (expected version %, current %)',
      p_expected_version, v_exp.metadata_version USING ERRCODE = '40001';
  END IF;

  IF p_title IS NOT NULL AND btrim(p_title) = '' THEN RAISE EXCEPTION 'Title cannot be empty'; END IF;

  IF p_notebook_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.notebooks WHERE id = p_notebook_id AND workspace_id = v_exp.workspace_id
  ) THEN
    RAISE EXCEPTION 'Notebook does not belong to this workspace';
  END IF;

  v_target_notebook := COALESCE(p_notebook_id, v_exp.notebook_id);

  IF p_folder_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.folders f WHERE f.id = p_folder_id AND f.notebook_id = v_target_notebook
  ) THEN
    RAISE EXCEPTION 'Folder does not belong to the target notebook';
  END IF;

  UPDATE public.experiments SET
    title = COALESCE(p_title, title),
    experiment_date = COALESCE(p_experiment_date, experiment_date),
    notebook_id = v_target_notebook,
    folder_id = CASE
      WHEN p_folder_id IS NOT NULL THEN p_folder_id
      WHEN p_notebook_id IS NOT NULL AND p_notebook_id <> v_exp.notebook_id THEN NULL
      ELSE folder_id END,
    metadata_version = metadata_version + 1,
    updated_at = now()
  WHERE id = p_experiment_id AND metadata_version = p_expected_version
  RETURNING * INTO v_exp;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Experiment metadata was changed by someone else' USING ERRCODE = '40001';
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'metadata_version', v_exp.metadata_version,
    'title', v_exp.title,
    'experiment_date', v_exp.experiment_date,
    'notebook_id', v_exp.notebook_id,
    'folder_id', v_exp.folder_id,
    'updated_at', v_exp.updated_at
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.update_experiment_metadata(uuid, bigint, text, date, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_experiment_metadata(uuid, bigint, text, date, uuid, uuid) TO authenticated;
