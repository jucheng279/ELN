
-- Guest users (role='guest') should not be able to create comments or threads.
-- The add_comment_with_mentions RPC currently only checks is_workspace_member.
-- Fix: add role check to deny guests.

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
AS $function$
DECLARE
  v_exp public.experiments%ROWTYPE;
  v_thread_id uuid;
  v_comment_id uuid;
  v_uid uuid := auth.uid();
  v_mention_uid uuid;
  v_parent_author uuid;
  v_notified_uids uuid[] := '{}';
  v_member_role text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT * INTO v_exp FROM public.experiments WHERE id = p_experiment_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Experiment not found'; END IF;

  IF NOT public.is_workspace_member(v_exp.workspace_id) THEN
    RAISE EXCEPTION 'Not a workspace member';
  END IF;

  -- Deny guest role
  SELECT role INTO v_member_role
  FROM public.workspace_members
  WHERE workspace_id = v_exp.workspace_id AND user_id = v_uid;

  IF v_member_role = 'guest' THEN
    RAISE EXCEPTION 'Guests cannot create comments';
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
$function$;

-- Also tighten comment_threads INSERT to deny guests
DROP POLICY IF EXISTS insert_ct ON public.comment_threads;
CREATE POLICY insert_ct ON public.comment_threads FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.experiments e
      JOIN public.workspace_members wm ON wm.workspace_id = e.workspace_id AND wm.user_id = auth.uid()
      WHERE e.id = comment_threads.experiment_id
      AND wm.role != 'guest'
    )
  );

-- Search validation: clamp page_size, validate sort
CREATE OR REPLACE FUNCTION public.search_experiments(
  p_workspace_id uuid,
  p_query text DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_notebook_id uuid DEFAULT NULL,
  p_created_by uuid DEFAULT NULL,
  p_date_from date DEFAULT NULL,
  p_date_to date DEFAULT NULL,
  p_tag_ids uuid[] DEFAULT NULL,
  p_sort_by text DEFAULT 'relevance',
  p_page integer DEFAULT 1,
  p_page_size integer DEFAULT 25
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_user_id uuid;
  v_offset int;
  v_total int;
  v_results jsonb;
  v_tsquery tsquery;
  v_page int;
  v_page_size int;
  v_sort text;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT public.is_workspace_member(p_workspace_id) THEN
    RAISE EXCEPTION 'Not a workspace member';
  END IF;

  -- Validate and clamp inputs
  v_page := GREATEST(COALESCE(p_page, 1), 1);
  v_page_size := LEAST(GREATEST(COALESCE(p_page_size, 25), 1), 100);
  v_sort := CASE WHEN p_sort_by IN ('relevance', 'date') THEN p_sort_by ELSE 'relevance' END;

  v_offset := (v_page - 1) * v_page_size;

  IF p_query IS NOT NULL AND p_query != '' THEN
    BEGIN
      v_tsquery := websearch_to_tsquery('english', p_query);
    EXCEPTION WHEN OTHERS THEN
      v_tsquery := plainto_tsquery('english', p_query);
    END;
  END IF;

  SELECT count(*) INTO v_total
  FROM public.experiments e
  WHERE e.workspace_id = p_workspace_id
    AND NOT e.is_archived
    AND (p_status IS NULL OR e.status = p_status)
    AND (p_notebook_id IS NULL OR e.notebook_id = p_notebook_id)
    AND (p_created_by IS NULL OR e.created_by = p_created_by)
    AND (p_date_from IS NULL OR e.experiment_date >= p_date_from)
    AND (p_date_to IS NULL OR e.experiment_date <= p_date_to)
    AND (p_tag_ids IS NULL OR array_length(p_tag_ids, 1) IS NULL OR EXISTS (
      SELECT 1 FROM public.experiment_tags et
      WHERE et.experiment_id = e.id AND et.tag_id = ANY(p_tag_ids)
    ))
    AND (v_tsquery IS NULL OR (
      e.search_vector @@ v_tsquery
      OR e.experiment_id ILIKE '%' || p_query || '%'
      OR e.title ILIKE '%' || p_query || '%'
    ));

  SELECT jsonb_agg(row_to_json(t))
  INTO v_results
  FROM (
    SELECT
      e.id, e.experiment_id, e.title, e.status, e.notebook_id,
      e.created_by, e.experiment_date, e.created_at, e.updated_at,
      e.is_locked, e.is_archived, e.current_revision,
      n.name AS notebook_name,
      p.display_name AS author_name,
      CASE
        WHEN v_tsquery IS NOT NULL AND e.search_vector @@ v_tsquery
        THEN ts_rank(e.search_vector, v_tsquery)
        ELSE 0
      END AS rank
    FROM public.experiments e
    LEFT JOIN public.notebooks n ON n.id = e.notebook_id
    LEFT JOIN public.profiles p ON p.id = e.created_by
    WHERE e.workspace_id = p_workspace_id
      AND NOT e.is_archived
      AND (p_status IS NULL OR e.status = p_status)
      AND (p_notebook_id IS NULL OR e.notebook_id = p_notebook_id)
      AND (p_created_by IS NULL OR e.created_by = p_created_by)
      AND (p_date_from IS NULL OR e.experiment_date >= p_date_from)
      AND (p_date_to IS NULL OR e.experiment_date <= p_date_to)
      AND (p_tag_ids IS NULL OR array_length(p_tag_ids, 1) IS NULL OR EXISTS (
        SELECT 1 FROM public.experiment_tags et
        WHERE et.experiment_id = e.id AND et.tag_id = ANY(p_tag_ids)
      ))
      AND (v_tsquery IS NULL OR (
        e.search_vector @@ v_tsquery
        OR e.experiment_id ILIKE '%' || p_query || '%'
        OR e.title ILIKE '%' || p_query || '%'
      ))
    ORDER BY
      CASE WHEN v_sort = 'relevance' AND v_tsquery IS NOT NULL
           THEN ts_rank(e.search_vector, v_tsquery) END DESC NULLS LAST,
      e.updated_at DESC
    LIMIT v_page_size OFFSET v_offset
  ) t;

  RETURN jsonb_build_object(
    'results', COALESCE(v_results, '[]'::jsonb),
    'total', v_total,
    'page', v_page,
    'page_size', v_page_size,
    'total_pages', CEIL(v_total::float / v_page_size)::int
  );
END;
$function$;
