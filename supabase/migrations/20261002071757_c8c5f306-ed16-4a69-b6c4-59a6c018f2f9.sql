-- Cycle 32: server-authoritative collaboration contract.
-- Writes to comment_threads / comments / mentions / notifications go only through
-- SECURITY DEFINER domain RPCs. Clients may read (RLS), mark own notifications
-- read (is_read column only) and delete own notifications.

-- 1. Remove direct write paths.
DROP POLICY IF EXISTS insert_ct ON public.comment_threads;
DROP POLICY IF EXISTS update_ct ON public.comment_threads;
DROP POLICY IF EXISTS update_comments ON public.comments;
DROP POLICY IF EXISTS delete_comments ON public.comments;

REVOKE ALL ON public.comment_threads, public.comments, public.mentions, public.notifications FROM anon, PUBLIC;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.comment_threads, public.comments, public.mentions FROM authenticated;
REVOKE INSERT, UPDATE, TRUNCATE, REFERENCES, TRIGGER ON public.notifications FROM authenticated;
GRANT SELECT ON public.comment_threads, public.comments, public.mentions, public.notifications TO authenticated;
GRANT UPDATE (is_read) ON public.notifications TO authenticated;
GRANT DELETE ON public.notifications TO authenticated;
GRANT ALL ON public.comment_threads, public.comments, public.mentions, public.notifications TO service_role;

-- 2. Stable navigation identifiers on notifications.
ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS thread_id uuid REFERENCES public.comment_threads(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS comment_id uuid REFERENCES public.comments(id) ON DELETE SET NULL;

-- 3. Comment creation / reply.
CREATE OR REPLACE FUNCTION public.add_comment_with_mentions(
  p_experiment_id uuid, p_thread_id uuid DEFAULT NULL, p_content text DEFAULT '',
  p_mentioned_user_ids uuid[] DEFAULT '{}')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_ws uuid;
  v_role text;
  v_thread_id uuid;
  v_comment_id uuid;
  v_content text := btrim(coalesce(p_content, ''), E' \t\r\n');
  v_ids uuid[];
  v_target uuid;
  v_notified uuid[] := '{}';
  v_mentioned uuid[] := '{}';
  v_parent uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF v_content = '' THEN RAISE EXCEPTION 'Comment cannot be empty'; END IF;
  IF char_length(v_content) > 10000 THEN RAISE EXCEPTION 'Comment exceeds 10000 characters'; END IF;

  SELECT array_agg(DISTINCT x) INTO v_ids FROM unnest(coalesce(p_mentioned_user_ids, '{}'::uuid[])) x WHERE x IS NOT NULL;
  v_ids := coalesce(v_ids, '{}');
  IF cardinality(v_ids) > 20 THEN RAISE EXCEPTION 'Too many mentions (max 20)'; END IF;

  SELECT e.workspace_id INTO v_ws FROM public.experiments e WHERE e.id = p_experiment_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Experiment not found'; END IF;
  SELECT wm.role INTO v_role FROM public.workspace_members wm WHERE wm.workspace_id = v_ws AND wm.user_id = v_uid;
  IF v_role IS NULL THEN RAISE EXCEPTION 'Not a workspace member'; END IF;
  IF v_role = 'guest' THEN RAISE EXCEPTION 'Guests cannot create comments'; END IF;

  IF p_thread_id IS NOT NULL THEN
    SELECT ct.id INTO v_thread_id FROM public.comment_threads ct
     WHERE ct.id = p_thread_id AND ct.experiment_id = p_experiment_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Thread not found'; END IF;
    SELECT c.created_by INTO v_parent FROM public.comments c
     WHERE c.thread_id = v_thread_id ORDER BY c.created_at, c.id LIMIT 1;
  ELSE
    INSERT INTO public.comment_threads (experiment_id) VALUES (p_experiment_id) RETURNING id INTO v_thread_id;
  END IF;

  INSERT INTO public.comments (thread_id, content, created_by)
  VALUES (v_thread_id, v_content, v_uid) RETURNING id INTO v_comment_id;

  -- Mentions: current workspace members only (others silently ignored); no self-notify.
  FOREACH v_target IN ARRAY v_ids LOOP
    CONTINUE WHEN NOT EXISTS (SELECT 1 FROM public.workspace_members wm WHERE wm.workspace_id = v_ws AND wm.user_id = v_target);
    INSERT INTO public.mentions (comment_id, user_id) VALUES (v_comment_id, v_target);
    v_mentioned := v_mentioned || v_target;
    IF v_target <> v_uid THEN
      INSERT INTO public.notifications (user_id, type, title, body, experiment_id, thread_id, comment_id)
      VALUES (v_target, 'mention', 'You were mentioned', 'You were mentioned in a comment', p_experiment_id, v_thread_id, v_comment_id);
      v_notified := v_notified || v_target;
    END IF;
  END LOOP;

  IF v_parent IS NOT NULL AND v_parent <> v_uid AND NOT (v_parent = ANY(v_notified))
     AND EXISTS (SELECT 1 FROM public.workspace_members wm WHERE wm.workspace_id = v_ws AND wm.user_id = v_parent) THEN
    INSERT INTO public.notifications (user_id, type, title, body, experiment_id, thread_id, comment_id)
    VALUES (v_parent, 'comment_reply', 'New reply', 'Someone replied to your comment', p_experiment_id, v_thread_id, v_comment_id);
    v_notified := v_notified || v_parent;
  END IF;

  RETURN jsonb_build_object('thread_id', v_thread_id, 'comment_id', v_comment_id,
    'mentioned_user_ids', to_jsonb(v_mentioned), 'notified_user_ids', to_jsonb(v_notified));
END $$;

-- 4. Resolve / reopen. Rule: same authority as commenting (owner/admin/member of the
-- experiment's workspace; guests and non-members denied). Idempotent.
CREATE OR REPLACE FUNCTION public.set_comment_thread_resolved(
  p_experiment_id uuid, p_thread_id uuid, p_resolved boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_ws uuid;
  v_role text;
  v_t public.comment_threads%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF p_resolved IS NULL THEN RAISE EXCEPTION 'Resolved state required'; END IF;
  SELECT e.workspace_id INTO v_ws FROM public.experiments e WHERE e.id = p_experiment_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Experiment not found'; END IF;
  SELECT wm.role INTO v_role FROM public.workspace_members wm WHERE wm.workspace_id = v_ws AND wm.user_id = v_uid;
  IF v_role IS NULL THEN RAISE EXCEPTION 'Not a workspace member'; END IF;
  IF v_role = 'guest' THEN RAISE EXCEPTION 'Guests cannot resolve comments'; END IF;

  SELECT * INTO v_t FROM public.comment_threads ct
   WHERE ct.id = p_thread_id AND ct.experiment_id = p_experiment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Thread not found'; END IF;

  IF v_t.is_resolved = p_resolved THEN
    RETURN jsonb_build_object('thread_id', v_t.id, 'is_resolved', v_t.is_resolved, 'changed', false);
  END IF;

  UPDATE public.comment_threads SET is_resolved = p_resolved,
    resolved_by = CASE WHEN p_resolved THEN v_uid END,
    resolved_at = CASE WHEN p_resolved THEN now() END
   WHERE id = v_t.id;
  RETURN jsonb_build_object('thread_id', v_t.id, 'is_resolved', p_resolved, 'changed', true);
END $$;

REVOKE ALL ON FUNCTION public.add_comment_with_mentions(uuid, uuid, text, uuid[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_comment_thread_resolved(uuid, uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.add_comment_with_mentions(uuid, uuid, text, uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_comment_thread_resolved(uuid, uuid, boolean) TO authenticated;
