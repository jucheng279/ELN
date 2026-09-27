-- 01_policy_tests.sql: verify legacy permissive policies removed + structural checks
BEGIN;
SELECT plan(25);

-- ──────────────────────────────────────────────────────
-- Legacy permissive policies must not exist
-- ──────────────────────────────────────────────────────
SELECT ok(
  NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'experiments' AND policyname = 'Users can view experiments in their workspace'),
  'Legacy select policy on experiments removed'
);
SELECT ok(
  NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'experiments' AND policyname = 'Users can insert experiments'),
  'Legacy insert policy on experiments removed'
);
SELECT ok(
  NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'experiments' AND policyname = 'Users can update their experiments'),
  'Legacy update policy on experiments removed'
);
SELECT ok(
  NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'experiments' AND policyname = 'Users can delete draft experiments'),
  'Legacy delete policy on experiments removed'
);
SELECT ok(
  NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'experiment_blocks' AND policyname = 'Users can view blocks'),
  'Legacy select policy on blocks removed'
);
SELECT ok(
  NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'experiment_blocks' AND policyname = 'Users can insert blocks'),
  'Legacy insert policy on blocks removed'
);
SELECT ok(
  NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'experiment_blocks' AND policyname = 'Users can update blocks'),
  'Legacy update policy on blocks removed'
);
SELECT ok(
  NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'experiment_blocks' AND policyname = 'Users can delete blocks'),
  'Legacy delete policy on blocks removed'
);

-- ──────────────────────────────────────────────────────
-- No permissive WRITE policies on experiments or blocks
-- ──────────────────────────────────────────────────────
SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'experiments' AND cmd IN ('INSERT','UPDATE','DELETE') AND permissive = 'PERMISSIVE'
    AND policyname NOT LIKE '%_er' AND policyname NOT LIKE 'insert_er%' AND policyname NOT LIKE 'update_er%' AND policyname NOT LIKE 'delete_er%'
  ),
  'No permissive direct write policies on experiments'
);
SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'experiment_blocks' AND cmd IN ('INSERT','UPDATE','DELETE') AND permissive = 'PERMISSIVE'
  ),
  'No permissive direct write policies on experiment_blocks'
);

-- ──────────────────────────────────────────────────────
-- Legacy create_revision must not exist
-- ──────────────────────────────────────────────────────
SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' AND p.proname = 'create_revision'
  ),
  'Legacy create_revision function does not exist'
);

-- ──────────────────────────────────────────────────────
-- Internal functions not callable by authenticated
-- ──────────────────────────────────────────────────────
SELECT ok(
  NOT has_function_privilege('authenticated', 'public._build_experiment_snapshot(uuid)', 'EXECUTE'),
  '_build_experiment_snapshot denied to authenticated'
);
SELECT ok(
  NOT has_function_privilege('authenticated', 'public._create_revision_internal(uuid,text,text,uuid,jsonb)', 'EXECUTE'),
  '_create_revision_internal denied to authenticated'
);

-- ──────────────────────────────────────────────────────
-- Public RPCs are callable by authenticated
-- ──────────────────────────────────────────────────────
SELECT ok(
  has_function_privilege('authenticated', 'public.create_checkpoint(uuid,text)', 'EXECUTE'),
  'create_checkpoint callable by authenticated'
);
SELECT ok(
  has_function_privilege('authenticated', 'public.create_experiment_rpc(uuid,uuid,text,uuid,uuid)', 'EXECUTE'),
  'create_experiment_rpc callable by authenticated'
);
SELECT ok(
  has_function_privilege('authenticated', 'public.complete_experiment(uuid)', 'EXECUTE'),
  'complete_experiment callable by authenticated'
);
SELECT ok(
  has_function_privilege('authenticated', 'public.submit_for_review(uuid,uuid)', 'EXECUTE'),
  'submit_for_review callable by authenticated'
);
SELECT ok(
  has_function_privilege('authenticated', 'public.resubmit_for_review(uuid,uuid)', 'EXECUTE'),
  'resubmit_for_review callable by authenticated'
);
SELECT ok(
  has_function_privilege('authenticated', 'public.upsert_experiment_blocks(uuid,jsonb)', 'EXECUTE'),
  'upsert_experiment_blocks callable by authenticated'
);
SELECT ok(
  has_function_privilege('authenticated', 'public.delete_experiment_block(uuid,uuid,bigint)', 'EXECUTE'),
  'delete_experiment_block callable by authenticated'
);
SELECT ok(
  has_function_privilege('authenticated', 'public.restore_experiment_revision(uuid,uuid)', 'EXECUTE'),
  'restore_experiment_revision callable by authenticated'
);
SELECT ok(
  has_function_privilege('authenticated', 'public.add_comment_with_mentions(uuid,uuid,text,uuid[])', 'EXECUTE'),
  'add_comment_with_mentions callable by authenticated'
);

-- ──────────────────────────────────────────────────────
-- Public RPCs denied to anon
-- ──────────────────────────────────────────────────────
SELECT ok(
  NOT has_function_privilege('anon', 'public.create_checkpoint(uuid,text)', 'EXECUTE'),
  'create_checkpoint denied to anon'
);
SELECT ok(
  NOT has_function_privilege('anon', 'public.create_experiment_rpc(uuid,uuid,text,uuid,uuid)', 'EXECUTE'),
  'create_experiment_rpc denied to anon'
);
SELECT ok(
  NOT has_function_privilege('anon', 'public.delete_experiment_block(uuid,uuid,bigint)', 'EXECUTE'),
  'delete_experiment_block denied to anon'
);

SELECT * FROM finish();
ROLLBACK;
