-- 11_scientific_provenance_tests.sql: protocol instances, attachment versioning,
-- snapshot V2 with provenance, duplicate COW, amendment COW, and restore.
BEGIN;
SELECT plan(14);

-- ── Setup ─────────────────────────────────────────────────────────
DO $$
DECLARE
  v_uid uuid := gen_random_uuid();
  v_ws  uuid;
  v_nb  uuid;
  v_exp uuid;
  v_att uuid;
  v_av1 uuid;
  v_av2 uuid;
  v_prt uuid;
  v_pv  uuid;
  v_ep  uuid;
  v_blk uuid := gen_random_uuid();
BEGIN
  -- auth user
  INSERT INTO auth.users (id, email, role, aud, instance_id, raw_user_meta_data)
  VALUES (v_uid, 'provenance@test.com', 'authenticated', 'authenticated',
    '00000000-0000-0000-0000-000000000000',
    jsonb_build_object('display_name', 'Provenance Tester'));

  INSERT INTO public.workspaces (id, name, created_by) VALUES (gen_random_uuid(), 'Prov WS', v_uid)
  RETURNING id INTO v_ws;

  INSERT INTO public.notebooks (id, workspace_id, name, created_by) VALUES (gen_random_uuid(), v_ws, 'Prov NB', v_uid)
  RETURNING id INTO v_nb;

  INSERT INTO public.experiments (id, workspace_id, notebook_id, title, created_by, experiment_id)
  VALUES (gen_random_uuid(), v_ws, v_nb, 'Provenance Exp', v_uid, 'PROV-001')
  RETURNING id INTO v_exp;

  -- create attachment via RPC
  SELECT (r).attachment_id, (r).attachment_version_id INTO v_att, v_av1
  FROM create_attachment(
    p_experiment_id := v_exp,
    p_storage_path := 'exp/' || v_exp || '/files/test.pdf',
    p_original_filename := 'test.pdf',
    p_display_name := 'Test PDF',
    p_mime_type := 'application/pdf',
    p_file_size := 1024,
    p_checksum := 'a'.repeat(64)
  ) r;

  -- replace attachment to create v2
  SELECT (r2).attachment_version_id INTO v_av2
  FROM replace_attachment(
    p_attachment_id := v_att,
    p_storage_path := 'exp/' || v_exp || '/files/test_v2.pdf',
    p_original_filename := 'test_v2.pdf',
    p_display_name := 'Test PDF v2',
    p_mime_type := 'application/pdf',
    p_file_size := 2048,
    p_checksum := 'b'.repeat(64)
  ) r2;

  -- create protocol + version
  INSERT INTO public.protocols (id, name, created_by)
  VALUES (gen_random_uuid(), 'Sample Protocol', v_uid)
  RETURNING id INTO v_prt;

  INSERT INTO public.protocol_versions (id, protocol_id, version_number, created_by, steps)
  VALUES (gen_random_uuid(), v_prt, 1, v_uid,
    '[{"step_number":1,"instruction":"Mix reagents","duration":"5 min","temperature":null,"notes":null,"warnings":null}]'::jsonb)
  RETURNING id INTO v_pv;

  -- attach protocol to experiment
  SELECT attach_protocol_to_experiment INTO v_ep
  FROM attach_protocol_to_experiment(
    p_experiment_id := v_exp,
    p_protocol_id := v_prt,
    p_protocol_version_id := v_pv
  );

  -- add a deviation
  PERFORM upsert_protocol_deviation(
    p_experiment_protocol_id := v_ep,
    p_step_index := 0,
    p_actual_value := 'Mixed for 10 min instead',
    p_reason := 'Sample was viscous'
  );

  -- store IDs for later tests
  PERFORM set_config('test.uid', v_uid::text, true);
  PERFORM set_config('test.exp_id', v_exp::text, true);
  PERFORM set_config('test.att_id', v_att::text, true);
  PERFORM set_config('test.av1_id', v_av1::text, true);
  PERFORM set_config('test.av2_id', v_av2::text, true);
  PERFORM set_config('test.ep_id', v_ep::text, true);
  PERFORM set_config('test.prt_id', v_prt::text, true);
  PERFORM set_config('test.pv_id', v_pv::text, true);
  PERFORM set_config('test.blk_id', v_blk::text, true);
END $$;

-- ── 1. Attachment version v1 exists ──────────────────────────────
SELECT ok(
  EXISTS (SELECT 1 FROM attachment_versions WHERE id = current_setting('test.av1_id')::uuid),
  'Attachment version v1 created'
);

-- ── 2. Attachment version v2 exists with correct source ──────────
SELECT ok(
  EXISTS (
    SELECT 1 FROM attachment_versions
    WHERE id = current_setting('test.av2_id')::uuid
      AND source_attachment_version_id = current_setting('test.av1_id')::uuid
  ),
  'Attachment version v2 tracks source version'
);

-- ── 3. Attachment v2 has correct checksum ────────────────────────
SELECT is(
  (SELECT checksum FROM attachment_versions WHERE id = current_setting('test.av2_id')::uuid),
  repeat('b', 64),
  'Attachment v2 checksum matches'
);

-- ── 4. Immutability trigger blocks UPDATE on attachment_versions ─
SELECT throws_ok(
  $$ UPDATE attachment_versions SET file_size = 9999
     WHERE id = current_setting('test.av1_id')::uuid $$,
  NULL,
  NULL,
  'Attachment version immutability trigger blocks UPDATE'
);

-- ── 5. Experiment protocol instance created ──────────────────────
SELECT ok(
  EXISTS (
    SELECT 1 FROM experiment_protocols
    WHERE id = current_setting('test.ep_id')::uuid
      AND experiment_id = current_setting('test.exp_id')::uuid
  ),
  'Experiment protocol instance created'
);

-- ── 6. Protocol deviation recorded ───────────────────────────────
SELECT ok(
  EXISTS (
    SELECT 1 FROM protocol_deviations
    WHERE experiment_protocol_id = current_setting('test.ep_id')::uuid
      AND step_index = 0
      AND actual_value = 'Mixed for 10 min instead'
  ),
  'Protocol deviation recorded with correct values'
);

-- ── 7. Deviation has server-derived original_value ───────────────
SELECT is(
  (SELECT original_value FROM protocol_deviations
   WHERE experiment_protocol_id = current_setting('test.ep_id')::uuid AND step_index = 0),
  'Mix reagents',
  'Deviation original_value derived from protocol step instruction'
);

-- ── 8. Duplicate experiment creates COW attachment records ───────
DO $$
DECLARE
  v_dup_id uuid;
  v_dup_att_count int;
BEGIN
  -- First add an experiment block referencing the attachment for the snapshot
  INSERT INTO public.experiment_blocks (id, experiment_id, type, content, order_key)
  VALUES (
    current_setting('test.blk_id')::uuid,
    current_setting('test.exp_id')::uuid,
    'attachment',
    jsonb_build_object(
      'attachmentId', current_setting('test.att_id'),
      'attachmentVersionId', current_setting('test.av2_id'),
      'checksum', repeat('b', 64),
      'filename', 'test_v2.pdf',
      'displayName', 'Test PDF v2',
      'storagePath', 'exp/' || current_setting('test.exp_id') || '/files/test_v2.pdf',
      'fileSize', 2048,
      'mimeType', 'application/pdf'
    ),
    'a0'
  );

  SELECT duplicate_experiment_rpc INTO v_dup_id
  FROM duplicate_experiment_rpc(current_setting('test.exp_id')::uuid);

  SELECT count(*) INTO v_dup_att_count
  FROM attachments WHERE experiment_id = v_dup_id;

  PERFORM set_config('test.dup_id', v_dup_id::text, true);
  PERFORM set_config('test.dup_att_count', v_dup_att_count::text, true);
END $$;

SELECT ok(
  current_setting('test.dup_id')::uuid IS NOT NULL,
  'Duplicate experiment created'
);

-- ── 9. Duplicate has its own attachment records (COW) ────────────
SELECT ok(
  current_setting('test.dup_att_count')::int > 0,
  'Duplicate experiment has COW attachment records'
);

-- ── 10. Duplicate experiment has an initial revision ─────────────
SELECT ok(
  EXISTS (
    SELECT 1 FROM experiment_revisions
    WHERE experiment_id = current_setting('test.dup_id')::uuid
      AND revision_number = 1
  ),
  'Duplicate experiment has initial revision'
);

-- ── 11. Duplicate protocol instances are separate ────────────────
DO $$
DECLARE
  v_dup_ep_count int;
BEGIN
  SELECT count(*) INTO v_dup_ep_count
  FROM experiment_protocols
  WHERE experiment_id = current_setting('test.dup_id')::uuid;
  PERFORM set_config('test.dup_ep_count', v_dup_ep_count::text, true);
END $$;

SELECT ok(
  current_setting('test.dup_ep_count')::int > 0,
  'Duplicate experiment has COW protocol instances'
);

-- ── 12. Checksum format validated (64 hex chars) ─────────────────
SELECT throws_ok(
  $$ SELECT create_attachment(
    p_experiment_id := current_setting('test.exp_id')::uuid,
    p_storage_path := 'exp/bad/checksum.pdf',
    p_original_filename := 'bad.pdf',
    p_display_name := 'Bad',
    p_mime_type := 'application/pdf',
    p_file_size := 100,
    p_checksum := 'too-short'
  ) $$,
  NULL,
  NULL,
  'Invalid checksum format rejected by create_attachment'
);

-- ── 13. Deviation unique constraint (upsert doesn't duplicate) ───
DO $$
BEGIN
  -- Upsert same step_index again with new value
  PERFORM upsert_protocol_deviation(
    p_experiment_protocol_id := current_setting('test.ep_id')::uuid,
    p_step_index := 0,
    p_actual_value := 'Mixed for 15 min now',
    p_reason := 'Updated reason'
  );
END $$;

SELECT is(
  (SELECT count(*)::int FROM protocol_deviations
   WHERE experiment_protocol_id = current_setting('test.ep_id')::uuid AND step_index = 0),
  1,
  'Upsert deviation replaces existing (no duplicates)'
);

-- ── 14. Delete deviation works ───────────────────────────────────
DO $$
BEGIN
  PERFORM delete_protocol_deviation(
    p_experiment_protocol_id := current_setting('test.ep_id')::uuid,
    p_step_index := 0
  );
END $$;

SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM protocol_deviations
    WHERE experiment_protocol_id = current_setting('test.ep_id')::uuid AND step_index = 0
  ),
  'Delete deviation removes the record'
);

SELECT * FROM finish();
ROLLBACK;
