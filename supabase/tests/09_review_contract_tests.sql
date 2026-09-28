-- 09_review_contract_tests.sql: catalog/data invariants for review provenance
BEGIN;
SELECT plan(8);

-- ──────────────────────────────────────────────────────
-- Test 1: Reviews table has experiment_revision_id column
-- ──────────────────────────────────────────────────────
SELECT has_column('public', 'reviews', 'experiment_revision_id',
  'Reviews table has experiment_revision_id column');

-- ──────────────────────────────────────────────────────
-- Test 2: Signatures table has experiment_revision_id column
-- ──────────────────────────────────────────────────────
SELECT has_column('public', 'signatures', 'experiment_revision_id',
  'Signatures table has experiment_revision_id column');

-- ──────────────────────────────────────────────────────
-- Test 3: Reviews composite FK to experiment_revisions exists
-- ──────────────────────────────────────────────────────
SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.reviews'::regclass
    AND conname = 'reviews_revision_experiment_fk'
  ),
  'Reviews composite FK (experiment_revision_id, experiment_id) -> experiment_revisions is active'
);

-- ──────────────────────────────────────────────────────
-- Test 4: submit_for_review populates experiment_revision_id on review
-- ──────────────────────────────────────────────────────
SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' AND p.proname = 'submit_for_review'
    AND p.prosrc LIKE '%experiment_revision_id%'
  ),
  'submit_for_review references experiment_revision_id'
);

-- ──────────────────────────────────────────────────────
-- Test 5: sign_and_lock_experiment populates experiment_revision_id on signature
-- ──────────────────────────────────────────────────────
SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' AND p.proname = 'sign_and_lock_experiment'
    AND p.prosrc LIKE '%experiment_revision_id%'
  ),
  'sign_and_lock_experiment references experiment_revision_id'
);

-- ──────────────────────────────────────────────────────
-- Test 6: approve_experiment does NOT call _create_revision_internal
-- ──────────────────────────────────────────────────────
SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' AND p.proname = 'approve_experiment'
    AND p.prosrc LIKE '%_create_revision_internal%'
  ),
  'approve_experiment does not create a scientific revision'
);

-- ──────────────────────────────────────────────────────
-- Test 7: request_experiment_changes does NOT call _create_revision_internal
-- ──────────────────────────────────────────────────────
SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' AND p.proname = 'request_experiment_changes'
    AND p.prosrc LIKE '%_create_revision_internal%'
  ),
  'request_experiment_changes does not create a scientific revision'
);

-- ──────────────────────────────────────────────────────
-- Test 8: All review RPC notification types are valid per CHECK constraint
-- ──────────────────────────────────────────────────────
DO $$
DECLARE
  v_check text;
  v_types text[] := ARRAY['review_requested', 'review_resubmitted', 'changes_requested', 'experiment_approved'];
  v_t text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO v_check FROM pg_constraint
    WHERE conrelid = 'public.notifications'::regclass AND conname = 'notifications_type_check';

  IF v_check IS NULL THEN
    RAISE EXCEPTION 'Notification type CHECK constraint not found';
  END IF;

  FOREACH v_t IN ARRAY v_types LOOP
    IF v_check NOT LIKE '%' || v_t || '%' THEN
      RAISE EXCEPTION 'Notification type % not in CHECK constraint: %', v_t, v_check;
    END IF;
  END LOOP;
END $$;
SELECT pass('All review RPC notification types are accepted by the CHECK constraint');

SELECT * FROM finish();
ROLLBACK;
