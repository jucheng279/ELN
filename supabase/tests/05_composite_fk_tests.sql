-- =============================================================
-- 05_composite_fk_tests.sql — Cross-experiment FK integrity
-- Self-contained fixtures
-- =============================================================
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(2);

DO $$
DECLARE
  v_owner uuid := 'a0000000-0000-0000-0000-000000000001';
  v_ws    uuid := 'b0000000-0000-0000-0000-000000000001';
  v_nb    uuid := 'c0000000-0000-0000-0000-000000000001';
  v_exp_a uuid := 'd0000000-0000-0000-0000-00000000000a';
  v_exp_b uuid := 'd0000000-0000-0000-0000-00000000000b';
  v_rev_a uuid := 'f0000000-0000-0000-0000-00000000000a';
  v_rev_b uuid := 'f0000000-0000-0000-0000-00000000000b';
BEGIN
  INSERT INTO auth.users (id, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, aud, role)
  VALUES (v_owner, 'owner@fk.test', crypt('pw', gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, 'authenticated', 'authenticated')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.workspaces (id, name, created_by) VALUES (v_ws, 'FK Workspace', v_owner) ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.notebooks (id, workspace_id, name, created_by) VALUES (v_nb, v_ws, 'FK Notebook', v_owner) ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.experiments (id, workspace_id, notebook_id, title, status, is_locked, is_archived, created_by)
  VALUES (v_exp_a, v_ws, v_nb, 'Exp A', 'draft', false, false, v_owner) ON CONFLICT (id) DO NOTHING;
  INSERT INTO public.experiments (id, workspace_id, notebook_id, title, status, is_locked, is_archived, created_by)
  VALUES (v_exp_b, v_ws, v_nb, 'Exp B', 'draft', false, false, v_owner) ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.experiment_revisions (id, experiment_id, revision_number, snapshot, content_hash, change_summary, change_type, created_by)
  VALUES (v_rev_a, v_exp_a, 1, '{}'::jsonb, 'hash_a', 'Init', 'checkpoint', v_owner) ON CONFLICT DO NOTHING;
  INSERT INTO public.experiment_revisions (id, experiment_id, revision_number, snapshot, content_hash, change_summary, change_type, created_by)
  VALUES (v_rev_b, v_exp_b, 1, '{}'::jsonb, 'hash_b', 'Init', 'checkpoint', v_owner) ON CONFLICT DO NOTHING;
END;
$$;

-- Test 1: Review with revision from different experiment
SELECT throws_ok(
  $$ INSERT INTO public.reviews (experiment_id, reviewer_id, revision_number, experiment_revision_id, status, comment)
     VALUES ('d0000000-0000-0000-0000-00000000000b', 'a0000000-0000-0000-0000-000000000001', 1,
             'f0000000-0000-0000-0000-00000000000a', 'pending', 'cross') $$,
  '23503', NULL, 'review with cross-experiment revision rejected'
);

-- Test 2: Signature with revision from different experiment
SELECT throws_ok(
  $$ INSERT INTO public.signatures (experiment_id, signer_id, revision_number, experiment_revision_id, content_hash, declaration)
     VALUES ('d0000000-0000-0000-0000-00000000000b', 'a0000000-0000-0000-0000-000000000001', 1,
             'f0000000-0000-0000-0000-00000000000a', 'hash_x', 'I declare') $$,
  '23503', NULL, 'signature with cross-experiment revision rejected'
);

SELECT * FROM finish();
ROLLBACK;
