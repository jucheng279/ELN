-- =============================================================
-- 04_concurrency_tests.sql — Optimistic concurrency (row_version)
-- Self-contained: creates experiment + block via domain RPCs
-- =============================================================
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(5);

-- Helper
CREATE OR REPLACE FUNCTION _test_set_auth(uid uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', uid::text, 'role', 'authenticated', 'aud', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
END;
$$;

-- Fixtures
DO $$
DECLARE
  v_owner  uuid := 'a0000000-0000-0000-0000-000000000001';
  v_editor uuid := 'a0000000-0000-0000-0000-000000000002';
  v_ws     uuid := 'b0000000-0000-0000-0000-000000000001';
  v_nb     uuid := 'c0000000-0000-0000-0000-000000000001';
  v_exp_result jsonb;
  v_block_result jsonb;
BEGIN
  INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, aud, role) VALUES
    (v_owner,  'owner@cc.test',  crypt('pw', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, 'authenticated', 'authenticated'),
    (v_editor, 'editor@cc.test', crypt('pw', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, 'authenticated', 'authenticated')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.workspaces (id, name, created_by) VALUES (v_ws, 'CC Workspace', v_owner) ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.workspace_members (workspace_id, user_id, role, invited_by) VALUES (v_ws, v_editor, 'member', v_owner) ON CONFLICT DO NOTHING;
  INSERT INTO public.notebooks (id, workspace_id, name, created_by) VALUES (v_nb, v_ws, 'CC Notebook', v_owner) ON CONFLICT (id) DO NOTHING;

  -- Create experiment via domain RPC (as editor)
  PERFORM _test_set_auth(v_editor);
  v_exp_result := public.create_experiment_rpc(v_ws, v_nb, 'Concurrency Test');
  PERFORM set_config('test.exp_id', v_exp_result->>'id', true);

  -- Create block via domain RPC
  v_block_result := public.insert_experiment_block(
    (v_exp_result->>'id')::uuid, 'paragraph', '{"text":"original"}'::jsonb, 'a0'
  );
  PERFORM set_config('test.block_id', v_block_result->>'id', true);
  RESET ROLE;
END;
$$;

-- ─────────────────────────────────────────────────
-- Test 1: upsert with correct row_version (1) succeeds
-- ─────────────────────────────────────────────────
SELECT lives_ok(
  $$ DO $i$ DECLARE v_result jsonb; BEGIN
    PERFORM _test_set_auth('a0000000-0000-0000-0000-000000000002'::uuid);
    v_result := public.upsert_experiment_blocks(
      (current_setting('test.exp_id'))::uuid,
      jsonb_build_array(jsonb_build_object(
        'id', current_setting('test.block_id'),
        'content', '{"text":"updated"}'::jsonb,
        'row_version', 1
      ))
    );
    RESET ROLE;
  END; $i$ $$,
  'upsert succeeds with correct row_version=1'
);

-- Test 2: row_version incremented to 2
SELECT is(
  (SELECT row_version FROM public.experiment_blocks WHERE id = (current_setting('test.block_id'))::uuid),
  2::bigint,
  'row_version incremented to 2'
);

-- ─────────────────────────────────────────────────
-- Test 3: upsert with stale row_version=1 raises serialization_failure
-- ─────────────────────────────────────────────────
SELECT throws_ok(
  $$ DO $i$ DECLARE v_result jsonb; BEGIN
    PERFORM _test_set_auth('a0000000-0000-0000-0000-000000000002'::uuid);
    v_result := public.upsert_experiment_blocks(
      (current_setting('test.exp_id'))::uuid,
      jsonb_build_array(jsonb_build_object(
        'id', current_setting('test.block_id'),
        'content', '{"text":"conflict"}'::jsonb,
        'row_version', 1
      ))
    );
  END; $i$ $$,
  '40001', NULL, 'stale row_version raises serialization_failure'
);
RESET ROLE;

-- ─────────────────────────────────────────────────
-- Test 4: upsert with missing row_version is rejected
-- ─────────────────────────────────────────────────
SELECT throws_ok(
  $$ DO $i$ DECLARE v_result jsonb; BEGIN
    PERFORM _test_set_auth('a0000000-0000-0000-0000-000000000002'::uuid);
    v_result := public.upsert_experiment_blocks(
      (current_setting('test.exp_id'))::uuid,
      jsonb_build_array(jsonb_build_object(
        'id', current_setting('test.block_id'),
        'content', '{"text":"no version"}'::jsonb
      ))
    );
  END; $i$ $$,
  NULL, NULL, 'missing row_version is rejected'
);
RESET ROLE;

-- ─────────────────────────────────────────────────
-- Test 5: upsert returns authoritative server versions
-- ─────────────────────────────────────────────────
DO $$
DECLARE v_result jsonb;
BEGIN
  PERFORM _test_set_auth('a0000000-0000-0000-0000-000000000002'::uuid);
  v_result := public.upsert_experiment_blocks(
    (current_setting('test.exp_id'))::uuid,
    jsonb_build_array(jsonb_build_object(
      'id', current_setting('test.block_id'),
      'content', '{"text":"v3"}'::jsonb,
      'row_version', 2
    ))
  );
  PERFORM set_config('test.upsert_result', v_result::text, true);
  RESET ROLE;
END;
$$;

SELECT ok(
  (current_setting('test.upsert_result')::jsonb->'updated'->0->>'row_version')::bigint = 3,
  'upsert returns authoritative server row_version=3'
);

SELECT * FROM finish();
ROLLBACK;
