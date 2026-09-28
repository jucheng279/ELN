-- 04_concurrency_tests.sql: optimistic concurrency via row_version
BEGIN;
SELECT plan(7);

-- Setup: create user, workspace, notebook, experiment, block
DO $$
DECLARE
  v_user_id uuid := gen_random_uuid();
  v_ws_id uuid;
  v_nb_id uuid;
  v_result jsonb;
  v_exp_id uuid;
  v_block_result jsonb;
BEGIN
  INSERT INTO auth.users (id, email, role, aud, instance_id, raw_user_meta_data)
  VALUES (v_user_id, 'concurrency@test.com', 'authenticated', 'authenticated',
    '00000000-0000-0000-0000-000000000000',
    jsonb_build_object('display_name', 'Conc Tester'));
  -- profile + workspace_members auto-created by triggers

  INSERT INTO public.workspaces (id, name, created_by) VALUES (gen_random_uuid(), 'Conc WS', v_user_id)
  RETURNING id INTO v_ws_id;

  INSERT INTO public.notebooks (id, workspace_id, name, created_by) VALUES (gen_random_uuid(), v_ws_id, 'Conc NB', v_user_id)
  RETURNING id INTO v_nb_id;

  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_user_id, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);

  v_result := public.create_experiment_rpc(v_ws_id, v_nb_id, 'Concurrency Test');
  v_exp_id := (v_result->>'id')::uuid;

  -- Start experiment so it's editable
  UPDATE public.experiments SET status = 'in_progress' WHERE id = v_exp_id;

  v_block_result := public.insert_experiment_block(v_exp_id, 'paragraph', '{"html":"original"}'::jsonb, 'a0');

  PERFORM set_config('test.user_id', v_user_id::text, true);
  PERFORM set_config('test.experiment_id', v_exp_id::text, true);
  PERFORM set_config('test.block_id', v_block_result->>'id', true);
  PERFORM set_config('test.block_version', v_block_result->>'row_version', true);
END $$;

-- Test 1: Correct version succeeds
SELECT lives_ok(
  $$ SELECT public.upsert_experiment_blocks(
    current_setting('test.experiment_id')::uuid,
    jsonb_build_array(jsonb_build_object(
      'id', current_setting('test.block_id'),
      'type', 'paragraph',
      'content', '{"html":"updated"}'::jsonb,
      'order_key', 'a0',
      'row_version', current_setting('test.block_version')::bigint
    ))
  ) $$,
  'Upsert with correct version succeeds'
);

-- Test 2: Version increments after successful upsert
SELECT is(
  (SELECT row_version FROM public.experiment_blocks WHERE id = current_setting('test.block_id')::uuid),
  (current_setting('test.block_version')::bigint + 1),
  'Row version incremented after upsert'
);

-- Test 3: Stale version rejected with serialization_failure
SELECT throws_ok(
  $$ SELECT public.upsert_experiment_blocks(
    current_setting('test.experiment_id')::uuid,
    jsonb_build_array(jsonb_build_object(
      'id', current_setting('test.block_id'),
      'type', 'paragraph',
      'content', '{"html":"stale"}'::jsonb,
      'order_key', 'a0',
      'row_version', 1
    ))
  ) $$,
  '40001',
  NULL,
  'Stale row_version rejected with serialization_failure'
);

-- Test 4: Missing row_version rejected
DO $
DECLARE
  v_block_id text := current_setting('test.block_id');
BEGIN
  PERFORM set_config('request.jwt.claims', jsonb_build_object(
    'sub', current_setting('test.user_id'),
    'role', 'authenticated'
  )::text, true);
  PERFORM set_config('role', 'authenticated', true);

  BEGIN
    PERFORM public.upsert_experiment_blocks(
      current_setting('test.experiment_id')::uuid,
      jsonb_build_array(jsonb_build_object(
        'id', v_block_id,
        'type', 'paragraph',
        'content', '{"html":"no version"}'::jsonb,
        'order_key', 'a0'
      ))
    );
    RAISE EXCEPTION 'Should have raised an error for missing row_version';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE 'row_version is required and must be > 0 for block%' THEN
      RAISE EXCEPTION 'Unexpected error: %', SQLERRM;
    END IF;
  END;
END $;
SELECT pass('Missing row_version rejected');

-- Test 5: Upsert returns authoritative server versions
DO $$
DECLARE
  v_result jsonb;
  v_current_version bigint;
  v_returned_version bigint;
BEGIN
  PERFORM set_config('request.jwt.claims', jsonb_build_object(
    'sub', current_setting('test.user_id'),
    'role', 'authenticated'
  )::text, true);
  PERFORM set_config('role', 'authenticated', true);

  SELECT row_version INTO v_current_version FROM public.experiment_blocks
  WHERE id = current_setting('test.block_id')::uuid;

  v_result := public.upsert_experiment_blocks(
    current_setting('test.experiment_id')::uuid,
    jsonb_build_array(jsonb_build_object(
      'id', current_setting('test.block_id'),
      'type', 'paragraph',
      'content', '{"html":"version check"}'::jsonb,
      'order_key', 'a0',
      'row_version', v_current_version
    ))
  );

  v_returned_version := ((v_result->'updated')->0->>'row_version')::bigint;
  IF v_returned_version != v_current_version + 1 THEN
    RAISE EXCEPTION 'Expected returned version %, got %', v_current_version + 1, v_returned_version;
  END IF;
END $$;
SELECT pass('Upsert returns authoritative server row_version');

-- Test 6: Delete requires version (NULL rejected)
SELECT throws_ok(
  $$ SELECT public.delete_experiment_block(
    current_setting('test.experiment_id')::uuid,
    current_setting('test.block_id')::uuid,
    NULL
  ) $$,
  NULL,
  'p_expected_version is required and must be > 0',
  'Delete rejects NULL version'
);

-- Test 7: Delete with correct version succeeds
DO $$
DECLARE
  v_current_version bigint;
BEGIN
  PERFORM set_config('request.jwt.claims', jsonb_build_object(
    'sub', current_setting('test.user_id'),
    'role', 'authenticated'
  )::text, true);
  PERFORM set_config('role', 'authenticated', true);

  SELECT row_version INTO v_current_version FROM public.experiment_blocks
  WHERE id = current_setting('test.block_id')::uuid;

  PERFORM public.delete_experiment_block(
    current_setting('test.experiment_id')::uuid,
    current_setting('test.block_id')::uuid,
    v_current_version
  );
END $$;
SELECT pass('Delete with correct version succeeds');

SELECT * FROM finish();
ROLLBACK;
