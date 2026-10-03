-- Settings/admin convergence: close admin->owner escalation, member-row retargeting, and invitation token disclosure.
DROP POLICY IF EXISTS insert_workspace_members ON public.workspace_members;
CREATE POLICY insert_workspace_members ON public.workspace_members FOR INSERT TO authenticated
  WITH CHECK (public.get_workspace_role(workspace_id) = ANY (ARRAY['owner','admin'])
              AND (role <> 'owner' OR public.get_workspace_role(workspace_id) = 'owner'));

DROP POLICY IF EXISTS update_workspace_members ON public.workspace_members;
CREATE POLICY update_workspace_members ON public.workspace_members FOR UPDATE TO authenticated
  USING (public.get_workspace_role(workspace_id) = ANY (ARRAY['owner','admin'])
         AND (role <> 'owner' OR public.get_workspace_role(workspace_id) = 'owner'))
  WITH CHECK (public.get_workspace_role(workspace_id) = ANY (ARRAY['owner','admin'])
              AND (role <> 'owner' OR public.get_workspace_role(workspace_id) = 'owner'));

DROP POLICY IF EXISTS delete_workspace_members ON public.workspace_members;
CREATE POLICY delete_workspace_members ON public.workspace_members FOR DELETE TO authenticated
  USING (auth.uid() = user_id
         OR (public.get_workspace_role(workspace_id) = ANY (ARRAY['owner','admin'])
             AND (role <> 'owner' OR public.get_workspace_role(workspace_id) = 'owner')));

-- Only role/permissions are client-mutable; identity columns are immutable.
REVOKE UPDATE ON public.workspace_members FROM authenticated, anon;
GRANT UPDATE (role, permissions) ON public.workspace_members TO authenticated;

DROP POLICY IF EXISTS select_invitations ON public.workspace_invitations;
CREATE POLICY select_invitations ON public.workspace_invitations FOR SELECT TO authenticated
  USING (public.get_workspace_role(workspace_id) = ANY (ARRAY['owner','admin']));

DROP POLICY IF EXISTS insert_invitations ON public.workspace_invitations;
CREATE POLICY insert_invitations ON public.workspace_invitations FOR INSERT TO authenticated
  WITH CHECK (public.get_workspace_role(workspace_id) = ANY (ARRAY['owner','admin']) AND role <> 'owner');

DROP POLICY IF EXISTS update_invitations ON public.workspace_invitations;
CREATE POLICY update_invitations ON public.workspace_invitations FOR UPDATE TO authenticated
  USING (public.get_workspace_role(workspace_id) = ANY (ARRAY['owner','admin']))
  WITH CHECK (public.get_workspace_role(workspace_id) = ANY (ARRAY['owner','admin']) AND role <> 'owner');
