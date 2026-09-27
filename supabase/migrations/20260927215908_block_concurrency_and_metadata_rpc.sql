/*
# Add optimistic concurrency to blocks + experiment metadata RPC

1. New column: experiment_blocks.row_version (bigint, default 1)
2. Fixed: insert_experiment_block returns complete block row
3. Fixed: upsert_experiment_blocks checks row_version for conflict detection
4. New: update_experiment_metadata RPC for title/date/notebook/folder
5. Fixed: duplicate_experiment_rpc search_path
*/

-- ═══════════════════════════════════════════════════
-- 1. Add row_version to experiment_blocks
-- ═══════════════════════════════════════════════════
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'experiment_blocks' AND column_name = 'row_version'
  ) THEN
    ALTER TABLE public.experiment_blocks ADD COLUMN row_version bigint NOT NULL DEFAULT 1;
  END IF;
END $$;

-- ═══════════════════════════════════════════════════
-- 2. Fix insert_experiment_block to return full row
-- ═══════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.insert_experiment_block(
  p_experiment_id uuid,
  p_type text,
  p_content jsonb,
  p_order_key text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_block public.experiment_blocks%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT public.can_mutate_experiment_content(p_experiment_id) THEN
    RAISE EXCEPTION 'Experiment is not in an editable state';
  END IF;

  INSERT INTO public.experiment_blocks (experiment_id, type, content, order_key, created_by, updated_by)
  VALUES (p_experiment_id, p_type, p_content, p_order_key, auth.uid(), auth.uid())
  RETURNING * INTO v_block;

  RETURN jsonb_build_object(
    'id', v_block.id,
    'experiment_id', v_block.experiment_id,
    'type', v_block.type,
    'content', v_block.content,
    'order_key', v_block.order_key,
    'row_version', v_block.row_version,
    'created_by', v_block.created_by,
    'updated_by', v_block.updated_by,
    'created_at', v_block.created_at,
    'updated_at', v_block.updated_at
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.insert_experiment_block FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.insert_experiment_block FROM anon;
GRANT EXECUTE ON FUNCTION public.insert_experiment_block TO authenticated;

-- ═══════════════════════════════════════════════════
-- 3. Drop and recreate upsert_experiment_blocks
-- ═══════════════════════════════════════════════════
DROP FUNCTION IF EXISTS public.upsert_experiment_blocks(uuid, jsonb);

CREATE FUNCTION public.upsert_experiment_blocks(
  p_experiment_id uuid,
  p_blocks jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_block jsonb;
  v_block_id uuid;
  v_expected_version bigint;
  v_actual_version bigint;
  v_updated_count int := 0;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT public.can_mutate_experiment_content(p_experiment_id) THEN
    RAISE EXCEPTION 'Experiment is not in an editable state';
  END IF;

  FOR v_block IN SELECT * FROM jsonb_array_elements(p_blocks) LOOP
    v_block_id := (v_block->>'id')::uuid;
    v_expected_version := COALESCE((v_block->>'row_version')::bigint, 0);

    IF v_expected_version > 0 THEN
      SELECT row_version INTO v_actual_version
      FROM public.experiment_blocks
      WHERE id = v_block_id AND experiment_id = p_experiment_id
      FOR UPDATE;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Block % not found', v_block_id;
      END IF;

      IF v_actual_version != v_expected_version THEN
        RAISE EXCEPTION 'CONFLICT: block % version mismatch (expected %, actual %)',
          v_block_id, v_expected_version, v_actual_version
        USING ERRCODE = 'serialization_failure';
      END IF;
    ELSE
      PERFORM 1 FROM public.experiment_blocks
      WHERE id = v_block_id AND experiment_id = p_experiment_id
      FOR UPDATE;
    END IF;

    UPDATE public.experiment_blocks
    SET type = COALESCE(v_block->>'type', type),
        content = COALESCE((v_block->'content')::jsonb, content),
        order_key = COALESCE(v_block->>'order_key', order_key),
        updated_by = auth.uid(),
        updated_at = now(),
        row_version = row_version + 1
    WHERE id = v_block_id AND experiment_id = p_experiment_id;

    v_updated_count := v_updated_count + 1;
  END LOOP;

  RETURN jsonb_build_object('updated', v_updated_count);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.upsert_experiment_blocks FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.upsert_experiment_blocks FROM anon;
GRANT EXECUTE ON FUNCTION public.upsert_experiment_blocks TO authenticated;

-- ═══════════════════════════════════════════════════
-- 4. Create update_experiment_metadata RPC
-- ═══════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.update_experiment_metadata(
  p_experiment_id uuid,
  p_title text DEFAULT NULL,
  p_experiment_date date DEFAULT NULL,
  p_notebook_id uuid DEFAULT NULL,
  p_folder_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_exp public.experiments%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT * INTO v_exp FROM public.experiments WHERE id = p_experiment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Experiment not found'; END IF;

  IF NOT public.is_workspace_editor(v_exp.workspace_id) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  IF NOT public.can_mutate_experiment_content(p_experiment_id) THEN
    RAISE EXCEPTION 'Experiment is not in an editable state';
  END IF;

  IF p_notebook_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.notebooks
      WHERE id = p_notebook_id AND workspace_id = v_exp.workspace_id
    ) THEN
      RAISE EXCEPTION 'Notebook does not belong to this workspace';
    END IF;
  END IF;

  IF p_folder_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.folders f
      JOIN public.notebooks n ON n.id = f.notebook_id
      WHERE f.id = p_folder_id AND n.workspace_id = v_exp.workspace_id
    ) THEN
      RAISE EXCEPTION 'Folder does not belong to this workspace';
    END IF;
  END IF;

  UPDATE public.experiments SET
    title = COALESCE(p_title, title),
    experiment_date = COALESCE(p_experiment_date, experiment_date),
    notebook_id = COALESCE(p_notebook_id, notebook_id),
    folder_id = CASE WHEN p_folder_id IS NOT NULL THEN p_folder_id ELSE folder_id END,
    updated_at = now()
  WHERE id = p_experiment_id;

  RETURN jsonb_build_object('success', true);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.update_experiment_metadata FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.update_experiment_metadata FROM anon;
GRANT EXECUTE ON FUNCTION public.update_experiment_metadata TO authenticated;

-- ═══════════════════════════════════════════════════
-- 5. Fix duplicate_experiment_rpc search_path
-- ═══════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.duplicate_experiment_rpc(
  p_experiment_id uuid,
  p_include_blocks boolean DEFAULT true,
  p_include_protocols boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_source public.experiments%ROWTYPE;
  v_new_id uuid;
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT * INTO v_source FROM public.experiments WHERE id = p_experiment_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Experiment not found'; END IF;

  IF NOT public.is_workspace_editor(v_source.workspace_id) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  INSERT INTO public.experiments (
    workspace_id, notebook_id, folder_id, title, status,
    experiment_date, template_id, template_version_id, created_by
  ) VALUES (
    v_source.workspace_id, v_source.notebook_id, v_source.folder_id,
    v_source.title || ' (Copy)', 'draft',
    CURRENT_DATE, v_source.template_id, v_source.template_version_id, v_user_id
  ) RETURNING id INTO v_new_id;

  IF p_include_blocks THEN
    INSERT INTO public.experiment_blocks (experiment_id, type, content, order_key, created_by, updated_by)
    SELECT v_new_id, type, content, order_key, v_user_id, v_user_id
    FROM public.experiment_blocks
    WHERE experiment_id = p_experiment_id
    ORDER BY order_key;
  END IF;

  IF p_include_protocols THEN
    INSERT INTO public.experiment_protocols (experiment_id, protocol_id, protocol_version_id, snapshot)
    SELECT v_new_id, protocol_id, protocol_version_id, snapshot
    FROM public.experiment_protocols
    WHERE experiment_id = p_experiment_id;
  END IF;

  RETURN jsonb_build_object('id', v_new_id);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.duplicate_experiment_rpc FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.duplicate_experiment_rpc FROM anon;
GRANT EXECUTE ON FUNCTION public.duplicate_experiment_rpc TO authenticated;
