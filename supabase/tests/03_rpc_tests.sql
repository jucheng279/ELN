-- =============================================================
-- 03_rpc_tests.sql — RPC authorization tests
-- =============================================================
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;
CREATE SCHEMA IF NOT EXISTS tests;

CREATE OR REPLACE FUNCTION tests.set_auth_user(user_id uuid)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object(
    'sub', user_id::text,
    'role', 'authenticated',
    'aud', 'authenticated'
  )::text, true);
  PERFORM set_config('role', 'authenticated', true);
END;
$$;

CREATE OR REPLACE FUNCTION tests.reset_role()
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', '', true);
END;
$$;

SELECT plan(7);

-- ─────────────────────────────────────────────────────────────
-- Setup: create users, workspace, notebook, experiment
-- ─────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_user_editor  uuid := 'a0000000-0000-0000-0000-000000000002';
  v_user_owner   uuid := 'a0000000-0000-0000-0000-000000000001';
  v_workspace_id uuid := 'b0000000-0000-0000-0000-000000000001';
  v_notebook_id  uuid := 'c0000000-0000-0000-0000-000000000001';
  v_other_ws     uuid := 'b0000000-0000-0000-0000-000000000099';
  v_notebook_other uuid := 'c0000000-0000-0000-0000-000000000099';
BEGIN
  -- Create auth users
  INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, aud, role)
  VALUES
    (v_user_owner,  'owner@test.com',  crypt('password', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, 'authenticated', 'authenticated'),
    (v_user_editor, 'editor@test.com', crypt('password', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, 'authenticated', 'authenticated')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.workspaces (id, name, created_by)
  VALUES (v_workspace_id, 'Test Workspace', v_user_owner)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.workspace_members (workspace_id, user_id, role, invited_by)
  VALUES (v_workspace_id, v_user_editor, 'member', v_user_owner)
  ON CONFLICT DO NOTHING;

  INSERT INTO public.notebooks (id, workspace_id, name, created_by)
  VALUES (v_notebook_id, v_workspace_id, 'Test Notebook', v_user_owner)
  ON CONFLICT (id) DO NOTHING;

  -- Other workspace + notebook for cross-workspace test
  INSERT INTO public.workspaces (id, name, created_by)
  VALUES (v_other_ws, 'Other Workspace', v_user_owner)
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.notebooks (id, workspace_id, name, created_by)
  VALUES (v_notebook_other, v_other_ws, 'Other Notebook', v_user_owner)
  ON CONFLICT (id) DO NOTHING;
END;
$$;

-- ─────────────────────────────────────────────────────────────
-- Test 1: _create_revision_internal is NOT callable by authenticated
-- ─────────────────────────────────────────────────────────────
SELECT throws_ok(
  $$
    DO $inner$
    BEGIN
      PERFORM tests.set_auth_user('a0000000-0000-0000-0000-000000000002');
      PERFORM public._create_revision_internal(
        'd0000000-0000-0000-0000-000000000001',
        'test',
        'checkpoint',
        'a0000000-0000-0000-0000-000000000002'
      );
    END;
    $inner$
  $$,
  '42501', -- insufficient_privilege
  NULL,
  '_create_revision_internal is not callable by authenticated role'
);

-- Reset after failed role test
SELECT tests.reset_role();

-- ─────────────────────────────────────────────────────────────
-- Test 2-3: create_checkpoint works for editor on draft experiment
-- ─────────────────────────────────────────────────────────────
-- First create an experiment as the editor
DO $$
DECLARE
  v_result jsonb;
BEGIN
  PERFORM tests.set_auth_user('a0000000-0000-0000-0000-000000000002');
  v_result := public.create_experiment_rpc(
    'b0000000-0000-0000-0000-000000000001',
    'c0000000-0000-0000-0000-000000000001',
    'Checkpoint Test Experiment'
  );
  -- Store the experiment id for subsequent tests
  PERFORM set_config('tests.checkpoint_exp_id', v_result->>'id', true);
  PERFORM tests.reset_role();
END;
$$;

SELECT lives_ok(
  $$
    DO $inner$
    DECLARE v_result jsonb;
    BEGIN
      PERFORM tests.set_auth_user('a0000000-0000-0000-0000-000000000002');
      v_result := public.create_checkpoint(
        (current_setting('tests.checkpoint_exp_id'))::uuid,
        'Initial checkpoint'
      );
      PERFORM tests.reset_role();
    END;
    $inner$
  $$,
  'create_checkpoint succeeds for editor on draft experiment'
);

-- Verify it returned a revision
SELECT ok(
  EXISTS (
    SELECT 1 FROM public.experiment_revisions
    WHERE experiment_id = (current_setting('tests.checkpoint_exp_id'))::uuid
      AND change_type = 'checkpoint'
  ),
  'create_checkpoint created a revision record'
);

-- ─────────────────────────────────────────────────────────────
-- Test 4: create_checkpoint fails on locked experiment
-- ─────────────────────────────────────────────────────────────
-- Create a locked experiment directly (superuser)
DO $$
BEGIN
  INSERT INTO public.experiments
    (id, workspace_id, notebook_id, title, status, is_locked, is_archived, created_by)
  VALUES
    ('d0000000-0000-0000-0000-0000000000ff',
     'b0000000-0000-0000-0000-000000000001',
     'c0000000-0000-0000-0000-000000000001',
     'Locked Experiment', 'locked', true, false,
     'a0000000-0000-0000-0000-000000000001');
END;
$$;

SELECT throws_ok(
  $$
    DO $inner$
    DECLARE v_result jsonb;
    BEGIN
      PERFORM tests.set_auth_user('a0000000-0000-0000-0000-000000000002');
      v_result := public.create_checkpoint(
        'd0000000-0000-0000-0000-0000000000ff',
        'Should fail'
      );
    END;
    $inner$
  $$,
  NULL, -- any error
  NULL,
  'create_checkpoint fails on locked experiment'
);

SELECT tests.reset_role();

-- ─────────────────────────────────────────────────────────────
-- Test 5: update_experiment_metadata validates notebook workspace
-- ─────────────────────────────────────────────────────────────
SELECT throws_ok(
  $$
    DO $inner$
    DECLARE v_result jsonb;
    BEGIN
      PERFORM tests.set_auth_user('a0000000-0000-0000-0000-000000000002');
      v_result := public.update_experiment_metadata(
        (current_setting('tests.checkpoint_exp_id'))::uuid,
        p_notebook_id := 'c0000000-0000-0000-0000-000000000099'  -- belongs to other workspace
      );
    END;
    $inner$
  $$,
  NULL,
  NULL,
  'update_experiment_metadata rejects notebook from different workspace'
);

SELECT tests.reset_role();

-- ─────────────────────────────────────────────────────────────
-- Test 6: update_experiment_metadata succeeds with valid data
-- ─────────────────────────────────────────────────────────────
SELECT lives_ok(
  $$
    DO $inner$
    DECLARE v_result jsonb;
    BEGIN
      PERFORM tests.set_auth_user('a0000000-0000-0000-0000-000000000002');
      v_result := public.update_experiment_metadata(
        (current_setting('tests.checkpoint_exp_id'))::uuid,
        p_title := 'Updated Title'
      );
      PERFORM tests.reset_role();
    END;
    $inner$
  $$,
  'update_experiment_metadata succeeds with valid title update'
);

-- ─────────────────────────────────────────────────────────────
-- Test 7: insert_experiment_block returns complete row with row_version
-- ─────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_result jsonb;
BEGIN
  PERFORM tests.set_auth_user('a0000000-0000-0000-0000-000000000002');
  v_result := public.insert_experiment_block(
    (current_setting('tests.checkpoint_exp_id'))::uuid,
    'text',
    '{"text":"test block"}'::jsonb,
    'a0'
  );
  -- Store for assertion outside DO block
  PERFORM set_config('tests.block_result', v_result::text, true);
  PERFORM tests.reset_role();
END;
$$;

SELECT ok(
  (current_setting('tests.block_result')::jsonb)->>'row_version' IS NOT NULL
    AND (current_setting('tests.block_result')::jsonb)->>'id' IS NOT NULL
    AND (current_setting('tests.block_result')::jsonb)->>'experiment_id' IS NOT NULL,
  'insert_experiment_block returns complete row with id, experiment_id, and row_version'
);

SELECT * FROM finish();
ROLLBACK;
