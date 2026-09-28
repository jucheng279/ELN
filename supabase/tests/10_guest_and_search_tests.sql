BEGIN;
SELECT plan(6);

-- ============================================================
-- Test 1: Guest comment denial in add_comment_with_mentions
-- ============================================================

-- Setup: create workspace, two users (admin + guest), and an experiment
SELECT lives_ok($$
  DO $setup$
  DECLARE
    v_ws_id uuid;
    v_admin_id uuid := gen_random_uuid();
    v_guest_id uuid := gen_random_uuid();
    v_nb_id uuid;
    v_exp_id uuid;
  BEGIN
    -- Create test users in auth.users
    INSERT INTO auth.users (id, email, role, instance_id)
    VALUES
      (v_admin_id, 'admin_comment_test@test.com', 'authenticated', '00000000-0000-0000-0000-000000000000'),
      (v_guest_id, 'guest_comment_test@test.com', 'authenticated', '00000000-0000-0000-0000-000000000000')
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.profiles (id, display_name, email)
    VALUES
      (v_admin_id, 'Admin CT', 'admin_comment_test@test.com'),
      (v_guest_id, 'Guest CT', 'guest_comment_test@test.com')
    ON CONFLICT (id) DO NOTHING;

    -- Create workspace with admin
    INSERT INTO public.workspaces (name, created_by)
    VALUES ('Comment Test WS', v_admin_id)
    RETURNING id INTO v_ws_id;

    -- Add members: admin + guest
    INSERT INTO public.workspace_members (workspace_id, user_id, role)
    VALUES
      (v_ws_id, v_admin_id, 'admin'),
      (v_ws_id, v_guest_id, 'guest')
    ON CONFLICT DO NOTHING;

    -- Create notebook + experiment
    INSERT INTO public.notebooks (workspace_id, name, created_by)
    VALUES (v_ws_id, 'CT Notebook', v_admin_id)
    RETURNING id INTO v_nb_id;

    INSERT INTO public.experiments (workspace_id, notebook_id, title, created_by)
    VALUES (v_ws_id, v_nb_id, 'Comment Test Experiment', v_admin_id)
    RETURNING id INTO v_exp_id;

    -- Store IDs for subsequent tests
    PERFORM set_config('test.ct_ws_id', v_ws_id::text, true);
    PERFORM set_config('test.ct_admin_id', v_admin_id::text, true);
    PERFORM set_config('test.ct_guest_id', v_guest_id::text, true);
    PERFORM set_config('test.ct_exp_id', v_exp_id::text, true);
  END $setup$;
$$, 'Setup: workspace with admin and guest members');

-- Test 2: Admin can create a comment
SELECT lives_ok($$
  SELECT set_config('request.jwt.claims', jsonb_build_object(
    'sub', current_setting('test.ct_admin_id'),
    'role', 'authenticated'
  )::text, true);
  SELECT set_config('role', 'authenticated', true);

  SELECT public.add_comment_with_mentions(
    current_setting('test.ct_exp_id')::uuid,
    NULL,
    'Admin comment',
    '{}'::uuid[]
  );
$$, 'Admin can create a comment');

-- Test 3: Guest is denied comment creation
SELECT throws_ok($$
  SELECT set_config('request.jwt.claims', jsonb_build_object(
    'sub', current_setting('test.ct_guest_id'),
    'role', 'authenticated'
  )::text, true);
  SELECT set_config('role', 'authenticated', true);

  SELECT public.add_comment_with_mentions(
    current_setting('test.ct_exp_id')::uuid,
    NULL,
    'Guest should not post',
    '{}'::uuid[]
  );
$$, 'Guests cannot create comments', 'Guest is denied comment creation');

-- ============================================================
-- Test 4-6: Search input validation
-- ============================================================

-- Reset to admin for search tests
SELECT lives_ok($$
  SELECT set_config('request.jwt.claims', jsonb_build_object(
    'sub', current_setting('test.ct_admin_id'),
    'role', 'authenticated'
  )::text, true);
  SELECT set_config('role', 'authenticated', true);

  -- page_size > 100 should be clamped to 100
  SELECT public.search_experiments(
    current_setting('test.ct_ws_id')::uuid,
    NULL, NULL, NULL, NULL, NULL, NULL, NULL,
    'relevance', 1, 999
  );
$$, 'Search clamps oversized page_size without error');

SELECT lives_ok($$
  SELECT set_config('request.jwt.claims', jsonb_build_object(
    'sub', current_setting('test.ct_admin_id'),
    'role', 'authenticated'
  )::text, true);
  SELECT set_config('role', 'authenticated', true);

  -- page < 1 should be clamped to 1
  SELECT public.search_experiments(
    current_setting('test.ct_ws_id')::uuid,
    NULL, NULL, NULL, NULL, NULL, NULL, NULL,
    'relevance', -5, 25
  );
$$, 'Search clamps negative page without error');

SELECT lives_ok($$
  SELECT set_config('request.jwt.claims', jsonb_build_object(
    'sub', current_setting('test.ct_admin_id'),
    'role', 'authenticated'
  )::text, true);
  SELECT set_config('role', 'authenticated', true);

  -- Invalid sort_by should fall back to relevance
  SELECT public.search_experiments(
    current_setting('test.ct_ws_id')::uuid,
    NULL, NULL, NULL, NULL, NULL, NULL, NULL,
    'invalid_sort', 1, 25
  );
$$, 'Search normalizes invalid sort_by without error');

SELECT * FROM finish();
ROLLBACK;
