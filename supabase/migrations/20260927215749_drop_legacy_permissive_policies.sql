/*
# Drop legacy permissive policies that bypass lifecycle controls

1. Problem
  - PostgreSQL OR's permissive policies. The newer lifecycle-gated policies
    (insert_et, delete_et, etc.) are bypassed by older member-only policies
    (insert_exp_tags, delete_exp_tags, etc.) that remain from early migrations.
  - Direct experiment INSERT/UPDATE/DELETE policies allow bypassing domain RPCs.
  - Direct block INSERT/UPDATE/DELETE policies allow bypassing block RPCs.

2. Policies removed (legacy bypasses)
  - experiment_tags: insert_exp_tags, update_exp_tags, delete_exp_tags
  - experiment_references: insert_ref, update_ref, delete_ref
  - experiment_relations: insert_er, update_er, delete_er
  - experiment_contributors: insert_contributors, update_contributors, delete_contributors
  - experiment_protocols: delete_ep (member-only, no lifecycle check)
  - protocol_deviations: delete_pd (member-only, no lifecycle check)
  - experiment_blocks: insert_blocks, update_blocks, delete_blocks (editor-only, no lifecycle)
  - experiments: insert_experiments, update_experiments, delete_experiments (direct writes)

3. Policies kept or replaced
  - Lifecycle-gated policies (insert_et, delete_et, etc.) remain as they enforce
    can_mutate_experiment_content checks.
  - experiment_blocks: all direct writes removed; RPCs are the only write path.
  - experiments: all direct writes removed; RPCs are the only write path.

4. New CHECK constraint on experiments for lifecycle consistency
  - status='locked' requires is_locked=true
  - status='archived' requires is_archived=true
  - is_locked=true only allowed when status IN ('locked','archived')
  - is_archived=true only allowed when status='archived'
*/

-- ═══════════════════════════════════════════════════
-- 1. Drop legacy experiment_tags policies
-- ═══════════════════════════════════════════════════
DROP POLICY IF EXISTS "insert_exp_tags" ON public.experiment_tags;
DROP POLICY IF EXISTS "update_exp_tags" ON public.experiment_tags;
DROP POLICY IF EXISTS "delete_exp_tags" ON public.experiment_tags;

-- ═══════════════════════════════════════════════════
-- 2. Drop legacy experiment_references policies
-- ═══════════════════════════════════════════════════
DROP POLICY IF EXISTS "insert_ref" ON public.experiment_references;
DROP POLICY IF EXISTS "update_ref" ON public.experiment_references;
DROP POLICY IF EXISTS "delete_ref" ON public.experiment_references;

-- ═══════════════════════════════════════════════════
-- 3. Drop legacy experiment_relations policies
-- ═══════════════════════════════════════════════════
DROP POLICY IF EXISTS "insert_er" ON public.experiment_relations;
DROP POLICY IF EXISTS "update_er" ON public.experiment_relations;
DROP POLICY IF EXISTS "delete_er" ON public.experiment_relations;

-- ═══════════════════════════════════════════════════
-- 4. Drop legacy experiment_contributors policies
-- ═══════════════════════════════════════════════════
DROP POLICY IF EXISTS "insert_contributors" ON public.experiment_contributors;
DROP POLICY IF EXISTS "update_contributors" ON public.experiment_contributors;
DROP POLICY IF EXISTS "delete_contributors" ON public.experiment_contributors;

-- ═══════════════════════════════════════════════════
-- 5. Drop legacy experiment_protocols delete bypass
-- ═══════════════════════════════════════════════════
DROP POLICY IF EXISTS "delete_ep" ON public.experiment_protocols;

-- ═══════════════════════════════════════════════════
-- 6. Drop legacy protocol_deviations delete bypass
-- ═══════════════════════════════════════════════════
DROP POLICY IF EXISTS "delete_pd" ON public.protocol_deviations;

-- ═══════════════════════════════════════════════════
-- 7. Drop direct experiment_blocks write policies
-- ═══════════════════════════════════════════════════
DROP POLICY IF EXISTS "insert_blocks" ON public.experiment_blocks;
DROP POLICY IF EXISTS "update_blocks" ON public.experiment_blocks;
DROP POLICY IF EXISTS "delete_blocks" ON public.experiment_blocks;

-- ═══════════════════════════════════════════════════
-- 8. Drop direct experiments write policies
-- ═══════════════════════════════════════════════════
DROP POLICY IF EXISTS "insert_experiments" ON public.experiments;
DROP POLICY IF EXISTS "update_experiments" ON public.experiments;
DROP POLICY IF EXISTS "delete_experiments" ON public.experiments;

-- ═══════════════════════════════════════════════════
-- 9. Add lifecycle consistency CHECK constraint
-- ═══════════════════════════════════════════════════
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.experiments'::regclass
      AND conname = 'experiments_lifecycle_consistency'
  ) THEN
    ALTER TABLE public.experiments ADD CONSTRAINT experiments_lifecycle_consistency CHECK (
      (status = 'locked' AND is_locked = true AND is_archived = false)
      OR (status = 'archived' AND is_archived = true)
      OR (status NOT IN ('locked', 'archived') AND is_locked = false AND is_archived = false)
    );
  END IF;
END $$;
