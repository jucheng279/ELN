/*
# Create duplicate_experiment_rpc function

1. New Functions
  - `duplicate_experiment_rpc(p_experiment_id uuid, p_include_blocks boolean, p_include_protocols boolean)`
    - SECURITY DEFINER function that duplicates an experiment
    - Copies experiment metadata, optionally blocks and protocol associations
    - Returns the new experiment row as JSON
2. Security
  - Validates caller is a workspace editor via is_workspace_editor()
  - REVOKE from PUBLIC and anon, GRANT only to authenticated
*/

CREATE OR REPLACE FUNCTION duplicate_experiment_rpc(
  p_experiment_id uuid,
  p_include_blocks boolean DEFAULT true,
  p_include_protocols boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_source experiments%ROWTYPE;
  v_new_id uuid;
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT * INTO v_source FROM experiments WHERE id = p_experiment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Experiment not found';
  END IF;

  IF NOT is_workspace_editor(v_source.workspace_id) THEN
    RAISE EXCEPTION 'Not authorized to duplicate experiments in this workspace';
  END IF;

  INSERT INTO experiments (
    workspace_id, notebook_id, folder_id, title, status,
    experiment_date, template_id, template_version_id, created_by
  ) VALUES (
    v_source.workspace_id, v_source.notebook_id, v_source.folder_id,
    v_source.title || ' (Copy)', 'draft',
    CURRENT_DATE, v_source.template_id, v_source.template_version_id, v_user_id
  ) RETURNING id INTO v_new_id;

  IF p_include_blocks THEN
    INSERT INTO experiment_blocks (experiment_id, type, content, order_key)
    SELECT v_new_id, type, content, order_key
    FROM experiment_blocks
    WHERE experiment_id = p_experiment_id
    ORDER BY order_key;
  END IF;

  IF p_include_protocols THEN
    INSERT INTO experiment_protocols (experiment_id, protocol_id, protocol_version_id, snapshot)
    SELECT v_new_id, protocol_id, protocol_version_id, snapshot
    FROM experiment_protocols
    WHERE experiment_id = p_experiment_id;
  END IF;

  RETURN jsonb_build_object('id', v_new_id);
END;
$$;

REVOKE EXECUTE ON FUNCTION duplicate_experiment_rpc FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION duplicate_experiment_rpc FROM anon;
GRANT EXECUTE ON FUNCTION duplicate_experiment_rpc TO authenticated;
