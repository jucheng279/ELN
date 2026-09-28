-- 07_migration_contract_tests.sql: catalog invariants that prevent regression loops
BEGIN;
SELECT plan(13);

-- ══════════════════════════════════════════════════
-- 1. Exactly ONE _create_revision_internal
-- ══════════════════════════════════════════════════
SELECT is(
  (SELECT count(*)::int FROM pg_proc p
   JOIN pg_namespace n ON p.pronamespace = n.oid
   WHERE n.nspname = 'public' AND p.proname = '_create_revision_internal'),
  1,
  'Exactly one _create_revision_internal function exists'
);

-- 2. Its identity is (uuid, text, text, uuid, jsonb)
SELECT is(
  (SELECT pg_get_function_identity_arguments(p.oid)
   FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
   WHERE n.nspname = 'public' AND p.proname = '_create_revision_internal'),
  'p_experiment_id uuid, p_change_summary text, p_change_type text, p_created_by uuid, p_metadata jsonb',
  '_create_revision_internal has canonical 5-arg signature'
);

-- 3. It is SECURITY DEFINER
SELECT ok(
  (SELECT p.prosecdef FROM pg_proc p
   JOIN pg_namespace n ON p.pronamespace = n.oid
   WHERE n.nspname = 'public' AND p.proname = '_create_revision_internal'),
  '_create_revision_internal is SECURITY DEFINER'
);

-- 4. authenticated cannot execute it
SELECT ok(
  NOT has_function_privilege(
    'authenticated',
    'public._create_revision_internal(uuid, text, text, uuid, jsonb)',
    'EXECUTE'
  ),
  '_create_revision_internal denied to authenticated'
);

-- 5. anon cannot execute it
SELECT ok(
  NOT has_function_privilege(
    'anon',
    'public._create_revision_internal(uuid, text, text, uuid, jsonb)',
    'EXECUTE'
  ),
  '_create_revision_internal denied to anon'
);

-- ══════════════════════════════════════════════════
-- 6. Exactly ONE delete_experiment_block
-- ══════════════════════════════════════════════════
SELECT is(
  (SELECT count(*)::int FROM pg_proc p
   JOIN pg_namespace n ON p.pronamespace = n.oid
   WHERE n.nspname = 'public' AND p.proname = 'delete_experiment_block'),
  1,
  'Exactly one delete_experiment_block function exists'
);

-- 7. Its identity is (uuid, uuid, bigint)
SELECT is(
  (SELECT pg_get_function_identity_arguments(p.oid)
   FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
   WHERE n.nspname = 'public' AND p.proname = 'delete_experiment_block'),
  'p_experiment_id uuid, p_block_id uuid, p_expected_version bigint',
  'delete_experiment_block has 3-arg signature'
);

-- ══════════════════════════════════════════════════
-- 8. Legacy create_revision does not exist
-- ══════════════════════════════════════════════════
SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' AND p.proname = 'create_revision'
  ),
  'Legacy create_revision function does not exist'
);

-- ══════════════════════════════════════════════════
-- 9. Old 4-arg _create_revision_internal does not exist
-- ══════════════════════════════════════════════════
SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' AND p.proname = '_create_revision_internal'
    AND pg_get_function_identity_arguments(p.oid) =
      'p_experiment_id uuid, p_change_summary text, p_change_type text, p_created_by uuid'
  ),
  'Old 4-arg _create_revision_internal does not exist'
);

-- ══════════════════════════════════════════════════
-- 10. Old 2-arg delete_experiment_block does not exist
-- ══════════════════════════════════════════════════
SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' AND p.proname = 'delete_experiment_block'
    AND pg_get_function_identity_arguments(p.oid) =
      'p_experiment_id uuid, p_block_id uuid'
  ),
  'Old 2-arg delete_experiment_block does not exist'
);

-- ══════════════════════════════════════════════════
-- 11. Snapshot builder is internal only
-- ══════════════════════════════════════════════════
SELECT ok(
  NOT has_function_privilege(
    'authenticated',
    'public._build_experiment_snapshot(uuid)',
    'EXECUTE'
  ),
  '_build_experiment_snapshot denied to authenticated'
);

-- ══════════════════════════════════════════════════
-- 12. experiment_revisions has metadata column
-- ══════════════════════════════════════════════════
SELECT ok(
  EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'experiment_revisions'
    AND column_name = 'metadata' AND data_type = 'jsonb'
  ),
  'experiment_revisions has jsonb metadata column'
);

-- ══════════════════════════════════════════════════
-- 13. Notification CHECK accepts review_resubmitted
-- ══════════════════════════════════════════════════
SELECT ok(
  (SELECT pg_get_constraintdef(c.oid)
   FROM pg_constraint c
   WHERE c.conrelid = 'public.notifications'::regclass AND c.contype = 'c'
  ) LIKE '%review_resubmitted%',
  'Notification CHECK constraint includes review_resubmitted'
);

SELECT * FROM finish();
ROLLBACK;
