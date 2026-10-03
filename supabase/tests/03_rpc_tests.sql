-- 03_rpc_tests.sql: test domain RPCs with real data as superuser
BEGIN;
SELECT plan(15);

-- ──────────────────────────────────────────────────────
-- Setup test data hierarchy
-- ──────────────────────────────────────────────────────
DO $$
DECLARE
  v_user_id uuid := gen_random_uuid();
  v_ws_id uuid;
  v_nb_id uuid;
BEGIN
  -- Create user (profile auto-created by trigger; display_name from raw_user_meta_data)
  INSERT INTO auth.users (id, email, role, aud, instance_id, raw_user_meta_data)
  VALUES (v_user_id, 'rpc_test@example.com', 'authenticated', 'authenticated',
    '00000000-0000-0000-0000-000000000000',
    jsonb_build_object('display_name', 'RPC Tester'));

  -- Create workspace (workspace_members owner auto-created by trigger)
  INSERT INTO public.workspaces (id, name, created_by) VALUES (gen_random_uuid(), 'RPC Test WS', v_user_id)
  RETURNING id INTO v_ws_id;

  -- Create notebook
  INSERT INTO public.notebooks (id, workspace_id, name, created_by) VALUES (gen_random_uuid(), v_ws_id, 'Test NB', v_user_id)
  RETURNING id INTO v_nb_id;

  -- Store IDs for use in tests
  PERFORM set_config('test.user_id', v_user_id::text, true);
  PERFORM set_config('test.workspace_id', v_ws_id::text, true);
  PERFORM set_config('test.notebook_id', v_nb_id::text, true);
END $$;

-- ──────────────────────────────────────────────────────
-- Test 1: Internal functions denied to authenticated role
-- ──────────────────────────────────────────────────────
SELECT ok(
  NOT has_function_privilege('authenticated', 'public._build_experiment_snapshot(uuid)', 'EXECUTE'),
  'Snapshot builder denied to authenticated'
);
SELECT ok(
  NOT has_function_privilege('authenticated', 'public._create_revision_internal(uuid,text,text,uuid,jsonb)', 'EXECUTE'),
  'Internal revision creator denied to authenticated'
);

-- ──────────────────────────────────────────────────────
-- Test 2: create_experiment_rpc produces revision v1
-- ──────────────────────────────────────────────────────
DO $$
DECLARE
  v_result jsonb;
  v_exp_id uuid;
  v_rev_count int;
  v_rev_number int;
  v_hash text;
BEGIN
  -- Set auth context
  PERFORM set_config('request.jwt.claims', jsonb_build_object(
    'sub', current_setting('test.user_id'),
    'role', 'authenticated'
  )::text, true);
  PERFORM set_config('role', 'authenticated', true);

  v_result := public.create_experiment_rpc(
    current_setting('test.workspace_id')::uuid,
    current_setting('test.notebook_id')::uuid,
    'Test Experiment'
  );

  v_exp_id := (v_result->>'id')::uuid;
  PERFORM set_config('test.experiment_id', v_exp_id::text, true);

  -- Reset to superuser for catalog queries
  PERFORM set_config('role', 'postgres', true);

  SELECT count(*), max(revision_number) INTO v_rev_count, v_rev_number
  FROM public.experiment_revisions WHERE experiment_id = v_exp_id;

  SELECT content_hash INTO v_hash
  FROM public.experiment_revisions WHERE experiment_id = v_exp_id AND revision_number = 1;

  -- Store for later tests
  PERFORM set_config('test.initial_hash', COALESCE(v_hash, ''), true);

  IF v_rev_count != 1 THEN RAISE EXCEPTION 'Expected 1 revision, got %', v_rev_count; END IF;
  IF v_rev_number != 1 THEN RAISE EXCEPTION 'Expected revision 1, got %', v_rev_number; END IF;
  IF v_hash IS NULL OR v_hash = '' THEN RAISE EXCEPTION 'Content hash is empty'; END IF;
END $$;
SELECT pass('create_experiment_rpc produces revision v1 with content hash');

-- ──────────────────────────────────────────────────────
-- Test 3: Snapshot excludes status and row_version
-- (Run as superuser — internal function is correctly denied to authenticated)
-- ──────────────────────────────────────────────────────
DO $$
DECLARE
  v_snap jsonb;
BEGIN
  -- Ensure superuser context for internal function call
  PERFORM set_config('role', 'postgres', true);

  v_snap := public._build_experiment_snapshot(current_setting('test.experiment_id')::uuid);

  IF v_snap ? 'status' THEN RAISE EXCEPTION 'Snapshot should NOT contain status'; END IF;
  IF v_snap ? 'row_version' THEN RAISE EXCEPTION 'Snapshot should NOT contain row_version'; END IF;
  IF NOT (v_snap ? 'schema_version') THEN RAISE EXCEPTION 'Snapshot missing schema_version'; END IF;
  IF NOT (v_snap ? 'title') THEN RAISE EXCEPTION 'Snapshot missing title'; END IF;
  IF NOT (v_snap ? 'blocks') THEN RAISE EXCEPTION 'Snapshot missing blocks'; END IF;
  IF NOT (v_snap ? 'tags') THEN RAISE EXCEPTION 'Snapshot missing tags'; END IF;
  IF NOT (v_snap ? 'protocols') THEN RAISE EXCEPTION 'Snapshot missing protocols'; END IF;
  IF NOT (v_snap ? 'deviations') THEN RAISE EXCEPTION 'Snapshot missing deviations'; END IF;
  IF NOT (v_snap ? 'attachments') THEN RAISE EXCEPTION 'Snapshot missing attachments'; END IF;
  IF NOT (v_snap ? 'references') THEN RAISE EXCEPTION 'Snapshot missing references'; END IF;
  IF NOT (v_snap ? 'relations') THEN RAISE EXCEPTION 'Snapshot missing relations'; END IF;
  IF NOT (v_snap ? 'contributors') THEN RAISE EXCEPTION 'Snapshot missing contributors'; END IF;
END $$;
SELECT pass('Snapshot excludes status/row_version, includes all scientific fields');

-- ──────────────────────────────────────────────────────
-- Test 4: Deterministic hash — rebuild without content change yields same hash
-- ──────────────────────────────────────────────────────
DO $$
DECLARE
  v_snap1 jsonb;
  v_snap2 jsonb;
  v_hash1 text;
  v_hash2 text;
BEGIN
  PERFORM set_config('role', 'postgres', true);

  v_snap1 := public._build_experiment_snapshot(current_setting('test.experiment_id')::uuid);
  v_hash1 := encode(sha256(convert_to(v_snap1::text, 'UTF8')), 'hex');

  v_snap2 := public._build_experiment_snapshot(current_setting('test.experiment_id')::uuid);
  v_hash2 := encode(sha256(convert_to(v_snap2::text, 'UTF8')), 'hex');

  IF v_hash1 != v_hash2 THEN
    RAISE EXCEPTION 'Hashes differ: % vs %', v_hash1, v_hash2;
  END IF;
END $$;
SELECT pass('Snapshot hash is deterministic');

-- ──────────────────────────────────────────────────────
-- Test 5: Status change does NOT change content hash
-- ──────────────────────────────────────────────────────
DO $$
DECLARE
  v_hash_before text;
  v_hash_after text;
  v_exp_id uuid := current_setting('test.experiment_id')::uuid;
BEGIN
  PERFORM set_config('role', 'postgres', true);

  v_hash_before := encode(sha256(convert_to(
    (public._build_experiment_snapshot(v_exp_id))::text, 'UTF8'
  )), 'hex');

  -- Change status directly (superuser bypass)
  UPDATE public.experiments SET status = 'in_progress' WHERE id = v_exp_id;

  v_hash_after := encode(sha256(convert_to(
    (public._build_experiment_snapshot(v_exp_id))::text, 'UTF8'
  )), 'hex');

  IF v_hash_before != v_hash_after THEN
    RAISE EXCEPTION 'Status change altered content hash: % vs %', v_hash_before, v_hash_after;
  END IF;
END $$;
SELECT pass('Status change does not alter scientific content hash');

-- ──────────────────────────────────────────────────────
-- Test 6: Checkpoint works on editable experiment
-- ──────────────────────────────────────────────────────
DO $$
DECLARE v_result jsonb;
BEGIN
  PERFORM set_config('request.jwt.claims', jsonb_build_object(
    'sub', current_setting('test.user_id'),
    'role', 'authenticated'
  )::text, true);
  PERFORM set_config('role', 'authenticated', true);

  v_result := public.create_checkpoint(
    current_setting('test.experiment_id')::uuid,
    'Test checkpoint'
  );
  IF (v_result->>'revision_number')::int != 2 THEN
    RAISE EXCEPTION 'Expected revision 2, got %', v_result->>'revision_number';
  END IF;
END $$;
SELECT pass('Checkpoint creates revision v2');

-- ──────────────────────────────────────────────────────
-- Test 7: Checkpoint fails on non-editable experiment
-- ──────────────────────────────────────────────────────
DO $$
BEGIN
  PERFORM set_config('role', 'postgres', true);
  UPDATE public.experiments SET status = 'completed'
  WHERE id = current_setting('test.experiment_id')::uuid;
END $$;

SELECT throws_ok(
  $$ SELECT public.create_checkpoint(current_setting('test.experiment_id')::uuid, 'Should fail') $$,
  NULL,
  'Experiment is not in an editable state',
  'Checkpoint denied on completed experiment'
);

-- Reset to editable for further tests
DO $$ BEGIN
  PERFORM set_config('role', 'postgres', true);
  UPDATE public.experiments SET status = 'in_progress'
  WHERE id = current_setting('test.experiment_id')::uuid;
END $$;

-- ──────────────────────────────────────────────────────
-- Test 8: Cross-workspace notebook rejected
-- ──────────────────────────────────────────────────────
DO $$
DECLARE v_other_nb uuid := gen_random_uuid();
BEGIN
  PERFORM set_config('role', 'postgres', true);

  INSERT INTO public.workspaces (id, name, created_by)
  VALUES (gen_random_uuid(), 'Other WS', current_setting('test.user_id')::uuid);

  INSERT INTO public.notebooks (id, workspace_id, name, created_by)
  VALUES (v_other_nb,
    (SELECT id FROM public.workspaces WHERE name = 'Other WS'),
    'Other NB',
    current_setting('test.user_id')::uuid);

  PERFORM set_config('test.other_notebook_id', v_other_nb::text, true);

  -- Switch back to authenticated for the test
  PERFORM set_config('request.jwt.claims', jsonb_build_object(
    'sub', current_setting('test.user_id'),
    'role', 'authenticated'
  )::text, true);
  PERFORM set_config('role', 'authenticated', true);
END $$;

SELECT throws_ok(
  $$ SELECT public.create_experiment_rpc(
    current_setting('test.workspace_id')::uuid,
    current_setting('test.other_notebook_id')::uuid,
    'Cross-workspace test'
  ) $$,
  NULL,
  'Notebook does not belong to this workspace',
  'Cross-workspace notebook rejected'
);

-- ──────────────────────────────────────────────────────
-- Test 9: Metadata update validates notebook ownership
-- ──────────────────────────────────────────────────────
SELECT throws_ok(
  $$ SELECT public.update_experiment_metadata(
    current_setting('test.experiment_id')::uuid,
    (SELECT metadata_version FROM public.experiments WHERE id = current_setting('test.experiment_id')::uuid),
    'Updated Title',
    CURRENT_DATE,
    current_setting('test.other_notebook_id')::uuid,
    NULL,
    false
  ) $$,
  'P0001',
  'Notebook does not belong to this workspace',
  'Metadata update rejects cross-workspace notebook'
);

-- ──────────────────────────────────────────────────────
-- Test 10: Block insert returns complete row
-- ──────────────────────────────────────────────────────
DO $$
DECLARE
  v_result jsonb;
BEGIN
  PERFORM set_config('request.jwt.claims', jsonb_build_object(
    'sub', current_setting('test.user_id'),
    'role', 'authenticated'
  )::text, true);
  PERFORM set_config('role', 'authenticated', true);

  v_result := public.insert_experiment_block(
    current_setting('test.experiment_id')::uuid,
    'paragraph',
    '{"html":"test"}'::jsonb,
    'a0'
  );

  IF NOT (v_result ? 'id') THEN RAISE EXCEPTION 'Block result missing id'; END IF;
  IF NOT (v_result ? 'row_version') THEN RAISE EXCEPTION 'Block result missing row_version'; END IF;

  PERFORM set_config('test.block_id', v_result->>'id', true);
  PERFORM set_config('test.block_version', v_result->>'row_version', true);
END $$;
SELECT pass('insert_experiment_block returns id and row_version');

-- ──────────────────────────────────────────────────────
-- Test 11: Revision serialization — experiment locked FOR UPDATE
-- ──────────────────────────────────────────────────────
SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' AND p.proname = '_create_revision_internal'
    AND p.prosrc LIKE '%FOR UPDATE%'
  ),
  'Revision internal function contains FOR UPDATE lock'
);

-- ──────────────────────────────────────────────────────
-- Test 12: Snapshot uses correct experiment_relations columns
-- ──────────────────────────────────────────────────────
SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' AND p.proname = '_build_experiment_snapshot'
    AND p.prosrc LIKE '%source_experiment_id%'
    AND p.prosrc LIKE '%target_experiment_id%'
    AND p.prosrc LIKE '%relation_type%'
    AND p.prosrc NOT LIKE '%relationship_type%'
    AND p.prosrc NOT LIKE '%related_experiment_id%'
  ),
  'Snapshot uses correct experiment_relations column names'
);

-- ──────────────────────────────────────────────────────
-- Test 13: Snapshot uses correct attachment columns
-- ──────────────────────────────────────────────────────
SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' AND p.proname = '_build_experiment_snapshot'
    AND p.prosrc LIKE '%original_filename%'
    AND p.prosrc NOT LIKE '%''filename''%'
  ),
  'Snapshot uses original_filename (not filename) for attachments'
);

-- ──────────────────────────────────────────────────────
-- Test 14: Snapshot uses correct protocol_deviations columns
-- ──────────────────────────────────────────────────────
SELECT ok(
  EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' AND p.proname = '_build_experiment_snapshot'
    AND p.prosrc LIKE '%original_value%'
    AND p.prosrc LIKE '%actual_value%'
    AND p.prosrc NOT LIKE '%description%'
  ),
  'Snapshot uses original_value/actual_value (not description) for deviations'
);

SELECT * FROM finish();
ROLLBACK;
