-- =============================================================
-- 02_lifecycle_tests.sql — CHECK constraint: lifecycle consistency
-- =============================================================
BEGIN;

-- Re-run seed (each test file is independent)
CREATE EXTENSION IF NOT EXISTS pgtap;
CREATE SCHEMA IF NOT EXISTS tests;

SELECT plan(6);

-- ─────────────────────────────────────────────────────────────
-- 1. status='locked' requires is_locked=true, is_archived=false
-- ─────────────────────────────────────────────────────────────
SELECT throws_ok(
  $$
    INSERT INTO public.experiments
      (workspace_id, notebook_id, title, status, is_locked, is_archived, created_by)
    VALUES
      ('b0000000-0000-0000-0000-000000000001',
       'c0000000-0000-0000-0000-000000000001',
       'Locked but not flagged', 'locked', false, false,
       'a0000000-0000-0000-0000-000000000001')
  $$,
  '23514', -- check_violation
  NULL,
  'Cannot set status=locked with is_locked=false'
);

SELECT throws_ok(
  $$
    INSERT INTO public.experiments
      (workspace_id, notebook_id, title, status, is_locked, is_archived, created_by)
    VALUES
      ('b0000000-0000-0000-0000-000000000001',
       'c0000000-0000-0000-0000-000000000001',
       'Locked and archived', 'locked', true, true,
       'a0000000-0000-0000-0000-000000000001')
  $$,
  '23514',
  NULL,
  'Cannot set status=locked with is_archived=true'
);

-- ─────────────────────────────────────────────────────────────
-- 2. status='archived' requires is_archived=true
-- ─────────────────────────────────────────────────────────────
SELECT throws_ok(
  $$
    INSERT INTO public.experiments
      (workspace_id, notebook_id, title, status, is_locked, is_archived, created_by)
    VALUES
      ('b0000000-0000-0000-0000-000000000001',
       'c0000000-0000-0000-0000-000000000001',
       'Archived not flagged', 'archived', false, false,
       'a0000000-0000-0000-0000-000000000001')
  $$,
  '23514',
  NULL,
  'Cannot set status=archived with is_archived=false'
);

-- ─────────────────────────────────────────────────────────────
-- 3. Non-locked/non-archived status requires both flags false
-- ─────────────────────────────────────────────────────────────
SELECT throws_ok(
  $$
    INSERT INTO public.experiments
      (workspace_id, notebook_id, title, status, is_locked, is_archived, created_by)
    VALUES
      ('b0000000-0000-0000-0000-000000000001',
       'c0000000-0000-0000-0000-000000000001',
       'Draft but locked', 'draft', true, false,
       'a0000000-0000-0000-0000-000000000001')
  $$,
  '23514',
  NULL,
  'Cannot set status=draft with is_locked=true'
);

SELECT throws_ok(
  $$
    INSERT INTO public.experiments
      (workspace_id, notebook_id, title, status, is_locked, is_archived, created_by)
    VALUES
      ('b0000000-0000-0000-0000-000000000001',
       'c0000000-0000-0000-0000-000000000001',
       'In-progress but archived', 'in_progress', false, true,
       'a0000000-0000-0000-0000-000000000001')
  $$,
  '23514',
  NULL,
  'Cannot set status=in_progress with is_archived=true'
);

-- ─────────────────────────────────────────────────────────────
-- 4. Valid combination passes
-- ─────────────────────────────────────────────────────────────
SELECT lives_ok(
  $$
    INSERT INTO public.experiments
      (workspace_id, notebook_id, title, status, is_locked, is_archived, created_by)
    VALUES
      ('b0000000-0000-0000-0000-000000000001',
       'c0000000-0000-0000-0000-000000000001',
       'Valid draft', 'draft', false, false,
       'a0000000-0000-0000-0000-000000000001')
  $$,
  'Valid draft with is_locked=false, is_archived=false passes'
);

SELECT * FROM finish();
ROLLBACK;
