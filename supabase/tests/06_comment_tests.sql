-- =============================================================
-- 06_comment_tests.sql — add_comment_with_mentions RPC tests
-- Self-contained: uses actual schema columns
-- =============================================================
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(5);

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
  v_guest  uuid := 'a0000000-0000-0000-0000-000000000003';
  v_outsider uuid := 'a0000000-0000-0000-0000-000000000004';
  v_ws     uuid := 'b0000000-0000-0000-0000-000000000001';
  v_nb     uuid := 'c0000000-0000-0000-0000-000000000001';
  v_exp_result jsonb;
BEGIN
  INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, aud, role) VALUES
    (v_owner,    'owner@cm.test',    crypt('pw', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, 'authenticated', 'authenticated'),
    (v_editor,   'editor@cm.test',   crypt('pw', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, 'authenticated', 'authenticated'),
    (v_guest,    'guest@cm.test',    crypt('pw', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, 'authenticated', 'authenticated'),
    (v_outsider, 'outsider@cm.test', crypt('pw', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, 'authenticated', 'authenticated')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.workspaces (id, name, created_by) VALUES (v_ws, 'CM Workspace', v_owner) ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.workspace_members (workspace_id, user_id, role, invited_by) VALUES
    (v_ws, v_editor, 'member', v_owner),
    (v_ws, v_guest,  'guest',  v_owner)
  ON CONFLICT DO NOTHING;
  INSERT INTO public.notebooks (id, workspace_id, name, created_by) VALUES (v_nb, v_ws, 'CM Notebook', v_owner) ON CONFLICT (id) DO NOTHING;

  PERFORM _test_set_auth(v_editor);
  v_exp_result := public.create_experiment_rpc(v_ws, v_nb, 'Comment Test');
  PERFORM set_config('test.exp_id', v_exp_result->>'id', true);
  RESET ROLE;
END;
$$;

-- ─────────────────────────────────────────────────
-- Test 1: New comment creates thread + comment
-- ─────────────────────────────────────────────────
DO $$
DECLARE v_result jsonb;
BEGIN
  PERFORM _test_set_auth('a0000000-0000-0000-0000-000000000002'::uuid);
  v_result := public.add_comment_with_mentions(
    (current_setting('test.exp_id'))::uuid,
    NULL, 'Hello world', '{}'
  );
  PERFORM set_config('test.thread_id', v_result->>'thread_id', true);
  PERFORM set_config('test.comment_id', v_result->>'comment_id', true);
  RESET ROLE;
END;
$$;

SELECT ok(
  current_setting('test.thread_id') IS NOT NULL AND current_setting('test.comment_id') IS NOT NULL,
  'add_comment creates thread and comment'
);

-- Test 2: Comment with mentions creates mention rows
DO $$
DECLARE v_result jsonb;
BEGIN
  PERFORM _test_set_auth('a0000000-0000-0000-0000-000000000002'::uuid);
  v_result := public.add_comment_with_mentions(
    (current_setting('test.exp_id'))::uuid,
    (current_setting('test.thread_id'))::uuid,
    'Hey @owner',
    ARRAY['a0000000-0000-0000-0000-000000000001']::uuid[]
  );
  PERFORM set_config('test.mention_comment_id', v_result->>'comment_id', true);
  RESET ROLE;
END;
$$;

SELECT ok(
  EXISTS (
    SELECT 1 FROM public.mentions
    WHERE comment_id = (current_setting('test.mention_comment_id'))::uuid
      AND user_id = 'a0000000-0000-0000-0000-000000000001'
  ),
  'mention row created for workspace member'
);

-- Test 3: Mention of non-workspace member is silently skipped
SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM public.mentions
    WHERE comment_id = (current_setting('test.mention_comment_id'))::uuid
      AND user_id = 'a0000000-0000-0000-0000-000000000004'
  ),
  'outsider mention silently skipped'
);

-- Test 4: Duplicate mention IDs are deduplicated
DO $$
DECLARE v_result jsonb; v_count int;
BEGIN
  PERFORM _test_set_auth('a0000000-0000-0000-0000-000000000002'::uuid);
  v_result := public.add_comment_with_mentions(
    (current_setting('test.exp_id'))::uuid,
    (current_setting('test.thread_id'))::uuid,
    'Hey @owner @owner',
    ARRAY['a0000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001']::uuid[]
  );
  SELECT count(*) INTO v_count FROM public.mentions WHERE comment_id = (v_result->>'comment_id')::uuid;
  PERFORM set_config('test.dedup_count', v_count::text, true);
  RESET ROLE;
END;
$$;

SELECT is(current_setting('test.dedup_count')::int, 1, 'duplicate mention IDs deduplicated');

-- Test 5: Non-member cannot comment
SELECT throws_ok(
  $$ DO $i$ DECLARE v_result jsonb; BEGIN
    PERFORM _test_set_auth('a0000000-0000-0000-0000-000000000004'::uuid);
    v_result := public.add_comment_with_mentions(
      (current_setting('test.exp_id'))::uuid, NULL, 'no access', '{}'
    );
  END; $i$ $$,
  NULL, NULL, 'non-member cannot comment'
);
RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
