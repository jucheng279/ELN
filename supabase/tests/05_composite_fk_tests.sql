-- 05_composite_fk_tests.sql: cross-experiment FK integrity for reviews + signatures
BEGIN;
SELECT plan(2);

DO $$
DECLARE
  v_user_id uuid := gen_random_uuid();
  v_ws_id uuid;
  v_nb_id uuid;
  v_exp1_id uuid;
  v_exp2_id uuid;
  v_rev1_id uuid;
BEGIN
  INSERT INTO auth.users (id, email, role, aud, instance_id)
  VALUES (v_user_id, 'fk@test.com', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000');
  INSERT INTO public.profiles (id, email, display_name) VALUES (v_user_id, 'fk@test.com', 'FK Tester');

  INSERT INTO public.workspaces (id, name, created_by) VALUES (gen_random_uuid(), 'FK WS', v_user_id)
  RETURNING id INTO v_ws_id;
  INSERT INTO public.workspace_members (workspace_id, user_id, role) VALUES (v_ws_id, v_user_id, 'owner');

  INSERT INTO public.notebooks (id, workspace_id, name, created_by) VALUES (gen_random_uuid(), v_ws_id, 'FK NB', v_user_id)
  RETURNING id INTO v_nb_id;

  INSERT INTO public.experiments (id, workspace_id, notebook_id, title, created_by, experiment_id)
  VALUES (gen_random_uuid(), v_ws_id, v_nb_id, 'Exp1', v_user_id, 'FK-001') RETURNING id INTO v_exp1_id;
  INSERT INTO public.experiments (id, workspace_id, notebook_id, title, created_by, experiment_id)
  VALUES (gen_random_uuid(), v_ws_id, v_nb_id, 'Exp2', v_user_id, 'FK-002') RETURNING id INTO v_exp2_id;

  INSERT INTO public.experiment_revisions (id, experiment_id, revision_number, change_type, created_by)
  VALUES (gen_random_uuid(), v_exp1_id, 1, 'created', v_user_id) RETURNING id INTO v_rev1_id;

  PERFORM set_config('test.user_id', v_user_id::text, true);
  PERFORM set_config('test.exp1_id', v_exp1_id::text, true);
  PERFORM set_config('test.exp2_id', v_exp2_id::text, true);
  PERFORM set_config('test.rev1_id', v_rev1_id::text, true);
END $$;

-- Cross-experiment review: revision belongs to exp1, but review claims exp2
SELECT throws_ok(
  $$ INSERT INTO public.reviews (experiment_id, reviewer_id, revision_number, experiment_revision_id, status)
     VALUES (
       current_setting('test.exp2_id')::uuid,
       current_setting('test.user_id')::uuid,
       1,
       current_setting('test.rev1_id')::uuid,
       'pending'
     ) $$,
  '23503',
  NULL,
  'Cross-experiment review FK violation caught'
);

-- Cross-experiment signature: revision belongs to exp1, but signature claims exp2
SELECT throws_ok(
  $$ INSERT INTO public.signatures (experiment_id, signer_id, revision_number, experiment_revision_id, content_hash)
     VALUES (
       current_setting('test.exp2_id')::uuid,
       current_setting('test.user_id')::uuid,
       1,
       current_setting('test.rev1_id')::uuid,
       'fakehash'
     ) $$,
  '23503',
  NULL,
  'Cross-experiment signature FK violation caught'
);

SELECT * FROM finish();
ROLLBACK;
