-- =============================================================
-- 04_concurrency_tests.sql — Optimistic concurrency (row_version)
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

SELECT plan(3);

-- ─────────────────────────────────────────────────────────────
-- Setup: user, workspace, notebook, draft experiment, block
-- ─────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_user_id      uuid := 'a0000000-0000-0000-0000-000000000002';
  v_user_owner   uuid := 'a0000000-0000-0000-0000-000000000001';
  v_workspace_id uuid := 'b0000000-0000-0000-0000-000000000001';
  v_notebook_id  uuid := 'c0000000-0000-0000-0000-000000000001';
  v_exp_id       uuid := 'd0000000-0000-0000-0000-000000000010';
  v_block_id     uuid := 'e0000000-0000-0000-0000-000000000010';
BEGIN
  INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, aud, role)
  VALUES
    (v_user_owner, 'owner@test.com', crypt('password', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, 'authenticated', 'authenticated'),
    (v_user_id,    'editor@test.com', crypt('password', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, 'authenticated', 'authenticated')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.workspaces (id, name, created_by)
  VALUES (v_workspace_id, 'Test Workspace', v_user_owner)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.workspace_members (workspace_id, user_id, role, invited_by)
  VALUES (v_workspace_id, v_user_id, 'member', v_user_owner)
  ON CONFLICT DO NOTHING;

  INSERT INTO public.notebooks (id, workspace_id, name, created_by)
  VALUES (v_notebook_id, v_workspace_id, 'Test Notebook', v_user_owner)
  ON CONFLICT (id) DO NOTHING;

  -- Create experiment directly (superuser, skip triggers for speed)
  INSERT INTO public.experiments (id, workspace_id, notebook_id, title, status, is_locked, is_archived, created_by)
  VALUES (v_exp_id, v_workspace_id, v_notebook_id, 'Concurrency Test', 'draft', false, false, v_user_id)
  ON CONFLICT (id) DO NOTHING;

  -- Create block with row_version = 1
  INSERT INTO public.experiment_blocks (id, experiment_id, type, content, order_key, created_by, updated_by, row_version)
  VALUES (v_block_id, v_exp_id, 'text', '{"text":"original"}'::jsonb, 'a0', v_user_id, v_user_id, 1)
  ON CONFLICT (id) DO NOTHING;
END;
$$;

-- ─────────────────────────────────────────────────────────────
-- Test 1: upsert_experiment_blocks with correct row_version succeeds
-- ─────────────────────────────────────────────────────────────
SELECT lives_ok(
  $$
    DO $inner$
    DECLARE v_result jsonb;
    BEGIN
      PERFORM tests.set_auth_user('a0000000-0000-0000-0000-000000000002');
      v_result := public.upsert_experiment_blocks(
        'd0000000-0000-0000-0000-000000000010',
        jsonb_build_array(
          jsonb_build_object(
            'id', 'e0000000-0000-0000-0000-000000000010',
            'content', '{"text":"updated"}'::jsonb,
            'row_version', 1
          )
        )
      );
      PERFORM tests.reset_role();
    END;
    $inner$
  $$,
  'upsert_experiment_blocks succeeds with correct row_version'
);

-- Verify row_version was incremented
SELECT is(
  (SELECT row_version FROM public.experiment_blocks WHERE id = 'e0000000-0000-0000-0000-000000000010'),
  2::bigint,
  'row_version incremented from 1 to 2 after successful upsert'
);

-- ─────────────────────────────────────────────────────────────
-- Test 2: upsert_experiment_blocks with stale row_version raises
--         serialization_failure (SQLSTATE 40001)
-- ─────────────────────────────────────────────────────────────
SELECT throws_ok(
  $$
    DO $inner$
    DECLARE v_result jsonb;
    BEGIN
      PERFORM tests.set_auth_user('a0000000-0000-0000-0000-000000000002');
      v_result := public.upsert_experiment_blocks(
        'd0000000-0000-0000-0000-000000000010',
        jsonb_build_array(
          jsonb_build_object(
            'id', 'e0000000-0000-0000-0000-000000000010',
            'content', '{"text":"conflict"}'::jsonb,
            'row_version', 1
          )
        )
      );
    END;
    $inner$
  $$,
  '40001', -- serialization_failure
  NULL,
  'upsert_experiment_blocks with stale row_version raises serialization_failure'
);

SELECT tests.reset_role();

SELECT * FROM finish();
ROLLBACK;
