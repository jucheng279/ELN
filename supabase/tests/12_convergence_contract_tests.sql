-- 12_convergence_contract_tests.sql: contracts the editor's save/conflict flow relies on:
-- metadata optimistic concurrency (PT409), comment resolve guards, RPC-only comment writes,
-- invitation guards, tag tenant boundary, and revision hash integrity.
BEGIN;
SELECT plan(17);

-- ── Setup ─────────────────────────────────────────────────────────
DO $$
DECLARE
  v_owner  uuid := gen_random_uuid();
  v_admin  uuid := gen_random_uuid();
  v_member uuid := gen_random_uuid();
  v_guest  uuid := gen_random_uuid();
  v_ws     uuid;
  v_ws2    uuid;
  v_nb     uuid;
  v_tag2   uuid;
  v_exp1   uuid;
  v_exp2   uuid;
BEGIN
  INSERT INTO auth.users (id, email, role, aud, instance_id, raw_user_meta_data)
  VALUES
    (v_owner, 'conv-owner@test.com', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', jsonb_build_object('display_name', 'Owner')),
    (v_admin, 'conv-admin@test.com', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', jsonb_build_object('display_name', 'Admin')),
    (v_member, 'conv-member@test.com', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', jsonb_build_object('display_name', 'Member')),
    (v_guest, 'conv-guest@test.com', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000', jsonb_build_object('display_name', 'Guest'));

  INSERT INTO public.workspaces (id, name, created_by) VALUES (gen_random_uuid(), 'Conv WS', v_owner)
  RETURNING id INTO v_ws;
  INSERT INTO public.workspaces (id, name, created_by) VALUES (gen_random_uuid(), 'Conv Other WS', v_owner)
  RETURNING id INTO v_ws2;

  INSERT INTO public.workspace_members (workspace_id, user_id, role) VALUES
    (v_ws, v_admin, 'admin'),
    (v_ws, v_member, 'member'),
    (v_ws, v_guest, 'guest');

  INSERT INTO public.notebooks (id, workspace_id, name, created_by) VALUES (gen_random_uuid(), v_ws, 'Conv NB', v_owner)
  RETURNING id INTO v_nb;

  INSERT INTO public.tags (id, workspace_id, name) VALUES (gen_random_uuid(), v_ws2, 'foreign-tag')
  RETURNING id INTO v_tag2;

  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);

  v_exp1 := (public.create_experiment_rpc(v_ws, v_nb, 'Convergence One')->>'id')::uuid;
  v_exp2 := (public.create_experiment_rpc(v_ws, v_nb, 'Convergence Two')->>'id')::uuid;

  PERFORM set_config('test.owner', v_owner::text, true);
  PERFORM set_config('test.admin', v_admin::text, true);
  PERFORM set_config('test.member', v_member::text, true);
  PERFORM set_config('test.guest', v_guest::text, true);
  PERFORM set_config('test.ws', v_ws::text, true);
  PERFORM set_config('test.tag2', v_tag2::text, true);
  PERFORM set_config('test.exp1', v_exp1::text, true);
  PERFORM set_config('test.exp2', v_exp2::text, true);
  PERFORM set_config('test.thread1',
    public.add_comment_with_mentions(v_exp1, NULL, 'First thread')->>'thread_id', true);
  PERFORM set_config('test.thread2',
    public.add_comment_with_mentions(v_exp2, NULL, 'Second thread')->>'thread_id', true);
END $$;

-- ── update_experiment_metadata: optimistic concurrency ───────────
DO $$
DECLARE
  v_before bigint;
  v_result jsonb;
BEGIN
  SELECT metadata_version INTO v_before FROM public.experiments WHERE id = current_setting('test.exp1')::uuid;
  v_result := public.update_experiment_metadata(
    current_setting('test.exp1')::uuid, v_before, 'Renamed', NULL, NULL, NULL, false
  );
  PERFORM set_config('test.mv_before', v_before::text, true);
  PERFORM set_config('test.mv_after', v_result->>'metadata_version', true);
  PERFORM set_config('test.title_after', v_result->>'title', true);
END $$;

-- 1
SELECT is(
  current_setting('test.mv_after')::bigint,
  current_setting('test.mv_before')::bigint + 1,
  'Successful metadata update returns an incremented metadata_version'
);

-- 2
SELECT is(
  (SELECT metadata_version FROM public.experiments WHERE id = current_setting('test.exp1')::uuid),
  current_setting('test.mv_after')::bigint,
  'Stored metadata_version matches the returned version'
);

-- 3
SELECT is(current_setting('test.title_after'), 'Renamed', 'Metadata update returns the saved title');

-- 4
SELECT throws_ok(
  $$ SELECT public.update_experiment_metadata(
    current_setting('test.exp1')::uuid,
    current_setting('test.mv_before')::bigint,
    'Stale rename', NULL, NULL, NULL, false
  ) $$,
  'PT409',
  format('Experiment metadata was changed by someone else (expected version %s, current %s)',
    current_setting('test.mv_before'), current_setting('test.mv_after')),
  'Stale expected version raises PT409'
);

-- ── No legacy serialization_failure code in public functions ─────
-- 5
SELECT is(
  (SELECT count(*)::int
   FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.prosrc LIKE '%40001%'
     AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')),
  0,
  'No public function body references SQLSTATE 40001'
);

-- ── set_comment_thread_resolved ──────────────────────────────────
DO $$ BEGIN
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', current_setting('test.guest'), 'role', 'authenticated')::text, true);
END $$;

-- 6
SELECT throws_ok(
  $$ SELECT public.set_comment_thread_resolved(
    current_setting('test.exp1')::uuid, current_setting('test.thread1')::uuid, true) $$,
  NULL,
  'Guests cannot resolve comments',
  'Guest cannot resolve a comment thread'
);

DO $$ BEGIN
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', current_setting('test.owner'), 'role', 'authenticated')::text, true);
END $$;

-- 7
SELECT throws_ok(
  $$ SELECT public.set_comment_thread_resolved(
    current_setting('test.exp1')::uuid, current_setting('test.thread2')::uuid, true) $$,
  NULL,
  'Thread not found',
  'Thread from another experiment is rejected'
);

-- 8
SELECT is(
  public.set_comment_thread_resolved(
    current_setting('test.exp1')::uuid, current_setting('test.thread1')::uuid, true)->>'changed',
  'true',
  'First resolve changes the thread'
);

-- 9
SELECT is(
  public.set_comment_thread_resolved(
    current_setting('test.exp1')::uuid, current_setting('test.thread1')::uuid, true)->>'changed',
  'false',
  'Resolving again is an idempotent no-op'
);

-- ── Direct comment writes are denied ─────────────────────────────
-- 10
SELECT throws_ok(
  $$ INSERT INTO public.comments (thread_id, content)
     VALUES (current_setting('test.thread1')::uuid, 'direct write') $$,
  '42501',
  NULL,
  'Authenticated users cannot INSERT into comments directly'
);

-- 11
SELECT throws_ok(
  $$ INSERT INTO public.comment_threads (experiment_id)
     VALUES (current_setting('test.exp1')::uuid) $$,
  '42501',
  NULL,
  'Authenticated users cannot INSERT into comment_threads directly'
);

-- ── create_workspace_invitation ──────────────────────────────────
DO $$ BEGIN
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', current_setting('test.member'), 'role', 'authenticated')::text, true);
END $$;

-- 12
SELECT throws_ok(
  $$ SELECT public.create_workspace_invitation(current_setting('test.ws')::uuid, 'new@test.com', 'member') $$,
  NULL,
  'Only workspace owners or admins can invite members',
  'Member cannot create invitations'
);

DO $$ BEGIN
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', current_setting('test.admin'), 'role', 'authenticated')::text, true);
END $$;

-- 13
SELECT throws_ok(
  $$ SELECT public.create_workspace_invitation(current_setting('test.ws')::uuid, 'new@test.com', 'owner') $$,
  NULL,
  'Invalid role: owner',
  'Admin cannot invite with the owner role'
);

-- 14
SELECT throws_ok(
  $$ SELECT public.create_workspace_invitation(current_setting('test.ws')::uuid, 'not-an-email', 'member') $$,
  NULL,
  'Invalid email address',
  'Invalid invitation email is rejected'
);

-- ── Tag tenant boundary ──────────────────────────────────────────
DO $$ BEGIN
  PERFORM set_config('request.jwt.claims', jsonb_build_object('sub', current_setting('test.owner'), 'role', 'authenticated')::text, true);
END $$;

-- 15
SELECT throws_ok(
  $$ INSERT INTO public.experiment_tags (experiment_id, tag_id)
     VALUES (current_setting('test.exp1')::uuid, current_setting('test.tag2')::uuid) $$,
  '23514',
  'Tag belongs to a different workspace than the experiment',
  'Tagging with a tag from another workspace is rejected'
);

-- ── Revision hash integrity ──────────────────────────────────────
DO $$ BEGIN
  PERFORM set_config('test.rev_id',
    public.create_checkpoint(current_setting('test.exp1')::uuid, 'Contract checkpoint')->>'revision_id', true);
END $$;

-- 16
SELECT is(
  (SELECT r.content_hash FROM public.experiment_revisions r WHERE r.id = current_setting('test.rev_id')::uuid),
  (SELECT public.canonical_snapshot_hash(r.snapshot) FROM public.experiment_revisions r WHERE r.id = current_setting('test.rev_id')::uuid),
  'Checkpoint content_hash equals canonical_snapshot_hash(snapshot)'
);

-- 17
SELECT is(
  public.verify_experiment_revision(current_setting('test.rev_id')::uuid)->>'integrity_ok',
  'true',
  'verify_experiment_revision reports integrity_ok for the checkpoint'
);

SELECT * FROM finish();
ROLLBACK;
