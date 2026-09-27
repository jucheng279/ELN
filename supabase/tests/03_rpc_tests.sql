-- =============================================================
-- 03_rpc_tests.sql — RPC authorization + domain logic tests
-- Self-contained fixtures, uses domain RPCs for test data
-- =============================================================
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(10);

-- ─────────────────────────────────────────────────
-- Fixtures: users, workspace, notebook via superuser
-- ─────────────────────────────────────────────────
DO $$
DECLARE
  v_owner  uuid := 'a0000000-0000-0000-0000-000000000001';
  v_editor uuid := 'a0000000-0000-0000-0000-000000000002';
  v_guest  uuid := 'a0000000-0000-0000-0000-000000000003';
  v_ws     uuid := 'b0000000-0000-0000-0000-000000000001';
  v_nb     uuid := 'c0000000-0000-0000-0000-000000000001';
  v_other_ws uuid := 'b0000000-0000-0000-0000-000000000099';
  v_other_nb uuid := 'c0000000-0000-0000-0000-000000000099';
BEGIN
  INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, aud, role) VALUES
    (v_owner,  'owner@rpc.test',  crypt('pw', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, 'authenticated', 'authenticated'),
    (v_editor, 'editor@rpc.test', crypt('pw', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, 'authenticated', 'authenticated'),
    (v_guest,  'guest@rpc.test',  crypt('pw', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, 'authenticated', 'authenticated')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.workspaces (id, name, created_by) VALUES (v_ws, 'RPC Workspace', v_owner) ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.workspace_members (workspace_id, user_id, role, invited_by) VALUES
    (v_ws, v_editor, 'member', v_owner),
    (v_ws, v_guest,  'guest',  v_owner)
  ON CONFLICT DO NOTHING;
  INSERT INTO public.notebooks (id, workspace_id, name, created_by) VALUES (v_nb, v_ws, 'RPC Notebook', v_owner) ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.workspaces (id, name, created_by) VALUES (v_other_ws, 'Other WS', v_owner) ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.notebooks (id, workspace_id, name, created_by) VALUES (v_other_nb, v_other_ws, 'Other NB', v_owner) ON CONFLICT (id) DO NOTHING;
END;
$$;

-- ─────────────────────────────────────────────────
-- Helper to set authenticated context
-- ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION _test_set_auth(uid uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', uid::text, 'role', 'authenticated', 'aud', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
END;
$$;

-- ─────────────────────────────────────────────────
-- Test 1: _create_revision_internal NOT callable by authenticated
-- ─────────────────────────────────────────────────
SELECT throws_ok(
  $$ DO $i$ BEGIN
    PERFORM _test_set_auth('a0000000-0000-0000-0000-000000000002'::uuid);
    PERFORM public._create_revision_internal('d0000000-0000-0000-0000-000000000001', 'test', 'checkpoint', 'a0000000-0000-0000-0000-000000000002');
  END; $i$ $$,
  '42501', NULL, '_create_revision_internal denied for authenticated'
);
RESET ROLE;

-- ─────────────────────────────────────────────────
-- Test 2: _build_experiment_snapshot NOT callable by authenticated
-- ─────────────────────────────────────────────────
SELECT throws_ok(
  $$ DO $i$ BEGIN
    PERFORM _test_set_auth('a0000000-0000-0000-0000-000000000002'::uuid);
    PERFORM public._build_experiment_snapshot('d0000000-0000-0000-0000-000000000001');
  END; $i$ $$,
  '42501', NULL, '_build_experiment_snapshot denied for authenticated'
);
RESET ROLE;

-- ─────────────────────────────────────────────────
-- Test 3-4: create_experiment_rpc + create_checkpoint
-- ─────────────────────────────────────────────────
DO $$
DECLARE v_result jsonb;
BEGIN
  PERFORM _test_set_auth('a0000000-0000-0000-0000-000000000002'::uuid);
  v_result := public.create_experiment_rpc(
    'b0000000-0000-0000-0000-000000000001',
    'c0000000-0000-0000-0000-000000000001',
    'RPC Test Experiment'
  );
  PERFORM set_config('test.exp_id', v_result->>'id', true);
  RESET ROLE;
END;
$$;

-- Test 3: experiment was created with initial revision
SELECT ok(
  EXISTS (
    SELECT 1 FROM public.experiment_revisions
    WHERE experiment_id = (current_setting('test.exp_id'))::uuid
      AND change_type = 'created' AND revision_number = 1
  ),
  'create_experiment_rpc produces initial revision v1'
);

-- Test 4: create_checkpoint on draft succeeds
SELECT lives_ok(
  $$ DO $i$ DECLARE v_result jsonb; BEGIN
    PERFORM _test_set_auth('a0000000-0000-0000-0000-000000000002'::uuid);
    v_result := public.create_checkpoint((current_setting('test.exp_id'))::uuid, 'test checkpoint');
    RESET ROLE;
  END; $i$ $$,
  'create_checkpoint succeeds on draft'
);

-- Test 5: checkpoint on locked experiment fails
DO $$ BEGIN
  INSERT INTO public.experiments (id, workspace_id, notebook_id, title, status, is_locked, is_archived, created_by)
  VALUES ('d0000000-0000-0000-0000-0000000000ff', 'b0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001',
    'Locked Exp', 'locked', true, false, 'a0000000-0000-0000-0000-000000000001');
END; $$;

SELECT throws_ok(
  $$ DO $i$ DECLARE v_result jsonb; BEGIN
    PERFORM _test_set_auth('a0000000-0000-0000-0000-000000000002'::uuid);
    v_result := public.create_checkpoint('d0000000-0000-0000-0000-0000000000ff', 'fail');
  END; $i$ $$,
  NULL, NULL, 'create_checkpoint fails on locked experiment'
);
RESET ROLE;

-- ─────────────────────────────────────────────────
-- Test 6: update_experiment_metadata rejects cross-workspace notebook
-- ─────────────────────────────────────────────────
SELECT throws_ok(
  $$ DO $i$ DECLARE v_result jsonb; BEGIN
    PERFORM _test_set_auth('a0000000-0000-0000-0000-000000000002'::uuid);
    v_result := public.update_experiment_metadata(
      (current_setting('test.exp_id'))::uuid,
      p_notebook_id := 'c0000000-0000-0000-0000-000000000099'
    );
  END; $i$ $$,
  NULL, NULL, 'metadata rejects cross-workspace notebook'
);
RESET ROLE;

-- Test 7: update_experiment_metadata succeeds
SELECT lives_ok(
  $$ DO $i$ DECLARE v_result jsonb; BEGIN
    PERFORM _test_set_auth('a0000000-0000-0000-0000-000000000002'::uuid);
    v_result := public.update_experiment_metadata(
      (current_setting('test.exp_id'))::uuid, p_title := 'Updated Title'
    );
    RESET ROLE;
  END; $i$ $$,
  'metadata update succeeds with valid data'
);

-- ─────────────────────────────────────────────────
-- Test 8: insert_experiment_block returns complete row with row_version
-- ─────────────────────────────────────────────────
DO $$
DECLARE v_result jsonb;
BEGIN
  PERFORM _test_set_auth('a0000000-0000-0000-0000-000000000002'::uuid);
  v_result := public.insert_experiment_block(
    (current_setting('test.exp_id'))::uuid,
    'paragraph',
    '{"text":"hello"}'::jsonb,
    'a0'
  );
  PERFORM set_config('test.block_result', v_result::text, true);
  RESET ROLE;
END;
$$;

SELECT ok(
  (current_setting('test.block_result')::jsonb)->>'row_version' IS NOT NULL
    AND (current_setting('test.block_result')::jsonb)->>'id' IS NOT NULL
    AND (current_setting('test.block_result')::jsonb)->>'order_key' IS NOT NULL,
  'insert_experiment_block returns complete row with row_version'
);

-- ─────────────────────────────────────────────────
-- Test 9: create_experiment_rpc rejects cross-workspace notebook
-- ─────────────────────────────────────────────────
SELECT throws_ok(
  $$ DO $i$ DECLARE v_result jsonb; BEGIN
    PERFORM _test_set_auth('a0000000-0000-0000-0000-000000000002'::uuid);
    v_result := public.create_experiment_rpc(
      'b0000000-0000-0000-0000-000000000001',
      'c0000000-0000-0000-0000-000000000099',
      'Should fail'
    );
  END; $i$ $$,
  NULL, NULL, 'create_experiment_rpc rejects foreign-workspace notebook'
);
RESET ROLE;

-- ─────────────────────────────────────────────────
-- Test 10: canonical snapshot is deterministic (same hash twice)
-- ─────────────────────────────────────────────────
DO $$
DECLARE v_hash1 text; v_hash2 text;
BEGIN
  v_hash1 := encode(sha256(convert_to(
    (public._build_experiment_snapshot((current_setting('test.exp_id'))::uuid))::text, 'UTF8'
  )), 'hex');
  v_hash2 := encode(sha256(convert_to(
    (public._build_experiment_snapshot((current_setting('test.exp_id'))::uuid))::text, 'UTF8'
  )), 'hex');
  PERFORM set_config('test.hash1', v_hash1, true);
  PERFORM set_config('test.hash2', v_hash2, true);
END;
$$;

SELECT is(
  current_setting('test.hash1'),
  current_setting('test.hash2'),
  'canonical snapshot produces deterministic hash'
);

SELECT * FROM finish();
ROLLBACK;
