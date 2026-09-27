-- =============================================================
-- 01_policy_tests.sql — Verify legacy permissive policies are gone
-- =============================================================
BEGIN;

SELECT plan(22);

-- ─────────────────────────────────────────────────────────────
-- 1. Legacy experiment_tags policies must not exist
-- ─────────────────────────────────────────────────────────────
SELECT ok(
  NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'experiment_tags' AND policyname = 'insert_exp_tags'),
  'Legacy policy insert_exp_tags is absent from experiment_tags'
);
SELECT ok(
  NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'experiment_tags' AND policyname = 'update_exp_tags'),
  'Legacy policy update_exp_tags is absent from experiment_tags'
);
SELECT ok(
  NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'experiment_tags' AND policyname = 'delete_exp_tags'),
  'Legacy policy delete_exp_tags is absent from experiment_tags'
);

-- ─────────────────────────────────────────────────────────────
-- 2. Legacy experiment_references policies must not exist
-- ─────────────────────────────────────────────────────────────
SELECT ok(
  NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'experiment_references' AND policyname = 'insert_ref'),
  'Legacy policy insert_ref is absent from experiment_references'
);
SELECT ok(
  NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'experiment_references' AND policyname = 'update_ref'),
  'Legacy policy update_ref is absent from experiment_references'
);
SELECT ok(
  NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'experiment_references' AND policyname = 'delete_ref'),
  'Legacy policy delete_ref is absent from experiment_references'
);

-- ─────────────────────────────────────────────────────────────
-- 3. Legacy experiment_relations policies must not exist
-- ─────────────────────────────────────────────────────────────
SELECT ok(
  NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'experiment_relations' AND policyname = 'insert_er'),
  'Legacy policy insert_er is absent from experiment_relations'
);
SELECT ok(
  NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'experiment_relations' AND policyname = 'update_er'),
  'Legacy policy update_er is absent from experiment_relations'
);
SELECT ok(
  NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'experiment_relations' AND policyname = 'delete_er'),
  'Legacy policy delete_er is absent from experiment_relations'
);

-- ─────────────────────────────────────────────────────────────
-- 4. Legacy experiment_contributors policies must not exist
-- ─────────────────────────────────────────────────────────────
SELECT ok(
  NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'experiment_contributors' AND policyname = 'insert_contributors'),
  'Legacy policy insert_contributors is absent'
);
SELECT ok(
  NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'experiment_contributors' AND policyname = 'update_contributors'),
  'Legacy policy update_contributors is absent'
);
SELECT ok(
  NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'experiment_contributors' AND policyname = 'delete_contributors'),
  'Legacy policy delete_contributors is absent'
);

-- ─────────────────────────────────────────────────────────────
-- 5. Legacy experiment_protocols delete bypass must not exist
-- ─────────────────────────────────────────────────────────────
SELECT ok(
  NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'experiment_protocols' AND policyname = 'delete_ep'),
  'Legacy policy delete_ep is absent from experiment_protocols'
);

-- ─────────────────────────────────────────────────────────────
-- 6. Legacy protocol_deviations delete bypass must not exist
-- ─────────────────────────────────────────────────────────────
SELECT ok(
  NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'protocol_deviations' AND policyname = 'delete_pd'),
  'Legacy policy delete_pd is absent from protocol_deviations'
);

-- ─────────────────────────────────────────────────────────────
-- 7. Direct experiment write policies must not exist
-- ─────────────────────────────────────────────────────────────
SELECT ok(
  NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'experiments' AND policyname = 'insert_experiments'),
  'Legacy policy insert_experiments is absent'
);
SELECT ok(
  NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'experiments' AND policyname = 'update_experiments'),
  'Legacy policy update_experiments is absent'
);
SELECT ok(
  NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'experiments' AND policyname = 'delete_experiments'),
  'Legacy policy delete_experiments is absent'
);

-- ─────────────────────────────────────────────────────────────
-- 8. Direct experiment_blocks write policies must not exist
-- ─────────────────────────────────────────────────────────────
SELECT ok(
  NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'experiment_blocks' AND policyname = 'insert_blocks'),
  'Legacy policy insert_blocks is absent from experiment_blocks'
);
SELECT ok(
  NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'experiment_blocks' AND policyname = 'update_blocks'),
  'Legacy policy update_blocks is absent from experiment_blocks'
);
SELECT ok(
  NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'experiment_blocks' AND policyname = 'delete_blocks'),
  'Legacy policy delete_blocks is absent from experiment_blocks'
);

-- ─────────────────────────────────────────────────────────────
-- 9. Experiments table must have NO direct INSERT/UPDATE/DELETE
--    permissive policies (only restrictive deny or no direct at all)
-- ─────────────────────────────────────────────────────────────
SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'experiments'
      AND cmd IN ('INSERT', 'UPDATE', 'DELETE')
      AND permissive = 'PERMISSIVE'
  ),
  'experiments has no permissive INSERT/UPDATE/DELETE policies'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'experiment_blocks'
      AND cmd IN ('INSERT', 'UPDATE', 'DELETE')
      AND permissive = 'PERMISSIVE'
  ),
  'experiment_blocks has no permissive INSERT/UPDATE/DELETE policies'
);

SELECT * FROM finish();
ROLLBACK;
