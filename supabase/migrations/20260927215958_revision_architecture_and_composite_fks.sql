/*
# Revision architecture overhaul + composite FK integrity

1. Split revision creation
  - _create_revision_internal: private helper, REVOKED from all client roles
  - create_checkpoint: public RPC for user checkpoints only (replaces create_revision)
  - Old create_revision is dropped as a public interface

2. Composite unique key on experiment_revisions(id, experiment_id)
  - Enables composite FK from reviews and signatures
  - Ensures review/signature revision belongs to same experiment

3. Composite FK on reviews(experiment_revision_id, experiment_id)
  - Prevents cross-experiment review-revision attacks

4. Composite FK on signatures(experiment_revision_id, experiment_id)
  - Prevents cross-experiment signature-revision attacks

5. restore_experiment_revision RPC
  - Transactionally restores a historical revision's block content
  - Creates a new 'restoration' revision with source provenance
  - Requires editable lifecycle

6. add_comment_with_mentions RPC
  - Atomically creates thread, comment, mentions, notifications
  - Prevents direct mention/notification insertion bypass
*/

-- ═══════════════════════════════════════════════════
-- 1. Add composite unique key on experiment_revisions
-- ═══════════════════════════════════════════════════
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.experiment_revisions'::regclass
      AND conname = 'experiment_revisions_id_experiment_id_key'
  ) THEN
    ALTER TABLE public.experiment_revisions
      ADD CONSTRAINT experiment_revisions_id_experiment_id_key UNIQUE (id, experiment_id);
  END IF;
END $$;

-- ═══════════════════════════════════════════════════
-- 2. Add composite FK on reviews
-- ═══════════════════════════════════════════════════
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.reviews'::regclass
      AND conname = 'reviews_revision_experiment_fk'
  ) THEN
    ALTER TABLE public.reviews
      ADD CONSTRAINT reviews_revision_experiment_fk
      FOREIGN KEY (experiment_revision_id, experiment_id)
      REFERENCES public.experiment_revisions(id, experiment_id);
  END IF;
END $$;

-- ═══════════════════════════════════════════════════
-- 3. Add composite FK on signatures
-- ═══════════════════════════════════════════════════
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.signatures'::regclass
      AND conname = 'signatures_revision_experiment_fk'
  ) THEN
    ALTER TABLE public.signatures
      ADD CONSTRAINT signatures_revision_experiment_fk
      FOREIGN KEY (experiment_revision_id, experiment_id)
      REFERENCES public.experiment_revisions(id, experiment_id);
  END IF;
END $$;

-- ═══════════════════════════════════════════════════
-- 4. Internal revision helper (NO client access)
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
  v_exp public.experiments%ROWTYPE;
  v_rev_number int;
  v_rev_id uuid;
  v_snapshot jsonb;
  v_hash text;
BEGIN
  SELECT * INTO v_exp FROM public.experiments WHERE id = p_experiment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Experiment not found'; END IF;

  SELECT COALESCE(MAX(revision_number), 0) + 1 INTO v_rev_number
  FROM public.experiment_revisions WHERE experiment_id = p_experiment_id;

  SELECT jsonb_build_object(
    'title', v_exp.title,
    'status', v_exp.status,
    'experiment_date', v_exp.experiment_date,
    'blocks', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', b.id, 'type', b.type, 'content', b.content,
          'order_key', b.order_key, 'row_version', b.row_version
        ) ORDER BY b.order_key
      )
      FROM public.experiment_blocks b WHERE b.experiment_id = p_experiment_id
    ), '[]'::jsonb),
    'tags', COALESCE((
      SELECT jsonb_agg(t.name ORDER BY t.name)
      FROM public.experiment_tags et
      JOIN public.tags t ON t.id = et.tag_id
      WHERE et.experiment_id = p_experiment_id
    ), '[]'::jsonb)
  ) INTO v_snapshot;

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
-- 5. Public checkpoint RPC (replaces create_revision)
-- ═══════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.create_checkpoint(
  p_experiment_id uuid,
  p_change_summary text DEFAULT ''
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF NOT public.can_mutate_experiment_content(p_experiment_id) THEN
    RAISE EXCEPTION 'Experiment is not in an editable state for checkpoints';
  END IF;

  RETURN public._create_revision_internal(
    p_experiment_id, p_change_summary, 'checkpoint', auth.uid()
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_checkpoint FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_checkpoint FROM anon;
GRANT EXECUTE ON FUNCTION public.create_checkpoint TO authenticated;

-- ═══════════════════════════════════════════════════
-- 6. Revoke old create_revision from authenticated
-- ═══════════════════════════════════════════════════
REVOKE EXECUTE ON FUNCTION public.create_revision FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_revision FROM anon;
REVOKE EXECUTE ON FUNCTION public.create_revision FROM authenticated;

-- ═══════════════════════════════════════════════════
-- 7. restore_experiment_revision RPC
-- ═══════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.restore_experiment_revision(
  p_experiment_id uuid,
  p_revision_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_exp public.experiments%ROWTYPE;
  v_rev public.experiment_revisions%ROWTYPE;
  v_block jsonb;
  v_result jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT * INTO v_exp FROM public.experiments WHERE id = p_experiment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Experiment not found'; END IF;

  IF NOT public.can_mutate_experiment_content(p_experiment_id) THEN
    RAISE EXCEPTION 'Experiment is not in an editable state';
  END IF;

  SELECT * INTO v_rev FROM public.experiment_revisions
  WHERE id = p_revision_id AND experiment_id = p_experiment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Revision does not belong to this experiment';
  END IF;

  DELETE FROM public.experiment_blocks WHERE experiment_id = p_experiment_id;

  IF v_rev.snapshot->'blocks' IS NOT NULL AND jsonb_array_length(v_rev.snapshot->'blocks') > 0 THEN
    FOR v_block IN SELECT * FROM jsonb_array_elements(v_rev.snapshot->'blocks') LOOP
      INSERT INTO public.experiment_blocks (experiment_id, type, content, order_key, created_by, updated_by)
      VALUES (
        p_experiment_id,
        v_block->>'type',
        (v_block->'content')::jsonb,
        v_block->>'order_key',
        auth.uid(),
        auth.uid()
      );
    END LOOP;
  END IF;

  IF v_rev.snapshot->>'title' IS NOT NULL THEN
    UPDATE public.experiments SET title = v_rev.snapshot->>'title', updated_at = now()
    WHERE id = p_experiment_id;
  END IF;

  v_result := public._create_revision_internal(
    p_experiment_id,
    format('Restored from revision %s', v_rev.revision_number),
    'restoration',
    auth.uid()
  );

  RETURN v_result || jsonb_build_object('source_revision_id', v_rev.id, 'source_revision_number', v_rev.revision_number);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.restore_experiment_revision FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.restore_experiment_revision FROM anon;
GRANT EXECUTE ON FUNCTION public.restore_experiment_revision TO authenticated;

-- ═══════════════════════════════════════════════════
-- 8. add_comment_with_mentions RPC
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
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT * INTO v_exp FROM public.experiments WHERE id = p_experiment_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Experiment not found'; END IF;

  IF NOT public.is_workspace_member(v_exp.workspace_id) THEN
    RAISE EXCEPTION 'Not a workspace member';
  END IF;

  IF p_thread_id IS NOT NULL THEN
    SELECT id INTO v_thread_id FROM public.comment_threads
    WHERE id = p_thread_id AND experiment_id = p_experiment_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Thread not found'; END IF;
  ELSE
    INSERT INTO public.comment_threads (experiment_id, created_by)
    VALUES (p_experiment_id, v_uid)
    RETURNING id INTO v_thread_id;
  END IF;

  INSERT INTO public.comments (thread_id, content, created_by)
  VALUES (v_thread_id, p_content, v_uid)
  RETURNING id INTO v_comment_id;

  FOREACH v_mention_uid IN ARRAY p_mentioned_user_ids LOOP
    IF EXISTS (
      SELECT 1 FROM public.workspace_members
      WHERE workspace_id = v_exp.workspace_id AND user_id = v_mention_uid
    ) THEN
      INSERT INTO public.mentions (experiment_id, comment_id, user_id, created_by)
      VALUES (p_experiment_id, v_comment_id, v_mention_uid, v_uid);

      IF v_mention_uid != v_uid THEN
        INSERT INTO public.notifications (user_id, workspace_id, experiment_id, type, title, message, metadata)
        VALUES (
          v_mention_uid, v_exp.workspace_id, p_experiment_id,
          'mention', 'You were mentioned',
          'You were mentioned in a comment',
          jsonb_build_object('comment_id', v_comment_id, 'thread_id', v_thread_id)
        );
      END IF;
    END IF;
  END LOOP;

  IF p_thread_id IS NOT NULL THEN
    SELECT created_by INTO v_parent_author FROM public.comments
    WHERE thread_id = v_thread_id
    ORDER BY created_at ASC LIMIT 1;

    IF v_parent_author IS NOT NULL AND v_parent_author != v_uid THEN
      INSERT INTO public.notifications (user_id, workspace_id, experiment_id, type, title, message, metadata)
      VALUES (
        v_parent_author, v_exp.workspace_id, p_experiment_id,
        'comment_reply', 'New reply',
        'Someone replied to your comment',
        jsonb_build_object('comment_id', v_comment_id, 'thread_id', v_thread_id)
      );
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
