-- 06_comment_tests.sql: add_comment_with_mentions RPC
BEGIN;
SELECT plan(6);

DO $$
DECLARE
  v_user_id uuid := gen_random_uuid();
  v_user2_id uuid := gen_random_uuid();
  v_outsider_id uuid := gen_random_uuid();
  v_ws_id uuid;
  v_nb_id uuid;
  v_exp_id uuid;
BEGIN
  -- Create users
  INSERT INTO auth.users (id, email, role, aud, instance_id) VALUES
    (v_user_id, 'comment1@test.com', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
    (v_user2_id, 'comment2@test.com', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
    (v_outsider_id, 'outsider@test.com', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000');
  INSERT INTO public.profiles (id, email, display_name) VALUES
    (v_user_id, 'comment1@test.com', 'Commenter 1'),
    (v_user2_id, 'comment2@test.com', 'Commenter 2'),
    (v_outsider_id, 'outsider@test.com', 'Outsider');

  -- Workspace + members (outsider is NOT a member)
  INSERT INTO public.workspaces (id, name, created_by) VALUES (gen_random_uuid(), 'Comment WS', v_user_id)
  RETURNING id INTO v_ws_id;
  INSERT INTO public.workspace_members (workspace_id, user_id, role) VALUES
    (v_ws_id, v_user_id, 'owner'),
    (v_ws_id, v_user2_id, 'member');

  INSERT INTO public.notebooks (id, workspace_id, name, created_by) VALUES (gen_random_uuid(), v_ws_id, 'Comment NB', v_user_id)
  RETURNING id INTO v_nb_id;

  INSERT INTO public.experiments (id, workspace_id, notebook_id, title, created_by)
  VALUES (gen_random_uuid(), v_ws_id, v_nb_id, 'Comment Exp', v_user_id)
  RETURNING id INTO v_exp_id;

  PERFORM set_config('test.user_id', v_user_id::text, true);
  PERFORM set_config('test.user2_id', v_user2_id::text, true);
  PERFORM set_config('test.outsider_id', v_outsider_id::text, true);
  PERFORM set_config('test.experiment_id', v_exp_id::text, true);
END $$;

-- Test 1: Create thread + comment
DO $$
DECLARE
  v_result jsonb;
BEGIN
  PERFORM set_config('request.jwt.claims', jsonb_build_object(
    'sub', current_setting('test.user_id'),
    'role', 'authenticated'
  )::text, true);
  PERFORM set_config('role', 'authenticated', true);

  v_result := public.add_comment_with_mentions(
    current_setting('test.experiment_id')::uuid,
    NULL,
    'First comment',
    ARRAY[current_setting('test.user2_id')::uuid]
  );

  IF NOT (v_result ? 'thread_id') THEN RAISE EXCEPTION 'Missing thread_id'; END IF;
  IF NOT (v_result ? 'comment_id') THEN RAISE EXCEPTION 'Missing comment_id'; END IF;

  PERFORM set_config('test.thread_id', v_result->>'thread_id', true);
  PERFORM set_config('test.comment_id', v_result->>'comment_id', true);
END $$;
SELECT pass('Comment creates thread + comment');

-- Test 2: Mention rows created
SELECT ok(
  EXISTS (
    SELECT 1 FROM public.mentions
    WHERE comment_id = current_setting('test.comment_id')::uuid
    AND user_id = current_setting('test.user2_id')::uuid
  ),
  'Mention row created for user2'
);

-- Test 3: Notification created for mentioned user
SELECT ok(
  EXISTS (
    SELECT 1 FROM public.notifications
    WHERE user_id = current_setting('test.user2_id')::uuid
    AND type = 'mention'
    AND experiment_id = current_setting('test.experiment_id')::uuid
  ),
  'Mention notification created'
);

-- Test 4: Duplicate mention IDs are deduplicated
DO $$
DECLARE
  v_result jsonb;
  v_mention_count int;
BEGIN
  PERFORM set_config('request.jwt.claims', jsonb_build_object(
    'sub', current_setting('test.user_id'),
    'role', 'authenticated'
  )::text, true);
  PERFORM set_config('role', 'authenticated', true);

  v_result := public.add_comment_with_mentions(
    current_setting('test.experiment_id')::uuid,
    current_setting('test.thread_id')::uuid,
    'Dedup test',
    ARRAY[
      current_setting('test.user2_id')::uuid,
      current_setting('test.user2_id')::uuid
    ]
  );

  SELECT count(*) INTO v_mention_count FROM public.mentions
  WHERE comment_id = (v_result->>'comment_id')::uuid;

  IF v_mention_count != 1 THEN
    RAISE EXCEPTION 'Expected 1 mention, got %', v_mention_count;
  END IF;
END $$;
SELECT pass('Duplicate mention IDs deduplicated');

-- Test 5: Outsider mention skipped (not a workspace member)
DO $$
DECLARE
  v_result jsonb;
  v_mention_count int;
BEGIN
  PERFORM set_config('request.jwt.claims', jsonb_build_object(
    'sub', current_setting('test.user_id'),
    'role', 'authenticated'
  )::text, true);
  PERFORM set_config('role', 'authenticated', true);

  v_result := public.add_comment_with_mentions(
    current_setting('test.experiment_id')::uuid,
    current_setting('test.thread_id')::uuid,
    'Outsider test',
    ARRAY[current_setting('test.outsider_id')::uuid]
  );

  SELECT count(*) INTO v_mention_count FROM public.mentions
  WHERE comment_id = (v_result->>'comment_id')::uuid;

  IF v_mention_count != 0 THEN
    RAISE EXCEPTION 'Outsider should not get mention row, got %', v_mention_count;
  END IF;
END $$;
SELECT pass('Outsider mention silently skipped');

-- Test 6: Non-member cannot comment
DO $$
BEGIN
  PERFORM set_config('request.jwt.claims', jsonb_build_object(
    'sub', current_setting('test.outsider_id'),
    'role', 'authenticated'
  )::text, true);
  PERFORM set_config('role', 'authenticated', true);
END $$;

SELECT throws_ok(
  $$ SELECT public.add_comment_with_mentions(
    current_setting('test.experiment_id')::uuid,
    NULL,
    'Should fail',
    '{}'::uuid[]
  ) $$,
  NULL,
  'Not a workspace member',
  'Non-member cannot add comment'
);

SELECT * FROM finish();
ROLLBACK;
