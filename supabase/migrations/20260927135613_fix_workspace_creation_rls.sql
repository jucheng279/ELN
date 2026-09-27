/*
# Fix workspace creation RLS failure

1. Changes
   - Add DEFAULT auth.uid() to workspaces.created_by so the frontend
     doesn't need to pass the owner explicitly.
   - Create a SECURITY DEFINER trigger function that auto-inserts the
     creating user as an 'owner' member row in workspace_members
     immediately after a workspace is created.
   - Update the workspaces SELECT policy to also allow the creator
     (created_by = auth.uid()) to read the row, so that the RETURNING
     clause in INSERT … SELECT succeeds even before the trigger's
     member row is visible to the is_workspace_member() helper.

2. Root Cause
   The original INSERT … .select() call worked for the INSERT policy
   (auth.uid() = created_by) but the chained RETURNING clause evaluated
   the SELECT policy, which required is_workspace_member(id). No member
   row existed yet, so the row couldn't be read back and Supabase
   returned "new row violates row-level security policy".

3. Security
   - The trigger runs as SECURITY DEFINER so it can write to
     workspace_members regardless of the caller's policies.
   - The broadened SELECT policy still requires authentication and
     only adds the workspace creator as an additional reader.
*/

-- 1. Default created_by to the authenticated user
ALTER TABLE workspaces
  ALTER COLUMN created_by SET DEFAULT auth.uid();

-- 2. Auto-create owner membership after workspace insert
CREATE OR REPLACE FUNCTION public.handle_new_workspace()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.workspace_members (workspace_id, user_id, role)
  VALUES (NEW.id, NEW.created_by, 'owner');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_workspace_created ON workspaces;
CREATE TRIGGER on_workspace_created
  AFTER INSERT ON workspaces
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_workspace();

-- 3. Broaden the SELECT policy so the creator can always read back
DROP POLICY IF EXISTS "select_workspaces" ON workspaces;
CREATE POLICY "select_workspaces" ON workspaces FOR SELECT
  TO authenticated
  USING (
    public.is_workspace_member(id)
    OR auth.uid() = created_by
  );
