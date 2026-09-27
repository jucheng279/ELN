-- =============================================================
-- 02_lifecycle_tests.sql — CHECK constraint tests
-- Self-contained: creates own workspace/notebook fixtures
-- =============================================================
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(6);

-- Create minimal fixture data for valid FK references
DO $$
DECLARE
  v_owner uuid := 'a0000000-0000-0000-0000-000000000001';
  v_ws    uuid := 'b0000000-0000-0000-0000-000000000001';
  v_nb    uuid := 'c0000000-0000-0000-0000-000000000001';
BEGIN
  INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, aud, role)
  VALUES (v_owner, 'owner@lc.test', crypt('pw', gen_salt('bf')), now(),
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, 'authenticated', 'authenticated')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.workspaces (id, name, created_by)
  VALUES (v_ws, 'LC Workspace', v_owner)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.notebooks (id, workspace_id, name, created_by)
  VALUES (v_nb, v_ws, 'LC Notebook', v_owner)
  ON CONFLICT (id) DO NOTHING;
END;
$$;

-- 1. status=locked with is_locked=false -> rejected
SELECT throws_ok(
  $$ INSERT INTO public.experiments (workspace_id, notebook_id, title, status, is_locked, is_archived, created_by)
     VALUES ('b0000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000001','test','locked',false,false,'a0000000-0000-0000-0000-000000000001') $$,
  '23514', NULL, 'locked requires is_locked=true'
);

-- 2. status=locked with is_archived=true -> rejected
SELECT throws_ok(
  $$ INSERT INTO public.experiments (workspace_id, notebook_id, title, status, is_locked, is_archived, created_by)
     VALUES ('b0000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000001','test','locked',true,true,'a0000000-0000-0000-0000-000000000001') $$,
  '23514', NULL, 'locked cannot be archived'
);

-- 3. status=archived with is_archived=false -> rejected
SELECT throws_ok(
  $$ INSERT INTO public.experiments (workspace_id, notebook_id, title, status, is_locked, is_archived, created_by)
     VALUES ('b0000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000001','test','archived',false,false,'a0000000-0000-0000-0000-000000000001') $$,
  '23514', NULL, 'archived requires is_archived=true'
);

-- 4. status=draft with is_locked=true -> rejected
SELECT throws_ok(
  $$ INSERT INTO public.experiments (workspace_id, notebook_id, title, status, is_locked, is_archived, created_by)
     VALUES ('b0000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000001','test','draft',true,false,'a0000000-0000-0000-0000-000000000001') $$,
  '23514', NULL, 'draft cannot be locked'
);

-- 5. status=in_progress with is_archived=true -> rejected
SELECT throws_ok(
  $$ INSERT INTO public.experiments (workspace_id, notebook_id, title, status, is_locked, is_archived, created_by)
     VALUES ('b0000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000001','test','in_progress',false,true,'a0000000-0000-0000-0000-000000000001') $$,
  '23514', NULL, 'in_progress cannot be archived'
);

-- 6. Valid draft passes
SELECT lives_ok(
  $$ INSERT INTO public.experiments (workspace_id, notebook_id, title, status, is_locked, is_archived, created_by)
     VALUES ('b0000000-0000-0000-0000-000000000001','c0000000-0000-0000-0000-000000000001','Valid Draft','draft',false,false,'a0000000-0000-0000-0000-000000000001') $$,
  'valid draft inserts ok'
);

SELECT * FROM finish();
ROLLBACK;
