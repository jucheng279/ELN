/*
# Experiment Capabilities RPC + Full-Text Search RPC

## New Functions

### get_experiment_capabilities(p_experiment_id uuid)
Returns a jsonb object of boolean capability flags for the current authenticated
user against a specific experiment. Derives permissions from:
- Workspace membership and role
- Experiment lifecycle status, lock/archive state
- Author identity, reviewer identity, signer eligibility
- Existing can_sign_experiment / is_workspace_editor helpers

Used by the frontend to show/hide actions accurately instead of guessing.

### search_experiments(p_workspace_id uuid, ...)
Server-side full-text search with proper ts_rank ordering, server-side tag
filtering BEFORE pagination, and accurate total counts. Replaces the client-side
tag filtering and fake relevance sort.

## Security
- Both functions are SECURITY DEFINER with empty search_path
- Granted to authenticated only
- Revoked from PUBLIC and anon
*/

-- 1. get_experiment_capabilities
CREATE OR REPLACE FUNCTION public.get_experiment_capabilities(p_experiment_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_user_id uuid;
  v_exp record;
  v_role text;
  v_is_editor boolean;
  v_is_author boolean;
  v_is_mutable boolean;
  v_pending_review record;
  v_is_reviewer boolean;
  v_can_sign boolean;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RETURN jsonb_build_object(
      'can_edit_content', false, 'can_edit_metadata', false,
      'can_start', false, 'can_complete', false, 'can_reopen', false,
      'can_submit_review', false, 'can_review', false,
      'can_request_changes', false, 'can_approve', false,
      'can_sign', false, 'can_archive', false, 'can_restore', false,
      'can_restore_revision', false, 'can_create_amendment', false,
      'can_duplicate', false, 'can_comment', false, 'is_read_only', true,
      'role', 'anonymous'
    );
  END IF;

  SELECT e.*, w.id AS ws_id
  INTO v_exp
  FROM public.experiments e
  JOIN public.workspaces w ON w.id = e.workspace_id
  WHERE e.id = p_experiment_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'not_found');
  END IF;

  SELECT wm.role INTO v_role
  FROM public.workspace_members wm
  WHERE wm.workspace_id = v_exp.workspace_id AND wm.user_id = v_user_id;

  IF v_role IS NULL THEN
    RETURN jsonb_build_object(
      'can_edit_content', false, 'can_edit_metadata', false,
      'can_start', false, 'can_complete', false, 'can_reopen', false,
      'can_submit_review', false, 'can_review', false,
      'can_request_changes', false, 'can_approve', false,
      'can_sign', false, 'can_archive', false, 'can_restore', false,
      'can_restore_revision', false, 'can_create_amendment', false,
      'can_duplicate', false, 'can_comment', false, 'is_read_only', true,
      'role', 'none'
    );
  END IF;

  v_is_editor := v_role IN ('owner', 'admin', 'member');
  v_is_author := v_exp.created_by = v_user_id;
  v_is_mutable := v_exp.status IN ('draft', 'in_progress', 'changes_requested')
    AND NOT v_exp.is_locked AND NOT v_exp.is_archived;

  SELECT r.id, r.reviewer_id INTO v_pending_review
  FROM public.reviews r
  WHERE r.experiment_id = p_experiment_id AND r.status = 'pending'
  ORDER BY r.created_at DESC LIMIT 1;

  v_is_reviewer := v_pending_review.reviewer_id IS NOT NULL
    AND v_pending_review.reviewer_id = v_user_id;

  v_can_sign := v_exp.status = 'approved'
    AND NOT v_exp.is_locked
    AND v_role IN ('owner', 'admin');

  RETURN jsonb_build_object(
    'can_edit_content', v_is_editor AND v_is_mutable,
    'can_edit_metadata', v_is_editor AND v_is_mutable,
    'can_start', v_is_editor AND v_exp.status = 'draft' AND NOT v_exp.is_locked AND NOT v_exp.is_archived,
    'can_complete', v_is_editor AND v_exp.status = 'in_progress' AND NOT v_exp.is_locked,
    'can_reopen', v_is_editor AND v_exp.status = 'completed' AND NOT v_exp.is_locked AND NOT v_exp.is_archived,
    'can_submit_review', v_is_editor AND v_is_author
      AND v_exp.status IN ('completed', 'changes_requested') AND NOT v_exp.is_locked,
    'can_review', v_is_reviewer AND v_exp.status = 'in_review',
    'can_request_changes', v_is_reviewer AND v_exp.status = 'in_review',
    'can_approve', v_is_reviewer AND v_exp.status = 'in_review',
    'can_sign', v_can_sign,
    'can_archive', v_is_editor AND NOT v_exp.is_archived AND NOT v_exp.is_locked,
    'can_restore', v_is_editor AND v_exp.is_archived,
    'can_restore_revision', v_is_editor AND v_is_mutable,
    'can_create_amendment', v_is_editor AND v_exp.is_locked,
    'can_duplicate', v_is_editor,
    'can_comment', v_role != 'guest',
    'is_read_only', NOT (v_is_editor AND v_is_mutable),
    'role', v_role
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.get_experiment_capabilities(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_experiment_capabilities(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_experiment_capabilities(uuid) TO authenticated;

-- 2. search_experiments
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
  p_page int DEFAULT 1,
  p_page_size int DEFAULT 25
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  v_user_id uuid;
  v_offset int;
  v_total int;
  v_results jsonb;
  v_tsquery tsquery;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT public.is_workspace_member(p_workspace_id) THEN
    RAISE EXCEPTION 'Not a workspace member';
  END IF;

  v_offset := (GREATEST(p_page, 1) - 1) * p_page_size;

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
      CASE WHEN p_sort_by = 'relevance' AND v_tsquery IS NOT NULL
        THEN ts_rank(e.search_vector, v_tsquery) END DESC NULLS LAST,
      e.updated_at DESC
    LIMIT p_page_size OFFSET v_offset
  ) t;

  RETURN jsonb_build_object(
    'results', COALESCE(v_results, '[]'::jsonb),
    'total', v_total,
    'page', p_page,
    'page_size', p_page_size,
    'total_pages', CEIL(v_total::float / p_page_size)::int
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.search_experiments(uuid, text, text, uuid, uuid, date, date, uuid[], text, int, int) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.search_experiments(uuid, text, text, uuid, uuid, date, date, uuid[], text, int, int) FROM anon;
GRANT EXECUTE ON FUNCTION public.search_experiments(uuid, text, text, uuid, uuid, date, date, uuid[], text, int, int) TO authenticated;
