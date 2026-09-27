/*
# Lifecycle-Aware Content Mutation Guard

## Summary
Creates `can_mutate_experiment_content(p_experiment_id)` — the single authoritative
check for whether the calling user may modify scientific content (blocks, attachments,
protocol deviations, etc.) on a given experiment. Every content-write path — triggers,
RPCs, and RLS policies — must gate through this function.

## Changes

### New function: `can_mutate_experiment_content(uuid) -> boolean`
- Returns TRUE only when ALL of the following hold:
  1. Caller is authenticated (`auth.uid() IS NOT NULL`)
  2. Experiment exists and is not archived (`is_archived = false`)
  3. Experiment is not locked (`is_locked = false`)
  4. Experiment status is in a content-mutable phase: `draft` or `in_progress`
  5. Caller has editor (or owner) role in the experiment's workspace
- STABLE + SECURITY DEFINER with empty search_path

### Updated function: `can_edit_experiment(uuid) -> boolean`
- Now delegates to `can_mutate_experiment_content` for its core logic
- Kept as an alias for backward-compat with existing RLS policies

### Updated trigger: `enforce_block_lock()`
- Now uses `can_mutate_experiment_content()` instead of only checking `is_locked`
- This means blocks are protected by lifecycle status, not just the lock flag

## Security
- Both functions are SECURITY DEFINER with `SET search_path TO ''`
- Enforce workspace membership via `is_workspace_editor`
- No direct table grants changed
*/

-- 1. Create the authoritative mutation guard
CREATE OR REPLACE FUNCTION public.can_mutate_experiment_content(p_experiment_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO ''
AS $fn$
DECLARE
  v_exp record;
BEGIN
  IF auth.uid() IS NULL THEN RETURN false; END IF;

  SELECT workspace_id, status, is_locked, is_archived
    INTO v_exp
    FROM public.experiments
   WHERE id = p_experiment_id;

  IF NOT FOUND THEN RETURN false; END IF;
  IF v_exp.is_locked THEN RETURN false; END IF;
  IF v_exp.is_archived THEN RETURN false; END IF;
  IF v_exp.status NOT IN ('draft', 'in_progress') THEN RETURN false; END IF;

  RETURN public.is_workspace_editor(v_exp.workspace_id);
END;
$fn$;

-- 2. Update can_edit_experiment to delegate
CREATE OR REPLACE FUNCTION public.can_edit_experiment(p_experiment_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO ''
AS $fn$
BEGIN
  RETURN public.can_mutate_experiment_content(p_experiment_id);
END;
$fn$;

-- 3. Update enforce_block_lock to use lifecycle-aware check
CREATE OR REPLACE FUNCTION public.enforce_block_lock()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $fn$
DECLARE
  v_exp_id uuid;
  v_can_mutate boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_exp_id := OLD.experiment_id;
  ELSE
    v_exp_id := NEW.experiment_id;
  END IF;

  v_can_mutate := public.can_mutate_experiment_content(v_exp_id);

  IF NOT v_can_mutate THEN
    RAISE EXCEPTION 'Cannot modify blocks: experiment is not in a content-editable state';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$fn$;

-- Grant execute to authenticated role
GRANT EXECUTE ON FUNCTION public.can_mutate_experiment_content(uuid) TO authenticated;
