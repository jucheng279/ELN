-- =============================================================
-- 05_composite_fk_tests.sql — Composite FK integrity on reviews
--                               and signatures
-- =============================================================
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;
CREATE SCHEMA IF NOT EXISTS tests;

SELECT plan(2);

-- ─────────────────────────────────────────────────────────────
-- Setup: two experiments with revisions in the same workspace
-- ─────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_user_owner   uuid := 'a0000000-0000-0000-0000-000000000001';
  v_workspace_id uuid := 'b0000000-0000-0000-0000-000000000001';
  v_notebook_id  uuid := 'c0000000-0000-0000-0000-000000000001';
  v_exp_a        uuid := 'd0000000-0000-0000-0000-00000000000a';
  v_exp_b        uuid := 'd0000000-0000-0000-0000-00000000000b';
  v_rev_a        uuid := 'f0000000-0000-0000-0000-00000000000a';
  v_rev_b        uuid := 'f0000000-0000-0000-0000-00000000000b';
BEGIN
  INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, aud, role)
  VALUES (v_user_owner, 'owner@test.com', crypt('password', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, 'authenticated', 'authenticated')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.workspaces (id, name, created_by)
  VALUES (v_workspace_id, 'Test Workspace', v_user_owner)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.notebooks (id, workspace_id, name, created_by)
  VALUES (v_notebook_id, v_workspace_id, 'Test Notebook', v_user_owner)
  ON CONFLICT (id) DO NOTHING;

  -- Experiment A
  INSERT INTO public.experiments (id, workspace_id, notebook_id, title, status, is_locked, is_archived, created_by)
  VALUES (v_exp_a, v_workspace_id, v_notebook_id, 'Experiment A', 'draft', false, false, v_user_owner)
  ON CONFLICT (id) DO NOTHING;

  -- Experiment B
  INSERT INTO public.experiments (id, workspace_id, notebook_id, title, status, is_locked, is_archived, created_by)
  VALUES (v_exp_b, v_workspace_id, v_notebook_id, 'Experiment B', 'draft', false, false, v_user_owner)
  ON CONFLICT (id) DO NOTHING;

  -- Revision for Experiment A
  INSERT INTO public.experiment_revisions (id, experiment_id, revision_number, snapshot, content_hash, change_summary, change_type, created_by)
  VALUES (v_rev_a, v_exp_a, 1, '{}'::jsonb, 'hash_a', 'Initial', 'checkpoint', v_user_owner)
  ON CONFLICT DO NOTHING;

  -- Revision for Experiment B
  INSERT INTO public.experiment_revisions (id, experiment_id, revision_number, snapshot, content_hash, change_summary, change_type, created_by)
  VALUES (v_rev_b, v_exp_b, 1, '{}'::jsonb, 'hash_b', 'Initial', 'checkpoint', v_user_owner)
  ON CONFLICT DO NOTHING;
END;
$$;

-- ─────────────────────────────────────────────────────────────
-- Test 1: Review with mismatched experiment_revision_id / experiment_id
--         is rejected by composite FK
-- ─────────────────────────────────────────────────────────────
SELECT throws_ok(
  $$
    INSERT INTO public.reviews
      (experiment_id, reviewer_id, revision_number, experiment_revision_id, status, comment)
    VALUES
      ('d0000000-0000-0000-0000-00000000000b',  -- experiment B
       'a0000000-0000-0000-0000-000000000001',
       1,
       'f0000000-0000-0000-0000-00000000000a',  -- revision from experiment A!
       'pending',
       'Cross-experiment review')
  $$,
  '23503', -- foreign_key_violation
  NULL,
  'Review with revision from different experiment is rejected by composite FK'
);

-- ─────────────────────────────────────────────────────────────
-- Test 2: Signature with mismatched revision / experiment
--         is rejected by composite FK
-- ─────────────────────────────────────────────────────────────
SELECT throws_ok(
  $$
    INSERT INTO public.signatures
      (experiment_id, signer_id, revision_number, experiment_revision_id, content_hash, declaration)
    VALUES
      ('d0000000-0000-0000-0000-00000000000b',  -- experiment B
       'a0000000-0000-0000-0000-000000000001',
       1,
       'f0000000-0000-0000-0000-00000000000a',  -- revision from experiment A!
       'hash_mismatch',
       'I declare')
  $$,
  '23503', -- foreign_key_violation
  NULL,
  'Signature with revision from different experiment is rejected by composite FK'
);

SELECT * FROM finish();
ROLLBACK;
