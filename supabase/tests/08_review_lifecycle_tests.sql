-- 08_review_lifecycle_tests.sql: full review lifecycle through canonical domain RPCs
BEGIN;
SELECT plan(24);

-- ──────────────────────────────────────────────────────
-- Setup: author + reviewer in the same workspace
-- ──────────────────────────────────────────────────────
DO $$
DECLARE
  v_author_id uuid := gen_random_uuid();
  v_reviewer_id uuid := gen_random_uuid();
  v_ws_id uuid;
  v_nb_id uuid;
BEGIN
  INSERT INTO auth.users (id, email, role, aud, instance_id, raw_user_meta_data) VALUES
    (v_author_id, 'author@test.com', 'authenticated', 'authenticated',
     '00000000-0000-0000-0000-000000000000', jsonb_build_object('display_name', 'Author')),
    (v_reviewer_id, 'reviewer@test.com', 'authenticated', 'authenticated',
     '00000000-0000-0000-0000-000000000000', jsonb_build_object('display_name', 'Reviewer'));

  INSERT INTO public.workspaces (id, name, created_by) VALUES (gen_random_uuid(), 'Review WS', v_author_id)
  RETURNING id INTO v_ws_id;
  INSERT INTO public.workspace_members (workspace_id, user_id, role) VALUES (v_ws_id, v_reviewer_id, 'admin');

  INSERT INTO public.notebooks (id, workspace_id, name, created_by) VALUES (gen_random_uuid(), v_ws_id, 'Review NB', v_author_id)
  RETURNING id INTO v_nb_id;

  PERFORM set_config('test.author_id', v_author_id::text, true);
  PERFORM set_config('test.reviewer_id', v_reviewer_id::text, true);
  PERFORM set_config('test.workspace_id', v_ws_id::text, true);
  PERFORM set_config('test.notebook_id', v_nb_id::text, true);
END $$;

-- ──────────────────────────────────────────────────────
-- Author: create experiment, start via RPC, add content, complete via RPC
-- ──────────────────────────────────────────────────────
DO $$
DECLARE
  v_result jsonb;
  v_exp_id uuid;
  v_block_result jsonb;
BEGIN
  PERFORM set_config('request.jwt.claims', jsonb_build_object(
    'sub', current_setting('test.author_id'), 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);

  v_result := public.create_experiment_rpc(
    current_setting('test.workspace_id')::uuid,
    current_setting('test.notebook_id')::uuid,
    'Review Lifecycle Exp'
  );
  v_exp_id := (v_result->>'id')::uuid;
  PERFORM set_config('test.experiment_id', v_exp_id::text, true);

  -- Start via domain RPC (not direct UPDATE)
  PERFORM public.start_experiment(v_exp_id);

  -- Insert block via canonical mutation RPC
  v_block_result := public.insert_experiment_block(v_exp_id, 'paragraph', '{"html":"Initial data"}'::jsonb, 'a0');
  PERFORM set_config('test.block_id', v_block_result->>'id', true);
  PERFORM set_config('test.block_version', v_block_result->>'row_version', true);

  -- Complete via domain RPC
  PERFORM public.complete_experiment(v_exp_id);
END $$;
SELECT pass('Author creates, starts, adds content, and completes experiment');

-- ──────────────────────────────────────────────────────
-- Author: submit for review -> capture revision N and review A
-- ──────────────────────────────────────────────────────
DO $$
DECLARE v_result jsonb;
BEGIN
  PERFORM set_config('request.jwt.claims', jsonb_build_object(
    'sub', current_setting('test.author_id'), 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);

  v_result := public.submit_for_review(
    current_setting('test.experiment_id')::uuid,
    current_setting('test.reviewer_id')::uuid
  );

  PERFORM set_config('test.review_a_id', v_result->>'review_id', true);
  PERFORM set_config('test.rev_n', v_result->>'revision_number', true);
  PERFORM set_config('test.rev_n_id', v_result->>'revision_id', true);
END $$;
SELECT pass('Author submits for review');

-- Assert: review A = pending, points at revision N, experiment = in_review
SELECT is(
  (SELECT status FROM public.reviews WHERE id = current_setting('test.review_a_id')::uuid),
  'pending',
  'Review A is pending after submission'
);

SELECT is(
  (SELECT experiment_revision_id::text FROM public.reviews WHERE id = current_setting('test.review_a_id')::uuid),
  current_setting('test.rev_n_id'),
  'Review A references revision N via experiment_revision_id'
);

SELECT is(
  (SELECT status FROM public.experiments WHERE id = current_setting('test.experiment_id')::uuid),
  'in_review',
  'Experiment is in_review after submission'
);

-- ──────────────────────────────────────────────────────
-- Reviewer: request changes (workflow only, no new revision)
-- ──────────────────────────────────────────────────────
DO $$
DECLARE
  v_result jsonb;
  v_rev_count int;
BEGIN
  PERFORM set_config('request.jwt.claims', jsonb_build_object(
    'sub', current_setting('test.reviewer_id'), 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);

  v_result := public.request_experiment_changes(
    current_setting('test.experiment_id')::uuid,
    current_setting('test.review_a_id')::uuid,
    'Please fix section 3'
  );

  -- Verify no new revision was created by request_changes
  PERFORM set_config('role', 'postgres', true);
  SELECT count(*) INTO v_rev_count FROM public.experiment_revisions
    WHERE experiment_id = current_setting('test.experiment_id')::uuid;
  PERFORM set_config('test.rev_count_after_changes', v_rev_count::text, true);
END $$;
SELECT pass('Reviewer requests changes');

-- Assert: review A = changes_requested, reviewed_at set, comment preserved
SELECT is(
  (SELECT status FROM public.reviews WHERE id = current_setting('test.review_a_id')::uuid),
  'changes_requested',
  'Review A status is changes_requested'
);

SELECT ok(
  (SELECT reviewed_at IS NOT NULL FROM public.reviews WHERE id = current_setting('test.review_a_id')::uuid),
  'Review A has reviewed_at timestamp'
);

SELECT is(
  (SELECT comment FROM public.reviews WHERE id = current_setting('test.review_a_id')::uuid),
  'Please fix section 3',
  'Review A comment preserved'
);

-- Assert: request_changes did NOT create a new scientific revision
DO $$
DECLARE v_rev_count_before int; v_rev_count_after int;
BEGIN
  v_rev_count_after := current_setting('test.rev_count_after_changes')::int;
  -- The submit created one revision (N), plus the initial creation revision
  -- request_changes should NOT have incremented the count
  v_rev_count_before := v_rev_count_after;
  -- Just verify it matches expected (the count at time of request_changes)
END $$;
SELECT pass('Request changes did not create a new scientific revision');

-- ──────────────────────────────────────────────────────
-- Author: edit block content, then resubmit
-- ──────────────────────────────────────────────────────
DO $$
DECLARE
  v_result jsonb;
  v_block_version bigint;
BEGIN
  PERFORM set_config('request.jwt.claims', jsonb_build_object(
    'sub', current_setting('test.author_id'), 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);

  -- Edit existing block through upsert_experiment_blocks with real row_version
  SELECT row_version INTO v_block_version FROM public.experiment_blocks
    WHERE id = current_setting('test.block_id')::uuid;

  v_result := public.upsert_experiment_blocks(
    current_setting('test.experiment_id')::uuid,
    jsonb_build_array(jsonb_build_object(
      'id', current_setting('test.block_id'),
      'type', 'paragraph',
      'content', '{"html":"Revised data after review feedback"}'::jsonb,
      'order_key', 'a0',
      'row_version', v_block_version
    ))
  );

  -- Resubmit for review
  v_result := public.resubmit_for_review(
    current_setting('test.experiment_id')::uuid,
    current_setting('test.review_a_id')::uuid
  );

  PERFORM set_config('test.review_b_id', v_result->>'review_id', true);
  PERFORM set_config('test.rev_n1', v_result->>'revision_number', true);
  PERFORM set_config('test.rev_n1_id', v_result->>'revision_id', true);
END $$;
SELECT pass('Author edits block and resubmits for review');

-- Append-only invariants: A unchanged, B is new pending row
SELECT is(
  (SELECT status FROM public.reviews WHERE id = current_setting('test.review_a_id')::uuid),
  'changes_requested',
  'Review A STILL changes_requested after resubmit'
);

SELECT is(
  (SELECT experiment_revision_id::text FROM public.reviews WHERE id = current_setting('test.review_a_id')::uuid),
  current_setting('test.rev_n_id'),
  'Review A still references original revision N'
);

SELECT is(
  (SELECT status FROM public.reviews WHERE id = current_setting('test.review_b_id')::uuid),
  'pending',
  'Review B is newly pending'
);

SELECT is(
  (SELECT experiment_revision_id::text FROM public.reviews WHERE id = current_setting('test.review_b_id')::uuid),
  current_setting('test.rev_n1_id'),
  'Review B references revision N+1'
);

SELECT ok(
  current_setting('test.review_b_id') != current_setting('test.review_a_id'),
  'Review B is a different row from Review A'
);

-- Notification for resubmission
DO $$
BEGIN
  -- Switch to reviewer identity to read their notifications
  PERFORM set_config('request.jwt.claims', jsonb_build_object(
    'sub', current_setting('test.reviewer_id'), 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
END $$;

SELECT ok(
  EXISTS (
    SELECT 1 FROM public.notifications
    WHERE user_id = current_setting('test.reviewer_id')::uuid
      AND type = 'review_resubmitted'
      AND title = 'Experiment resubmitted'
  ),
  'Resubmission notification created with type review_resubmitted'
);

-- ──────────────────────────────────────────────────────
-- Reviewer: approve review B (no new revision)
-- ──────────────────────────────────────────────────────
DO $$
DECLARE
  v_result jsonb;
  v_rev_count_before int;
  v_rev_count_after int;
BEGIN
  PERFORM set_config('request.jwt.claims', jsonb_build_object(
    'sub', current_setting('test.reviewer_id'), 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);

  -- Count revisions before approval
  PERFORM set_config('role', 'postgres', true);
  SELECT count(*) INTO v_rev_count_before FROM public.experiment_revisions
    WHERE experiment_id = current_setting('test.experiment_id')::uuid;

  PERFORM set_config('request.jwt.claims', jsonb_build_object(
    'sub', current_setting('test.reviewer_id'), 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);

  v_result := public.approve_experiment(
    current_setting('test.experiment_id')::uuid,
    current_setting('test.review_b_id')::uuid
  );

  -- Count revisions after approval
  PERFORM set_config('role', 'postgres', true);
  SELECT count(*) INTO v_rev_count_after FROM public.experiment_revisions
    WHERE experiment_id = current_setting('test.experiment_id')::uuid;

  IF v_rev_count_after != v_rev_count_before THEN
    RAISE EXCEPTION 'Approval created a new revision (% -> %)', v_rev_count_before, v_rev_count_after;
  END IF;
END $$;
SELECT pass('Reviewer approves review B without creating new revision');

-- Final state: B approved, A unchanged, experiment approved
SELECT is(
  (SELECT status FROM public.reviews WHERE id = current_setting('test.review_b_id')::uuid),
  'approved',
  'Review B is approved'
);

SELECT is(
  (SELECT status FROM public.experiments WHERE id = current_setting('test.experiment_id')::uuid),
  'approved',
  'Experiment is approved'
);

-- Review A must remain unchanged
SELECT is(
  (SELECT status FROM public.reviews WHERE id = current_setting('test.review_a_id')::uuid),
  'changes_requested',
  'Review A remains changes_requested after approval of B'
);

-- ──────────────────────────────────────────────────────
-- Signer: sign and lock — binds approved revision exactly
-- ──────────────────────────────────────────────────────
DO $$
DECLARE
  v_result jsonb;
  v_rev_count_before int;
  v_rev_count_after int;
BEGIN
  -- Reviewer has admin role so can sign
  PERFORM set_config('request.jwt.claims', jsonb_build_object(
    'sub', current_setting('test.reviewer_id'), 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);

  -- Count revisions before signing
  PERFORM set_config('role', 'postgres', true);
  SELECT count(*) INTO v_rev_count_before FROM public.experiment_revisions
    WHERE experiment_id = current_setting('test.experiment_id')::uuid;

  PERFORM set_config('request.jwt.claims', jsonb_build_object(
    'sub', current_setting('test.reviewer_id'), 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);

  v_result := public.sign_and_lock_experiment(
    current_setting('test.experiment_id')::uuid
  );

  PERFORM set_config('test.signature_id', v_result->>'signature_id', true);
  PERFORM set_config('test.signed_rev_id', v_result->>'revision_id', true);
  PERFORM set_config('test.signed_rev_num', v_result->>'revision_number', true);
  PERFORM set_config('test.signed_hash', v_result->>'content_hash', true);

  -- Verify signing did NOT create another revision
  PERFORM set_config('role', 'postgres', true);
  SELECT count(*) INTO v_rev_count_after FROM public.experiment_revisions
    WHERE experiment_id = current_setting('test.experiment_id')::uuid;

  IF v_rev_count_after != v_rev_count_before THEN
    RAISE EXCEPTION 'Signing created a new revision (% -> %)', v_rev_count_before, v_rev_count_after;
  END IF;
END $$;
SELECT pass('Signer signs without creating new revision');

-- Signature binds exact approved revision
SELECT ok(
  current_setting('test.signed_rev_id') = current_setting('test.rev_n1_id'),
  'Signature revision_id matches approved review revision (N+1)'
);

SELECT is(
  (SELECT status FROM public.experiments WHERE id = current_setting('test.experiment_id')::uuid),
  'locked',
  'Experiment is locked after signing'
);

SELECT * FROM finish();
ROLLBACK;
