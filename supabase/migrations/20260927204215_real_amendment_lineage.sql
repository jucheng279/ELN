/*
# Real Amendment Lineage (Task 13)

## Summary
Replaces the current create_amendment behavior (unlock-in-place) with proper
scientific amendment lineage: a new experiment is created referencing the original
locked experiment as its amendment parent. The locked experiment remains locked
and immutable.

### Changes
- Adds `amended_from_id` column to experiments table (FK to self)
- Adds `amendment_reason` column to experiments table
- Rewrites `create_amendment` RPC to:
  1. Verify the source experiment is locked
  2. Create a NEW experiment copying title, blocks, and protocols
  3. Set the new experiment's amended_from_id to the source
  4. Leave the source experiment locked and untouched
  5. Return the new experiment's ID

### Security
- SECURITY DEFINER with empty search_path
- Checks workspace editor permission
*/

-- 1. Add amendment lineage columns
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'experiments' AND column_name = 'amended_from_id'
  ) THEN
    ALTER TABLE public.experiments ADD COLUMN amended_from_id uuid
      REFERENCES public.experiments(id);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'experiments' AND column_name = 'amendment_reason'
  ) THEN
    ALTER TABLE public.experiments ADD COLUMN amendment_reason text;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_experiments_amended_from ON public.experiments(amended_from_id)
  WHERE amended_from_id IS NOT NULL;

-- 2. Rewrite create_amendment to produce a new experiment
CREATE OR REPLACE FUNCTION public.create_amendment(p_experiment_id uuid, p_reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $fn$
DECLARE
  v_user_id uuid;
  v_src record;
  v_new_id uuid;
  v_new_number bigint;
  v_new_human_id text;
  v_block record;
  v_prev_key text := null;
  v_key text;
  v_proto record;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT * INTO v_src FROM public.experiments WHERE id = p_experiment_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Experiment not found'; END IF;
  IF v_src.status != 'locked' THEN RAISE EXCEPTION 'Only locked experiments can be amended'; END IF;
  IF NOT public.is_workspace_editor(v_src.workspace_id) THEN
    RAISE EXCEPTION 'Not authorized to create amendment';
  END IF;

  -- Create new experiment linked to the locked original
  INSERT INTO public.experiments (
    workspace_id, notebook_id, folder_id, title, status,
    experiment_date, template_id, template_version_id,
    amended_from_id, amendment_reason
  ) VALUES (
    v_src.workspace_id, v_src.notebook_id, v_src.folder_id,
    v_src.title || ' (Amendment)', 'draft',
    CURRENT_DATE, v_src.template_id, v_src.template_version_id,
    p_experiment_id, p_reason
  ) RETURNING id, experiment_number, experiment_id
    INTO v_new_id, v_new_number, v_new_human_id;

  -- Copy blocks from source
  FOR v_block IN
    SELECT type, content, order_key
    FROM public.experiment_blocks
    WHERE experiment_id = p_experiment_id
    ORDER BY order_key
  LOOP
    INSERT INTO public.experiment_blocks (experiment_id, type, content, order_key)
    VALUES (v_new_id, v_block.type, v_block.content, v_block.order_key);
  END LOOP;

  -- Copy protocol links from source
  FOR v_proto IN
    SELECT protocol_id, protocol_version_id, snapshot
    FROM public.experiment_protocols
    WHERE experiment_id = p_experiment_id
  LOOP
    INSERT INTO public.experiment_protocols (experiment_id, protocol_id, protocol_version_id, snapshot)
    VALUES (v_new_id, v_proto.protocol_id, v_proto.protocol_version_id, v_proto.snapshot);
  END LOOP;

  -- Audit event
  INSERT INTO public.audit_events (
    workspace_id, object_type, object_id, event_type, actor_id, metadata
  ) VALUES (
    v_src.workspace_id, 'experiment', v_new_id, 'amendment_created', v_user_id,
    jsonb_build_object('reason', p_reason, 'source_experiment_id', p_experiment_id)
  );

  RETURN jsonb_build_object(
    'id', v_new_id,
    'experiment_number', v_new_number,
    'experiment_id', v_new_human_id,
    'amended_from_id', p_experiment_id
  );
END;
$fn$;
