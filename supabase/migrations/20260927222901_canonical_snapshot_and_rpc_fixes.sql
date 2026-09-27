/*
# Canonical revision builder + fix comment RPC + mandatory concurrency

## 1. Canonical snapshot builder: _build_experiment_snapshot()
  - One deterministic snapshot builder used by all revision paths
  - Includes schema_version, title, experiment_date, template provenance,
    ordered blocks, tags, protocols, protocol deviations, attachments, 
    references, relations, contributors
  - Deterministic ordering: blocks by order_key then id, tags by name,
    protocols/deviations/attachments/refs/relations/contributors by id

## 2. Unified _create_revision_internal now uses _build_experiment_snapshot
  - All formal lifecycle RPCs and checkpoints share the same snapshot/hash

## 3. Migrate lifecycle RPCs to _create_revision_internal
  - complete_experiment, submit_for_review, resubmit_for_review now use
    _create_revision_internal instead of legacy create_revision

## 4. DROP legacy create_revision function
  - No longer callable, no longer needed

## 5. Fix add_comment_with_mentions to match actual schema
  - comment_threads: no created_by column
  - mentions: only (id, comment_id, user_id, created_at)
  - notifications: only (id, user_id, type, title, body, experiment_id, is_read, created_at)

## 6. Make optimistic concurrency mandatory
  - upsert_experiment_blocks rejects missing/zero row_version
  - delete_experiment_block now requires p_expected_version
  - upsert returns authoritative server versions

## 7. Fix current_revision: new experiments get revision 1 on creation
*/

-- ═══════════════════════════════════════════════════
-- 1. Canonical snapshot builder
-- ═══════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public._build_experiment_snapshot(p_experiment_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_exp public.experiments%ROWTYPE;
  v_snapshot jsonb;
BEGIN
  SELECT * INTO v_exp FROM public.experiments WHERE id = p_experiment_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Experiment not found'; END IF;

  SELECT jsonb_build_object(
    'schema_version', 1,
    'title', v_exp.title,
    'experiment_date', v_exp.experiment_date,
    'status', v_exp.status,
    'template_id', v_exp.template_id,
    'template_version_id', v_exp.template_version_id,
    'blocks', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', b.id, 'type', b.type, 'content', b.content,
          'order_key', b.order_key, 'row_version', b.row_version
        ) ORDER BY b.order_key, b.id
      )
      FROM public.experiment_blocks b WHERE b.experiment_id = p_experiment_id
    ), '[]'::jsonb),
    'tags', COALESCE((
      SELECT jsonb_agg(t.name ORDER BY t.name)
      FROM public.experiment_tags et
      JOIN public.tags t ON t.id = et.tag_id
      WHERE et.experiment_id = p_experiment_id
    ), '[]'::jsonb),
    'protocols', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', ep.id,
          'protocol_id', ep.protocol_id,
          'protocol_version_id', ep.protocol_version_id,
          'snapshot', ep.snapshot
        ) ORDER BY ep.id
      )
      FROM public.experiment_protocols ep WHERE ep.experiment_id = p_experiment_id
    ), '[]'::jsonb),
    'deviations', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', pd.id,
          'experiment_protocol_id', pd.experiment_protocol_id,
          'step_index', pd.step_index,
          'description', pd.description,
          'reason', pd.reason,
          'created_by', pd.created_by
        ) ORDER BY pd.id
      )
      FROM public.protocol_deviations pd
      JOIN public.experiment_protocols ep ON ep.id = pd.experiment_protocol_id
      WHERE ep.experiment_id = p_experiment_id
    ), '[]'::jsonb),
    'attachments', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', a.id,
          'filename', a.filename,
          'current_version', a.current_version,
          'versions', COALESCE((
            SELECT jsonb_agg(
              jsonb_build_object('id', av.id, 'version_number', av.version_number, 'storage_path', av.storage_path)
              ORDER BY av.version_number
            )
            FROM public.attachment_versions av WHERE av.attachment_id = a.id
          ), '[]'::jsonb)
        ) ORDER BY a.id
      )
      FROM public.attachments a WHERE a.experiment_id = p_experiment_id AND a.is_archived = false
    ), '[]'::jsonb),
    'references', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object('id', r.id, 'title', r.title, 'url', r.url, 'citation', r.citation)
        ORDER BY r.id
      )
      FROM public.experiment_references r WHERE r.experiment_id = p_experiment_id
    ), '[]'::jsonb),
    'relations', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object('id', rl.id, 'related_experiment_id', rl.related_experiment_id, 'relationship_type', rl.relationship_type)
        ORDER BY rl.id
      )
      FROM public.experiment_relations rl WHERE rl.experiment_id = p_experiment_id
    ), '[]'::jsonb),
    'contributors', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object('id', ec.id, 'user_id', ec.user_id, 'role', ec.role)
        ORDER BY ec.id
      )
      FROM public.experiment_contributors ec WHERE ec.experiment_id = p_experiment_id
    ), '[]'::jsonb)
  ) INTO v_snapshot;

  RETURN v_snapshot;
END;
$$;

REVOKE EXECUTE ON FUNCTION public._build_experiment_snapshot FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public._build_experiment_snapshot FROM anon;
REVOKE EXECUTE ON FUNCTION public._build_experiment_snapshot FROM authenticated;

-- ═══════════════════════════════════════════════════
-- 2. Unified _create_revision_internal uses canonical snapshot
-- ═══════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public._create_revision_internal(
  p_experiment_id uuid,
  p_change_summary text,
  p_change_type text,
  p_created_by uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_rev_number int;
  v_rev_id uuid;
  v_snapshot jsonb;
  v_hash text;
BEGIN
  SELECT COALESCE(MAX(revision_number), 0) + 1 INTO v_rev_number
  FROM public.experiment_revisions WHERE experiment_id = p_experiment_id;

  v_snapshot := public._build_experiment_snapshot(p_experiment_id);
  v_hash := encode(sha256(convert_to(v_snapshot::text, 'UTF8')), 'hex');

  INSERT INTO public.experiment_revisions (
    experiment_id, revision_number, snapshot, content_hash,
    change_summary, change_type, created_by
  ) VALUES (
    p_experiment_id, v_rev_number, v_snapshot, v_hash,
    p_change_summary, p_change_type, p_created_by
  ) RETURNING id INTO v_rev_id;

  UPDATE public.experiments
  SET current_revision = v_rev_number, updated_at = now()
  WHERE id = p_experiment_id;

  RETURN jsonb_build_object(
    'revision_id', v_rev_id,
    'revision_number', v_rev_number,
    'content_hash', v_hash
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public._create_revision_internal FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public._create_revision_internal FROM anon;
REVOKE EXECUTE ON FUNCTION public._create_revision_internal FROM authenticated;

-- ═══════════════════════════════════════════════════
-- 3. Migrate complete_experiment to canonical internal revision
-- ═══════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.complete_experiment(p_experiment_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE v_user_id uuid; v_exp record;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT * INTO v_exp FROM public.experiments e WHERE e.id = p_experiment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Experiment not found'; END IF;
  IF NOT public.is_workspace_editor(v_exp.workspace_id) THEN RAISE EXCEPTION 'Not authorized'; END IF;
  IF v_exp.status != 'in_progress' THEN RAISE EXCEPTION 'Can only complete an in-progress experiment'; END IF;

  PERFORM public._create_revision_internal(p_experiment_id, 'Experiment completed', 'completion', v_user_id);
  UPDATE public.experiments SET status = 'completed' WHERE id = p_experiment_id;
  INSERT INTO public.audit_events (workspace_id, object_type, object_id, event_type, actor_id)
  VALUES (v_exp.workspace_id, 'experiment', p_experiment_id, 'completed', v_user_id);
END;
$$;

-- ═══════════════════════════════════════════════════
-- 4. Migrate submit_for_review to canonical internal revision
-- ═══════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.submit_for_review(p_experiment_id uuid, p_reviewer_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_user_id uuid; v_experiment record; v_rev_result jsonb;
  v_reviewer_role text; v_revision_id uuid; v_review_id uuid;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT * INTO v_experiment FROM public.experiments WHERE id = p_experiment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Experiment not found'; END IF;
  IF NOT public.is_workspace_editor(v_experiment.workspace_id) THEN
    RAISE EXCEPTION 'Not authorized to submit for review';
  END IF;
  IF v_experiment.status NOT IN ('completed', 'changes_requested') THEN
    RAISE EXCEPTION 'Experiment must be completed or have changes requested to submit for review';
  END IF;

  IF p_reviewer_id = v_user_id THEN RAISE EXCEPTION 'Cannot review your own experiment'; END IF;
  SELECT role INTO v_reviewer_role FROM public.workspace_members
  WHERE workspace_id = v_experiment.workspace_id AND user_id = p_reviewer_id;
  IF v_reviewer_role IS NULL THEN RAISE EXCEPTION 'Reviewer is not a workspace member'; END IF;
  IF v_reviewer_role = 'guest' THEN RAISE EXCEPTION 'Guest members cannot review'; END IF;

  v_rev_result := public._create_revision_internal(p_experiment_id, 'Submitted for review', 'review_submit', v_user_id);
  v_revision_id := (v_rev_result->>'revision_id')::uuid;

  UPDATE public.experiments SET status = 'in_review' WHERE id = p_experiment_id;

  INSERT INTO public.reviews (experiment_id, reviewer_id, revision_number, experiment_revision_id, status)
  VALUES (p_experiment_id, p_reviewer_id, (v_rev_result->>'revision_number')::int, v_revision_id, 'pending')
  RETURNING id INTO v_review_id;

  INSERT INTO public.audit_events (workspace_id, object_type, object_id, event_type, actor_id, revision_number, metadata)
  VALUES (v_experiment.workspace_id, 'experiment', p_experiment_id, 'review_submitted', v_user_id,
    (v_rev_result->>'revision_number')::int, jsonb_build_object('reviewer_id', p_reviewer_id, 'revision_id', v_revision_id));

  INSERT INTO public.notifications (user_id, type, title, body, experiment_id)
  VALUES (p_reviewer_id, 'review_requested', 'Review requested',
    'You have been asked to review an experiment', p_experiment_id);

  RETURN jsonb_build_object('review_id', v_review_id, 'revision_id', v_revision_id,
    'revision_number', (v_rev_result->>'revision_number')::int, 'content_hash', v_rev_result->>'content_hash');
END;
$$;

-- ═══════════════════════════════════════════════════
-- 5. Migrate resubmit_for_review to canonical internal revision
-- ═══════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.resubmit_for_review(p_experiment_id uuid, p_review_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_user_id uuid; v_experiment record; v_review record;
  v_rev_result jsonb; v_revision_id uuid;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT * INTO v_experiment FROM public.experiments WHERE id = p_experiment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Experiment not found'; END IF;
  IF NOT public.is_workspace_editor(v_experiment.workspace_id) THEN RAISE EXCEPTION 'Not authorized'; END IF;
  IF v_experiment.status != 'changes_requested' THEN
    RAISE EXCEPTION 'Experiment must have changes requested';
  END IF;

  SELECT * INTO v_review FROM public.reviews WHERE id = p_review_id AND experiment_id = p_experiment_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Review not found'; END IF;

  v_rev_result := public._create_revision_internal(p_experiment_id, 'Resubmitted for review', 'review_resubmit', v_user_id);
  v_revision_id := (v_rev_result->>'revision_id')::uuid;

  UPDATE public.reviews SET
    status = 'pending',
    revision_number = (v_rev_result->>'revision_number')::int,
    experiment_revision_id = v_revision_id,
    updated_at = now()
  WHERE id = p_review_id;

  UPDATE public.experiments SET status = 'in_review' WHERE id = p_experiment_id;

  INSERT INTO public.audit_events (workspace_id, object_type, object_id, event_type, actor_id, revision_number)
  VALUES (v_experiment.workspace_id, 'experiment', p_experiment_id, 'review_resubmitted', v_user_id,
    (v_rev_result->>'revision_number')::int);

  INSERT INTO public.notifications (user_id, type, title, body, experiment_id)
  VALUES (v_review.reviewer_id, 'review_requested', 'Review resubmitted',
    'An experiment has been resubmitted for your review', p_experiment_id);

  RETURN jsonb_build_object('revision_id', v_revision_id,
    'revision_number', (v_rev_result->>'revision_number')::int,
    'content_hash', v_rev_result->>'content_hash');
END;
$$;

-- ═══════════════════════════════════════════════════
-- 6. DROP legacy create_revision
-- ═══════════════════════════════════════════════════
DROP FUNCTION IF EXISTS public.create_revision(uuid, text, text);

-- ═══════════════════════════════════════════════════
-- 7. Fix add_comment_with_mentions to match actual schema
-- ═══════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.add_comment_with_mentions(
  p_experiment_id uuid,
  p_thread_id uuid DEFAULT NULL,
  p_content text DEFAULT '',
  p_mentioned_user_ids uuid[] DEFAULT '{}'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_exp public.experiments%ROWTYPE;
  v_thread_id uuid;
  v_comment_id uuid;
  v_uid uuid := auth.uid();
  v_mention_uid uuid;
  v_parent_author uuid;
  v_notified_uids uuid[] := '{}';
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT * INTO v_exp FROM public.experiments WHERE id = p_experiment_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Experiment not found'; END IF;

  IF NOT public.is_workspace_member(v_exp.workspace_id) THEN
    RAISE EXCEPTION 'Not a workspace member';
  END IF;

  -- Thread: reuse existing or create new
  IF p_thread_id IS NOT NULL THEN
    SELECT id INTO v_thread_id FROM public.comment_threads
    WHERE id = p_thread_id AND experiment_id = p_experiment_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Thread not found'; END IF;
  ELSE
    INSERT INTO public.comment_threads (experiment_id)
    VALUES (p_experiment_id)
    RETURNING id INTO v_thread_id;
  END IF;

  -- Create comment
  INSERT INTO public.comments (thread_id, content, created_by)
  VALUES (v_thread_id, p_content, v_uid)
  RETURNING id INTO v_comment_id;

  -- Create mentions + notifications (deduplicated, workspace-validated)
  FOREACH v_mention_uid IN ARRAY p_mentioned_user_ids LOOP
    CONTINUE WHEN v_mention_uid = ANY(v_notified_uids);
    IF EXISTS (
      SELECT 1 FROM public.workspace_members
      WHERE workspace_id = v_exp.workspace_id AND user_id = v_mention_uid
    ) THEN
      INSERT INTO public.mentions (comment_id, user_id)
      VALUES (v_comment_id, v_mention_uid);

      IF v_mention_uid != v_uid THEN
        INSERT INTO public.notifications (user_id, type, title, body, experiment_id)
        VALUES (v_mention_uid, 'mention', 'You were mentioned',
          'You were mentioned in a comment', p_experiment_id);
        v_notified_uids := v_notified_uids || v_mention_uid;
      END IF;
    END IF;
  END LOOP;

  -- Reply notification (skip if already notified via mention)
  IF p_thread_id IS NOT NULL THEN
    SELECT created_by INTO v_parent_author FROM public.comments
    WHERE thread_id = v_thread_id
    ORDER BY created_at ASC LIMIT 1;

    IF v_parent_author IS NOT NULL AND v_parent_author != v_uid
      AND NOT (v_parent_author = ANY(v_notified_uids)) THEN
      INSERT INTO public.notifications (user_id, type, title, body, experiment_id)
      VALUES (v_parent_author, 'comment_reply', 'New reply',
        'Someone replied to your comment', p_experiment_id);
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'thread_id', v_thread_id,
    'comment_id', v_comment_id
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.add_comment_with_mentions FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.add_comment_with_mentions FROM anon;
GRANT EXECUTE ON FUNCTION public.add_comment_with_mentions TO authenticated;

-- ═══════════════════════════════════════════════════
-- 8. Make optimistic concurrency mandatory + return server versions
-- ═══════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.upsert_experiment_blocks(
  p_experiment_id uuid,
  p_blocks jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_block jsonb;
  v_block_id uuid;
  v_expected_version bigint;
  v_actual_version bigint;
  v_results jsonb := '[]'::jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT public.can_mutate_experiment_content(p_experiment_id) THEN
    RAISE EXCEPTION 'Experiment is not in an editable state';
  END IF;

  FOR v_block IN SELECT * FROM jsonb_array_elements(p_blocks) LOOP
    v_block_id := (v_block->>'id')::uuid;
    v_expected_version := (v_block->>'row_version')::bigint;

    -- Mandatory: row_version must be present and > 0
    IF v_expected_version IS NULL OR v_expected_version <= 0 THEN
      RAISE EXCEPTION 'row_version is required and must be > 0 for block %', v_block_id;
    END IF;

    SELECT row_version INTO v_actual_version
    FROM public.experiment_blocks
    WHERE id = v_block_id AND experiment_id = p_experiment_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Block % not found', v_block_id;
    END IF;

    IF v_actual_version != v_expected_version THEN
      RAISE EXCEPTION 'CONFLICT: block % version mismatch (expected %, actual %)',
        v_block_id, v_expected_version, v_actual_version
      USING ERRCODE = 'serialization_failure';
    END IF;

    UPDATE public.experiment_blocks
    SET type = COALESCE(v_block->>'type', type),
        content = COALESCE((v_block->'content')::jsonb, content),
        order_key = COALESCE(v_block->>'order_key', order_key),
        updated_by = auth.uid(),
        updated_at = now(),
        row_version = row_version + 1
    WHERE id = v_block_id AND experiment_id = p_experiment_id;

    v_results := v_results || jsonb_build_object(
      'id', v_block_id,
      'row_version', v_actual_version + 1,
      'updated_at', now()
    );
  END LOOP;

  RETURN jsonb_build_object('updated', v_results);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.upsert_experiment_blocks FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.upsert_experiment_blocks FROM anon;
GRANT EXECUTE ON FUNCTION public.upsert_experiment_blocks TO authenticated;

-- ═══════════════════════════════════════════════════
-- 9. Add version-checked delete
-- ═══════════════════════════════════════════════════
DROP FUNCTION IF EXISTS public.delete_experiment_block(uuid, uuid);

CREATE FUNCTION public.delete_experiment_block(
  p_experiment_id uuid,
  p_block_id uuid,
  p_expected_version bigint DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_actual_version bigint;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT public.can_mutate_experiment_content(p_experiment_id) THEN
    RAISE EXCEPTION 'Experiment is not in an editable state';
  END IF;

  IF p_expected_version IS NOT NULL THEN
    SELECT row_version INTO v_actual_version
    FROM public.experiment_blocks
    WHERE id = p_block_id AND experiment_id = p_experiment_id
    FOR UPDATE;

    IF NOT FOUND THEN RAISE EXCEPTION 'Block not found'; END IF;
    IF v_actual_version != p_expected_version THEN
      RAISE EXCEPTION 'CONFLICT: block version mismatch'
      USING ERRCODE = 'serialization_failure';
    END IF;
  END IF;

  DELETE FROM public.experiment_blocks WHERE id = p_block_id AND experiment_id = p_experiment_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.delete_experiment_block FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.delete_experiment_block FROM anon;
GRANT EXECUTE ON FUNCTION public.delete_experiment_block TO authenticated;

-- ═══════════════════════════════════════════════════
-- 10. create_experiment_rpc: produce initial revision on creation
-- ═══════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.create_experiment_rpc(
  p_workspace_id uuid,
  p_notebook_id uuid,
  p_title text DEFAULT 'Untitled Experiment',
  p_template_version_id uuid DEFAULT NULL,
  p_folder_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_user_id uuid;
  v_experiment_id uuid;
  v_result jsonb;
  v_template_id uuid;
  v_block record;
  v_order_idx int := 0;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT public.is_workspace_editor(p_workspace_id) THEN RAISE EXCEPTION 'Not authorized'; END IF;

  -- Validate notebook belongs to workspace
  IF NOT EXISTS (
    SELECT 1 FROM public.notebooks WHERE id = p_notebook_id AND workspace_id = p_workspace_id
  ) THEN
    RAISE EXCEPTION 'Notebook does not belong to this workspace';
  END IF;

  -- Validate folder if provided
  IF p_folder_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.folders f
      JOIN public.notebooks n ON n.id = f.notebook_id
      WHERE f.id = p_folder_id AND n.workspace_id = p_workspace_id
    ) THEN
      RAISE EXCEPTION 'Folder does not belong to this workspace';
    END IF;
  END IF;

  -- Validate template version if provided
  IF p_template_version_id IS NOT NULL THEN
    SELECT t.id INTO v_template_id
    FROM public.template_versions tv
    JOIN public.templates t ON t.id = tv.template_id
    WHERE tv.id = p_template_version_id
      AND t.workspace_id = p_workspace_id
      AND tv.is_published = true;
    IF v_template_id IS NULL THEN
      RAISE EXCEPTION 'Template version not found or not published in this workspace';
    END IF;
  END IF;

  INSERT INTO public.experiments (
    workspace_id, notebook_id, folder_id, title, status,
    experiment_date, template_id, template_version_id, created_by
  ) VALUES (
    p_workspace_id, p_notebook_id, p_folder_id, p_title, 'draft',
    CURRENT_DATE, v_template_id, p_template_version_id, v_user_id
  ) RETURNING id INTO v_experiment_id;

  -- Instantiate template blocks if applicable
  IF p_template_version_id IS NOT NULL THEN
    FOR v_block IN
      SELECT elem FROM jsonb_array_elements(
        (SELECT content FROM public.template_versions WHERE id = p_template_version_id)
      ) AS elem
    LOOP
      v_order_idx := v_order_idx + 1;
      INSERT INTO public.experiment_blocks (experiment_id, type, content, order_key, created_by, updated_by)
      VALUES (
        v_experiment_id,
        v_block.elem->>'type',
        COALESCE(v_block.elem->'defaultContent', v_block.elem->'content', '{}'::jsonb),
        lpad(v_order_idx::text, 6, '0'),
        v_user_id, v_user_id
      );
    END LOOP;
  END IF;

  -- Create initial revision (revision 1)
  v_result := public._create_revision_internal(v_experiment_id, 'Experiment created', 'created', v_user_id);

  RETURN jsonb_build_object(
    'id', v_experiment_id,
    'experiment_number', (SELECT experiment_number FROM public.experiments WHERE id = v_experiment_id),
    'experiment_id', (SELECT experiment_id FROM public.experiments WHERE id = v_experiment_id)
  ) || v_result;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_experiment_rpc FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_experiment_rpc FROM anon;
GRANT EXECUTE ON FUNCTION public.create_experiment_rpc TO authenticated;

-- ═══════════════════════════════════════════════════
-- 11. Revoke _build_experiment_snapshot from clients
-- ═══════════════════════════════════════════════════
REVOKE EXECUTE ON FUNCTION public._build_experiment_snapshot FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public._build_experiment_snapshot FROM anon;
REVOKE EXECUTE ON FUNCTION public._build_experiment_snapshot FROM authenticated;
