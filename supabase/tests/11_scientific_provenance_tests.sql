-- 11_scientific_provenance_tests.sql: protocol instances, attachment versioning,
-- duplicate copy-on-write, and checksum validation, exercised as an authenticated member.
BEGIN;
SELECT plan(16);

-- ── Setup ─────────────────────────────────────────────────────────
DO $$
DECLARE
  v_uid uuid := gen_random_uuid();
  v_ws  uuid;
  v_nb  uuid;
  v_exp uuid;
  v_att jsonb;
  v_rep jsonb;
  v_prt uuid;
  v_pv  uuid;
  v_ep  jsonb;
BEGIN
  INSERT INTO auth.users (id, email, role, aud, instance_id, raw_user_meta_data)
  VALUES (v_uid, 'provenance@test.com', 'authenticated', 'authenticated',
    '00000000-0000-0000-0000-000000000000',
    jsonb_build_object('display_name', 'Provenance Tester'));

  INSERT INTO public.workspaces (id, name, created_by) VALUES (gen_random_uuid(), 'Prov WS', v_uid)
  RETURNING id INTO v_ws;

  INSERT INTO public.notebooks (id, workspace_id, name, created_by) VALUES (gen_random_uuid(), v_ws, 'Prov NB', v_uid)
  RETURNING id INTO v_nb;

  INSERT INTO public.protocols (id, workspace_id, name, created_by)
  VALUES (gen_random_uuid(), v_ws, 'Sample Protocol', v_uid)
  RETURNING id INTO v_prt;

  INSERT INTO public.protocol_versions (id, protocol_id, version_number, created_by, status, published_at, steps)
  VALUES (gen_random_uuid(), v_prt, 1, v_uid, 'published', now(),
    '[{"step_number":1,"instruction":"Mix reagents","duration":"5 min","temperature":null,"notes":null,"warnings":null}]'::jsonb)
  RETURNING id INTO v_pv;

  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);

  v_exp := (public.create_experiment_rpc(v_ws, v_nb, 'Provenance Exp')->>'id')::uuid;

  v_att := public.create_attachment(
    p_experiment_id := v_exp,
    p_original_filename := 'test.pdf',
    p_display_name := 'Test PDF',
    p_storage_path := v_ws || '/' || v_exp || '/test.pdf',
    p_mime_type := 'application/pdf',
    p_file_size := 1024,
    p_checksum := repeat('a', 64)
  );

  v_rep := public.replace_attachment(
    p_attachment_id := (v_att->>'attachment_id')::uuid,
    p_storage_path := v_ws || '/' || v_exp || '/test_v2.pdf',
    p_file_size := 2048,
    p_checksum := repeat('b', 64),
    p_original_filename := 'test_v2.pdf',
    p_display_name := 'Test PDF v2',
    p_mime_type := 'application/pdf'
  );

  v_ep := public.attach_protocol_to_experiment(v_exp, v_pv);

  PERFORM public.upsert_protocol_deviation(
    p_experiment_protocol_id := (v_ep->>'experiment_protocol_id')::uuid,
    p_step_index := 0,
    p_actual_value := 'Mixed for 10 min instead',
    p_reason := 'Sample was viscous'
  );

  PERFORM set_config('test.uid', v_uid::text, true);
  PERFORM set_config('test.exp_id', v_exp::text, true);
  PERFORM set_config('test.att_id', v_att->>'attachment_id', true);
  PERFORM set_config('test.av1_id', v_att->>'attachment_version_id', true);
  PERFORM set_config('test.av2_id', v_rep->>'attachment_version_id', true);
  PERFORM set_config('test.ep_id', v_ep->>'experiment_protocol_id', true);
  PERFORM set_config('test.prt_id', v_prt::text, true);
  PERFORM set_config('test.pv_id', v_pv::text, true);
END $$;

-- ── 1. Attachment version v1 exists ──────────────────────────────
SELECT ok(
  EXISTS (SELECT 1 FROM public.attachment_versions WHERE id = current_setting('test.av1_id')::uuid),
  'Attachment version v1 created'
);

-- ── 2. Attachment version v2 exists with correct source ──────────
SELECT ok(
  EXISTS (
    SELECT 1 FROM public.attachment_versions
    WHERE id = current_setting('test.av2_id')::uuid
      AND source_attachment_version_id = current_setting('test.av1_id')::uuid
  ),
  'Attachment version v2 tracks source version'
);

-- ── 3. Attachment v2 has correct checksum ────────────────────────
SELECT is(
  (SELECT checksum FROM public.attachment_versions WHERE id = current_setting('test.av2_id')::uuid),
  repeat('b', 64),
  'Attachment v2 checksum matches'
);

-- ── 4. Immutability trigger blocks UPDATE on attachment_versions ─
-- Runs with RLS bypassed so the trigger itself is what rejects the write.
DO $$ BEGIN PERFORM set_config('role', 'postgres', true); END $$;

SELECT throws_ok(
  $$ UPDATE public.attachment_versions SET file_size = 9999
     WHERE id = current_setting('test.av1_id')::uuid $$,
  'P0001',
  'attachment_versions rows are immutable and cannot be updated',
  'Attachment version immutability trigger blocks UPDATE'
);

DO $$ BEGIN PERFORM set_config('role', 'authenticated', true); END $$;

-- ── 5. Experiment protocol instance created ──────────────────────
SELECT ok(
  EXISTS (
    SELECT 1 FROM public.experiment_protocols
    WHERE id = current_setting('test.ep_id')::uuid
      AND experiment_id = current_setting('test.exp_id')::uuid
  ),
  'Experiment protocol instance created'
);

-- ── 6. Protocol deviation recorded ───────────────────────────────
SELECT ok(
  EXISTS (
    SELECT 1 FROM public.protocol_deviations
    WHERE experiment_protocol_id = current_setting('test.ep_id')::uuid
      AND step_index = 0
      AND actual_value = 'Mixed for 10 min instead'
  ),
  'Protocol deviation recorded with correct values'
);

-- ── 7. Deviation has server-derived original_value ───────────────
SELECT is(
  (SELECT original_value FROM public.protocol_deviations
   WHERE experiment_protocol_id = current_setting('test.ep_id')::uuid AND step_index = 0),
  'Mix reagents',
  'Deviation original_value derived from protocol step instruction'
);

-- ── 8. Duplicate experiment created ──────────────────────────────
DO $$
DECLARE
  v_exp uuid := current_setting('test.exp_id')::uuid;
  v_dup jsonb;
BEGIN
  PERFORM public.insert_experiment_block(
    v_exp,
    'attachment',
    jsonb_build_object(
      'attachmentId', current_setting('test.att_id'),
      'attachmentVersionId', current_setting('test.av2_id'),
      'checksum', repeat('b', 64),
      'filename', 'test_v2.pdf',
      'displayName', 'Test PDF v2',
      'fileSize', 2048,
      'mimeType', 'application/pdf'
    ),
    'a0'
  );

  PERFORM public.insert_experiment_block(
    v_exp,
    'protocol',
    jsonb_build_object(
      'protocol_id', current_setting('test.prt_id'),
      'protocol_version_id', current_setting('test.pv_id'),
      'experiment_protocol_id', current_setting('test.ep_id'),
      'protocol_name', 'Sample Protocol',
      'version_number', 1
    ),
    'a1'
  );

  v_dup := public.duplicate_experiment_rpc(v_exp);
  PERFORM set_config('test.dup_id', coalesce(v_dup->>'id', ''), true);
END $$;

SELECT isnt(
  nullif(current_setting('test.dup_id'), ''),
  NULL,
  'Duplicate experiment created'
);

-- ── 9. Duplicate has its own attachment records (COW) ────────────
SELECT ok(
  EXISTS (
    SELECT 1 FROM public.attachments
    WHERE experiment_id = nullif(current_setting('test.dup_id'), '')::uuid
      AND id <> current_setting('test.att_id')::uuid
  ),
  'Duplicate experiment has COW attachment records'
);

-- ── 10. Duplicate experiment has an initial revision ─────────────
SELECT ok(
  EXISTS (
    SELECT 1 FROM public.experiment_revisions
    WHERE experiment_id = nullif(current_setting('test.dup_id'), '')::uuid
      AND revision_number = 1
  ),
  'Duplicate experiment has initial revision'
);

-- ── 11. Duplicate protocol instances are separate ────────────────
SELECT ok(
  EXISTS (
    SELECT 1 FROM public.experiment_protocols
    WHERE experiment_id = nullif(current_setting('test.dup_id'), '')::uuid
      AND id <> current_setting('test.ep_id')::uuid
  ),
  'Duplicate experiment has COW protocol instances'
);

-- ── 12. Checksum format validated (64 hex chars) ─────────────────
SELECT throws_ok(
  $$ SELECT public.create_attachment(
    p_experiment_id := current_setting('test.exp_id')::uuid,
    p_original_filename := 'bad.pdf',
    p_display_name := 'Bad',
    p_storage_path := 'bad/checksum.pdf',
    p_mime_type := 'application/pdf',
    p_file_size := 100,
    p_checksum := 'too-short'
  ) $$,
  'P0001',
  'Invalid SHA-256 checksum format',
  'Invalid checksum format rejected by create_attachment'
);

-- ── 13. Deviation unique constraint (upsert doesn't duplicate) ───
SELECT lives_ok(
  $$ SELECT public.upsert_protocol_deviation(
    p_experiment_protocol_id := current_setting('test.ep_id')::uuid,
    p_step_index := 0,
    p_actual_value := 'Mixed for 15 min now',
    p_reason := 'Updated reason'
  ) $$,
  'Upserting the same deviation step succeeds'
);

SELECT is(
  (SELECT count(*)::int FROM public.protocol_deviations
   WHERE experiment_protocol_id = current_setting('test.ep_id')::uuid AND step_index = 0),
  1,
  'Upsert deviation replaces existing (no duplicates)'
);

-- ── 14. Delete deviation works ───────────────────────────────────
SELECT lives_ok(
  $$ SELECT public.delete_protocol_deviation(
    p_experiment_protocol_id := current_setting('test.ep_id')::uuid,
    p_step_index := 0
  ) $$,
  'Deleting a deviation succeeds'
);

SELECT ok(
  NOT EXISTS (
    SELECT 1 FROM public.protocol_deviations
    WHERE experiment_protocol_id = current_setting('test.ep_id')::uuid AND step_index = 0
  ),
  'Delete deviation removes the record'
);

SELECT * FROM finish();
ROLLBACK;
