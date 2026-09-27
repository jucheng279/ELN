-- =============================================================
-- 00_setup.sql — pgTAP bootstrap + test helpers + seed data
-- =============================================================
BEGIN;

-- ─────────────────────────────────────────────────────────────
-- 1. Enable pgTAP
-- ─────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS pgtap;

-- ─────────────────────────────────────────────────────────────
-- 2. Create tests schema + helper functions
-- ─────────────────────────────────────────────────────────────
CREATE SCHEMA IF NOT EXISTS tests;

-- Helper: simulate an authenticated user
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

-- Helper: simulate anon
CREATE OR REPLACE FUNCTION tests.set_anon()
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', '{}', true);
  PERFORM set_config('role', 'anon', true);
END;
$$;

-- Helper: reset to postgres superuser
CREATE OR REPLACE FUNCTION tests.reset_role()
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  PERFORM set_config('request.jwt.claims', '', true);
END;
$$;

-- ─────────────────────────────────────────────────────────────
-- 3. Seed data: auth users, profiles, workspace, members,
--    notebook, experiment (draft), experiment blocks
-- ─────────────────────────────────────────────────────────────

-- Fixed UUIDs for reproducibility
DO $$
DECLARE
  v_user_owner   uuid := 'a0000000-0000-0000-0000-000000000001';
  v_user_editor  uuid := 'a0000000-0000-0000-0000-000000000002';
  v_user_guest   uuid := 'a0000000-0000-0000-0000-000000000003';
  v_workspace_id uuid := 'b0000000-0000-0000-0000-000000000001';
  v_notebook_id  uuid := 'c0000000-0000-0000-0000-000000000001';
  v_notebook_other uuid := 'c0000000-0000-0000-0000-000000000099';
  v_experiment_id uuid := 'd0000000-0000-0000-0000-000000000001';
  v_block_id     uuid := 'e0000000-0000-0000-0000-000000000001';
  v_other_ws     uuid := 'b0000000-0000-0000-0000-000000000099';
BEGIN
  -- Create auth users
  INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, aud, role)
  VALUES
    (v_user_owner,  'owner@test.com',  crypt('password', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, 'authenticated', 'authenticated'),
    (v_user_editor, 'editor@test.com', crypt('password', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, 'authenticated', 'authenticated'),
    (v_user_guest,  'guest@test.com',  crypt('password', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, 'authenticated', 'authenticated')
  ON CONFLICT (id) DO NOTHING;
  -- Profiles are auto-created by the trigger on auth.users

  -- Create workspace (trigger auto-creates owner membership)
  INSERT INTO public.workspaces (id, name, created_by)
  VALUES (v_workspace_id, 'Test Workspace', v_user_owner)
  ON CONFLICT (id) DO NOTHING;

  -- Add editor and guest members
  INSERT INTO public.workspace_members (workspace_id, user_id, role, invited_by)
  VALUES
    (v_workspace_id, v_user_editor, 'member',  v_user_owner),
    (v_workspace_id, v_user_guest,  'guest',   v_user_owner)
  ON CONFLICT DO NOTHING;

  -- Create notebook
  INSERT INTO public.notebooks (id, workspace_id, name, created_by)
  VALUES (v_notebook_id, v_workspace_id, 'Test Notebook', v_user_owner)
  ON CONFLICT (id) DO NOTHING;

  -- Create a second workspace + notebook (for cross-workspace validation)
  INSERT INTO public.workspaces (id, name, created_by)
  VALUES (v_other_ws, 'Other Workspace', v_user_owner)
  ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.notebooks (id, workspace_id, name, created_by)
  VALUES (v_notebook_other, v_other_ws, 'Other Notebook', v_user_owner)
  ON CONFLICT (id) DO NOTHING;

  -- Create a draft experiment via RPC (respects all triggers)
  PERFORM tests.set_auth_user(v_user_editor);
  PERFORM public.create_experiment_rpc(v_workspace_id, v_notebook_id, 'Test Experiment');
  PERFORM tests.reset_role();

  -- Grab the experiment that was just created and alias it to our fixed id
  -- (create_experiment_rpc generates its own uuid, so we update it)
  UPDATE public.experiments
  SET id = v_experiment_id
  WHERE workspace_id = v_workspace_id
    AND title = 'Test Experiment'
    AND id != v_experiment_id;

  -- Insert a block via superuser for concurrency tests
  INSERT INTO public.experiment_blocks (id, experiment_id, type, content, order_key, created_by, updated_by)
  VALUES (v_block_id, v_experiment_id, 'text', '{"text":"hello"}'::jsonb, 'a0', v_user_editor, v_user_editor)
  ON CONFLICT (id) DO NOTHING;
END;
$$;

SELECT plan(1);
SELECT pass('Test setup complete');
SELECT * FROM finish();

ROLLBACK;
