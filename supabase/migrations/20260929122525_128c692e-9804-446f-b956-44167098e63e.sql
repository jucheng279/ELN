CREATE OR REPLACE FUNCTION public.create_workspace_invitation(
  p_workspace_id uuid, p_email text, p_role text DEFAULT 'member'
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO ''
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_caller_role text;
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_inv public.workspace_invitations;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  v_caller_role := public.get_workspace_role(p_workspace_id);
  IF v_caller_role IS NULL OR v_caller_role NOT IN ('owner','admin') THEN
    RAISE EXCEPTION 'Only workspace owners or admins can invite members';
  END IF;
  IF p_role IS NULL OR p_role NOT IN ('admin','member','guest') THEN
    RAISE EXCEPTION 'Invalid role: %', p_role;
  END IF;
  IF v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' THEN
    RAISE EXCEPTION 'Invalid email address';
  END IF;

  INSERT INTO public.workspace_invitations (workspace_id, email, role, invited_by)
  VALUES (p_workspace_id, v_email, p_role, v_uid)
  RETURNING * INTO v_inv;

  RETURN jsonb_build_object(
    'id', v_inv.id, 'workspace_id', v_inv.workspace_id, 'email', v_inv.email,
    'role', v_inv.role, 'token', v_inv.token, 'expires_at', v_inv.expires_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_workspace_invitation(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_workspace_invitation(uuid, text, text) TO authenticated;

REVOKE ALL ON FUNCTION public.resubmit_for_review(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resubmit_for_review(uuid, uuid) TO authenticated;
