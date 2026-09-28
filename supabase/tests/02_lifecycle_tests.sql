-- 02_lifecycle_tests.sql: CHECK constraint for status/is_locked/is_archived
BEGIN;
SELECT plan(6);

-- Setup: create the required parent rows for FK satisfaction
DO $$
DECLARE
  v_user_id uuid := gen_random_uuid();
  v_ws_id uuid;
  v_nb_id uuid;
BEGIN
  INSERT INTO auth.users (id, email, role, aud, instance_id, raw_user_meta_data)
  VALUES (v_user_id, 'lifecycle@test.com', 'authenticated', 'authenticated',
    '00000000-0000-0000-0000-000000000000',
    jsonb_build_object('display_name', 'Lifecycle Tester'));
  -- profile auto-created by handle_new_user trigger

  INSERT INTO public.workspaces (id, name, created_by)
  VALUES (gen_random_uuid(), 'Lifecycle WS', v_user_id)
  RETURNING id INTO v_ws_id;
  -- workspace_members(owner) auto-created by handle_new_workspace trigger

  INSERT INTO public.notebooks (id, workspace_id, name, created_by)
  VALUES (gen_random_uuid(), v_ws_id, 'Lifecycle NB', v_user_id)
  RETURNING id INTO v_nb_id;

  PERFORM set_config('test.user_id', v_user_id::text, true);
  PERFORM set_config('test.workspace_id', v_ws_id::text, true);
  PERFORM set_config('test.notebook_id', v_nb_id::text, true);
END $$;

-- Helper to attempt direct status mutation (bypasses RPC for constraint testing)
CREATE OR REPLACE FUNCTION _test_set_experiment_status(p_status text, p_locked bool, p_archived bool)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE v_id uuid;
BEGIN
  SELECT e.id INTO v_id FROM public.experiments e LIMIT 1;
  IF NOT FOUND THEN
    INSERT INTO public.experiments (workspace_id, notebook_id, title, status, is_locked, is_archived, created_by, experiment_id)
    VALUES (
      current_setting('test.workspace_id')::uuid,
      current_setting('test.notebook_id')::uuid,
      'lifecycle test',
      p_status, p_locked, p_archived,
      current_setting('test.user_id')::uuid,
      'LC-001'
    ) RETURNING experiments.id INTO v_id;
  ELSE
    UPDATE public.experiments SET status = p_status, is_locked = p_locked, is_archived = p_archived WHERE experiments.id = v_id;
  END IF;
END;
$$;

-- Invalid: locked status without is_locked flag
SELECT throws_ok(
  $$ SELECT _test_set_experiment_status('locked', false, false) $$,
  '23514',
  NULL,
  'locked status requires is_locked=true'
);

-- Invalid: archived status without is_archived flag
SELECT throws_ok(
  $$ SELECT _test_set_experiment_status('archived', false, false) $$,
  '23514',
  NULL,
  'archived status requires is_archived=true'
);

-- Invalid: draft with is_locked=true
SELECT throws_ok(
  $$ SELECT _test_set_experiment_status('draft', true, false) $$,
  '23514',
  NULL,
  'non-locked/archived status cannot have is_locked=true'
);

-- Invalid: in_progress with is_archived=true
SELECT throws_ok(
  $$ SELECT _test_set_experiment_status('in_progress', false, true) $$,
  '23514',
  NULL,
  'non-archived status cannot have is_archived=true'
);

-- Invalid: locked with is_archived=true
SELECT throws_ok(
  $$ SELECT _test_set_experiment_status('locked', true, true) $$,
  '23514',
  NULL,
  'locked status cannot have is_archived=true'
);

-- Valid: locked with is_locked=true, is_archived=false
SELECT lives_ok(
  $$ SELECT _test_set_experiment_status('locked', true, false) $$,
  'locked status with is_locked=true accepted'
);

SELECT * FROM finish();
ROLLBACK;
