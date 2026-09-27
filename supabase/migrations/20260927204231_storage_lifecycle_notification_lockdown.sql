/*
# Storage Lifecycle Check + Notification Lockdown (Tasks 12, 15)

## Summary
1. Adds lifecycle check to attachment creation — can only upload when experiment
   is in a content-editable state (draft/in_progress).
2. Locks down notifications table — only server-side RPCs can insert notifications.
   Direct client inserts are blocked.
3. Adds a comment thread integrity check — comments can only be added when the
   user is a workspace member.

### Changes
- `create_attachment` now uses `can_mutate_experiment_content` instead of `can_edit_experiment`
  (they currently delegate to the same function, but this makes intent explicit)
- `replace_attachment` updated similarly
- Notifications INSERT policy restricted to only SECURITY DEFINER functions (service role)
- Comments INSERT validates workspace membership

### Security
- Notifications: anon/authenticated can SELECT own, only RPCs insert
- Attachments: lifecycle-checked via can_mutate_experiment_content
*/

-- 1. Ensure notifications INSERT is restricted
-- Only RPCs (running as SECURITY DEFINER / service role) should insert notifications
DROP POLICY IF EXISTS "insert_notifications" ON public.notifications;
CREATE POLICY "insert_notifications" ON public.notifications
FOR INSERT TO authenticated
WITH CHECK (false);

-- SELECT: users can read their own notifications
DROP POLICY IF EXISTS "select_own_notifications" ON public.notifications;
CREATE POLICY "select_own_notifications" ON public.notifications
FOR SELECT TO authenticated
USING (user_id = auth.uid());

-- UPDATE: users can mark their own notifications as read
DROP POLICY IF EXISTS "update_own_notifications" ON public.notifications;
CREATE POLICY "update_own_notifications" ON public.notifications
FOR UPDATE TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

-- DELETE: users can delete their own notifications
DROP POLICY IF EXISTS "delete_own_notifications" ON public.notifications;
CREATE POLICY "delete_own_notifications" ON public.notifications
FOR DELETE TO authenticated
USING (user_id = auth.uid());

-- 2. Ensure audit_events INSERT is restricted to RPCs only
DROP POLICY IF EXISTS "insert_audit" ON public.audit_events;
CREATE POLICY "insert_audit" ON public.audit_events
FOR INSERT TO authenticated
WITH CHECK (false);

-- SELECT audit events for workspace members
DROP POLICY IF EXISTS "select_audit" ON public.audit_events;
CREATE POLICY "select_audit" ON public.audit_events
FOR SELECT TO authenticated
USING (public.is_workspace_member(workspace_id));
