-- =============================================================
-- 01_policy_tests.sql — Verify legacy permissive policies are gone
-- =============================================================
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(22);

-- Legacy experiment_tags policies
SELECT ok(NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='experiment_tags' AND policyname='insert_exp_tags'), 'insert_exp_tags absent');
SELECT ok(NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='experiment_tags' AND policyname='update_exp_tags'), 'update_exp_tags absent');
SELECT ok(NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='experiment_tags' AND policyname='delete_exp_tags'), 'delete_exp_tags absent');

-- Legacy experiment_references policies
SELECT ok(NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='experiment_references' AND policyname='insert_ref'), 'insert_ref absent');
SELECT ok(NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='experiment_references' AND policyname='update_ref'), 'update_ref absent');
SELECT ok(NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='experiment_references' AND policyname='delete_ref'), 'delete_ref absent');

-- Legacy experiment_relations policies
SELECT ok(NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='experiment_relations' AND policyname='insert_er'), 'legacy insert_er absent from relations');
SELECT ok(NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='experiment_relations' AND policyname='update_er'), 'legacy update_er absent from relations');
SELECT ok(NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='experiment_relations' AND policyname='delete_er'), 'legacy delete_er absent from relations');

-- Legacy experiment_contributors policies
SELECT ok(NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='experiment_contributors' AND policyname='insert_contributors'), 'insert_contributors absent');
SELECT ok(NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='experiment_contributors' AND policyname='update_contributors'), 'update_contributors absent');
SELECT ok(NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='experiment_contributors' AND policyname='delete_contributors'), 'delete_contributors absent');

-- Legacy protocol/deviation bypasses
SELECT ok(NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='experiment_protocols' AND policyname='delete_ep'), 'delete_ep absent');
SELECT ok(NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='protocol_deviations' AND policyname='delete_pd'), 'delete_pd absent');

-- Direct experiment write policies
SELECT ok(NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='experiments' AND policyname='insert_experiments'), 'insert_experiments absent');
SELECT ok(NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='experiments' AND policyname='update_experiments'), 'update_experiments absent');
SELECT ok(NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='experiments' AND policyname='delete_experiments'), 'delete_experiments absent');

-- Direct block write policies
SELECT ok(NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='experiment_blocks' AND policyname='insert_blocks'), 'insert_blocks absent');
SELECT ok(NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='experiment_blocks' AND policyname='update_blocks'), 'update_blocks absent');
SELECT ok(NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='experiment_blocks' AND policyname='delete_blocks'), 'delete_blocks absent');

-- No permissive write policies on experiments or blocks at all
SELECT ok(NOT EXISTS (
  SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='experiments'
    AND cmd IN ('INSERT','UPDATE','DELETE') AND permissive='PERMISSIVE'
), 'experiments: no permissive write policies');

SELECT ok(NOT EXISTS (
  SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='experiment_blocks'
    AND cmd IN ('INSERT','UPDATE','DELETE') AND permissive='PERMISSIVE'
), 'experiment_blocks: no permissive write policies');

-- Legacy create_revision function is gone
SELECT ok(NOT EXISTS (
  SELECT 1 FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
  WHERE n.nspname = 'public' AND p.proname = 'create_revision'
    AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
), 'legacy create_revision not callable by authenticated');

SELECT * FROM finish();
ROLLBACK;
