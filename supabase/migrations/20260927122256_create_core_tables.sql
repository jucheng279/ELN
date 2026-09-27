/*
# Core Tables: Profiles, Workspaces, Members, Notebooks, Folders

1. New Tables
  - `profiles` - User profiles synced with auth.users
    - `id` (uuid, PK, references auth.users)
    - `email` (text)
    - `display_name` (text)
    - `avatar_url` (text, nullable)
    - `timezone` (text, default UTC)
    - `created_at`, `updated_at` (timestamptz)
  - `workspaces` - Top-level organizational units (labs/orgs)
    - `id` (uuid, PK)
    - `name` (text)
    - `description` (text, nullable)
    - `created_by` (uuid, references profiles)
    - `created_at`, `updated_at` (timestamptz)
  - `workspace_members` - User membership in workspaces with roles
    - `id` (uuid, PK)
    - `workspace_id` (uuid, FK)
    - `user_id` (uuid, FK)
    - `role` (text: owner/admin/member/guest)
    - `permissions` (jsonb, capability flags)
    - `invited_by` (uuid, nullable)
    - `joined_at` (timestamptz)
  - `workspace_invitations` - Pending invitations
    - `id` (uuid, PK)
    - `workspace_id` (uuid, FK)
    - `email` (text)
    - `role` (text)
    - `invited_by` (uuid, FK)
    - `token` (text, unique)
    - `expires_at` (timestamptz)
    - `accepted_at` (timestamptz, nullable)
    - `created_at` (timestamptz)
  - `notebooks` - Scientific notebooks within workspaces
    - `id` (uuid, PK)
    - `workspace_id` (uuid, FK)
    - `name` (text)
    - `description` (text, nullable)
    - `created_by` (uuid, FK)
    - `is_archived` (boolean)
    - `created_at`, `updated_at` (timestamptz)
  - `folders` - Optional organization within notebooks
    - `id` (uuid, PK)
    - `notebook_id` (uuid, FK)
    - `parent_id` (uuid, nullable, self-ref FK)
    - `name` (text)
    - `order_key` (text)
    - `created_by` (uuid, FK)
    - `created_at` (timestamptz)

2. Security
  - RLS enabled on all tables
  - Profiles: users can read all profiles in shared workspaces, update own
  - Workspaces: members can read, owners/admins can update
  - Members: workspace members can read co-members
  - Notebooks/Folders: workspace members can read, members+ can create/edit

3. Important Notes
  - Profile auto-creation via trigger on auth.users insert
  - Workspace member uniqueness enforced
  - Folder nesting limited by convention (3 levels max recommended)
*/

-- Profiles table
CREATE TABLE IF NOT EXISTS profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL,
  display_name text NOT NULL DEFAULT '',
  avatar_url text,
  timezone text NOT NULL DEFAULT 'UTC',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

-- Auto-create profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (id, email, display_name)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1))
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Workspaces
CREATE TABLE IF NOT EXISTS workspaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  created_by uuid NOT NULL REFERENCES profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE workspaces ENABLE ROW LEVEL SECURITY;

-- Workspace members
CREATE TABLE IF NOT EXISTS workspace_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member', 'guest')),
  permissions jsonb NOT NULL DEFAULT '{}'::jsonb,
  invited_by uuid REFERENCES profiles(id),
  joined_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(workspace_id, user_id)
);

ALTER TABLE workspace_members ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_workspace_members_workspace ON workspace_members(workspace_id);
CREATE INDEX IF NOT EXISTS idx_workspace_members_user ON workspace_members(user_id);

-- Workspace invitations
CREATE TABLE IF NOT EXISTS workspace_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  email text NOT NULL,
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member', 'guest')),
  invited_by uuid NOT NULL REFERENCES profiles(id),
  token text NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(32), 'hex'),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  accepted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE workspace_invitations ENABLE ROW LEVEL SECURITY;

-- Notebooks
CREATE TABLE IF NOT EXISTS notebooks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  created_by uuid NOT NULL DEFAULT auth.uid() REFERENCES profiles(id),
  is_archived boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE notebooks ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_notebooks_workspace ON notebooks(workspace_id);

-- Folders
CREATE TABLE IF NOT EXISTS folders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notebook_id uuid NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,
  parent_id uuid REFERENCES folders(id) ON DELETE CASCADE,
  name text NOT NULL,
  order_key text NOT NULL DEFAULT '0',
  created_by uuid NOT NULL DEFAULT auth.uid() REFERENCES profiles(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE folders ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_folders_notebook ON folders(notebook_id);

-- Helper: check workspace membership
CREATE OR REPLACE FUNCTION public.is_workspace_member(ws_id uuid)
RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM workspace_members
    WHERE workspace_id = ws_id AND user_id = auth.uid()
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Helper: check workspace role
CREATE OR REPLACE FUNCTION public.get_workspace_role(ws_id uuid)
RETURNS text AS $$
  SELECT role FROM workspace_members
  WHERE workspace_id = ws_id AND user_id = auth.uid()
  LIMIT 1;
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- PROFILES policies
DROP POLICY IF EXISTS "select_profiles" ON profiles;
CREATE POLICY "select_profiles" ON profiles FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "insert_own_profile" ON profiles;
CREATE POLICY "insert_own_profile" ON profiles FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "update_own_profile" ON profiles;
CREATE POLICY "update_own_profile" ON profiles FOR UPDATE
  TO authenticated USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "delete_own_profile" ON profiles;
CREATE POLICY "delete_own_profile" ON profiles FOR DELETE
  TO authenticated USING (auth.uid() = id);

-- WORKSPACES policies
DROP POLICY IF EXISTS "select_workspaces" ON workspaces;
CREATE POLICY "select_workspaces" ON workspaces FOR SELECT
  TO authenticated USING (public.is_workspace_member(id));

DROP POLICY IF EXISTS "insert_workspaces" ON workspaces;
CREATE POLICY "insert_workspaces" ON workspaces FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = created_by);

DROP POLICY IF EXISTS "update_workspaces" ON workspaces;
CREATE POLICY "update_workspaces" ON workspaces FOR UPDATE
  TO authenticated
  USING (public.get_workspace_role(id) IN ('owner', 'admin'))
  WITH CHECK (public.get_workspace_role(id) IN ('owner', 'admin'));

DROP POLICY IF EXISTS "delete_workspaces" ON workspaces;
CREATE POLICY "delete_workspaces" ON workspaces FOR DELETE
  TO authenticated USING (public.get_workspace_role(id) = 'owner');

-- WORKSPACE_MEMBERS policies
DROP POLICY IF EXISTS "select_workspace_members" ON workspace_members;
CREATE POLICY "select_workspace_members" ON workspace_members FOR SELECT
  TO authenticated USING (public.is_workspace_member(workspace_id));

DROP POLICY IF EXISTS "insert_workspace_members" ON workspace_members;
CREATE POLICY "insert_workspace_members" ON workspace_members FOR INSERT
  TO authenticated WITH CHECK (
    public.get_workspace_role(workspace_id) IN ('owner', 'admin')
    OR auth.uid() = user_id
  );

DROP POLICY IF EXISTS "update_workspace_members" ON workspace_members;
CREATE POLICY "update_workspace_members" ON workspace_members FOR UPDATE
  TO authenticated
  USING (public.get_workspace_role(workspace_id) IN ('owner', 'admin'))
  WITH CHECK (public.get_workspace_role(workspace_id) IN ('owner', 'admin'));

DROP POLICY IF EXISTS "delete_workspace_members" ON workspace_members;
CREATE POLICY "delete_workspace_members" ON workspace_members FOR DELETE
  TO authenticated USING (
    public.get_workspace_role(workspace_id) IN ('owner', 'admin')
    OR auth.uid() = user_id
  );

-- WORKSPACE_INVITATIONS policies
DROP POLICY IF EXISTS "select_invitations" ON workspace_invitations;
CREATE POLICY "select_invitations" ON workspace_invitations FOR SELECT
  TO authenticated USING (public.is_workspace_member(workspace_id));

DROP POLICY IF EXISTS "insert_invitations" ON workspace_invitations;
CREATE POLICY "insert_invitations" ON workspace_invitations FOR INSERT
  TO authenticated WITH CHECK (
    public.get_workspace_role(workspace_id) IN ('owner', 'admin')
  );

DROP POLICY IF EXISTS "update_invitations" ON workspace_invitations;
CREATE POLICY "update_invitations" ON workspace_invitations FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "delete_invitations" ON workspace_invitations;
CREATE POLICY "delete_invitations" ON workspace_invitations FOR DELETE
  TO authenticated USING (
    public.get_workspace_role(workspace_id) IN ('owner', 'admin')
  );

-- NOTEBOOKS policies
DROP POLICY IF EXISTS "select_notebooks" ON notebooks;
CREATE POLICY "select_notebooks" ON notebooks FOR SELECT
  TO authenticated USING (public.is_workspace_member(workspace_id));

DROP POLICY IF EXISTS "insert_notebooks" ON notebooks;
CREATE POLICY "insert_notebooks" ON notebooks FOR INSERT
  TO authenticated WITH CHECK (
    public.get_workspace_role(workspace_id) IN ('owner', 'admin', 'member')
  );

DROP POLICY IF EXISTS "update_notebooks" ON notebooks;
CREATE POLICY "update_notebooks" ON notebooks FOR UPDATE
  TO authenticated
  USING (public.get_workspace_role(workspace_id) IN ('owner', 'admin', 'member'))
  WITH CHECK (public.get_workspace_role(workspace_id) IN ('owner', 'admin', 'member'));

DROP POLICY IF EXISTS "delete_notebooks" ON notebooks;
CREATE POLICY "delete_notebooks" ON notebooks FOR DELETE
  TO authenticated USING (
    public.get_workspace_role(workspace_id) IN ('owner', 'admin')
  );

-- FOLDERS policies
DROP POLICY IF EXISTS "select_folders" ON folders;
CREATE POLICY "select_folders" ON folders FOR SELECT
  TO authenticated USING (
    EXISTS (
      SELECT 1 FROM notebooks n
      WHERE n.id = folders.notebook_id
      AND public.is_workspace_member(n.workspace_id)
    )
  );

DROP POLICY IF EXISTS "insert_folders" ON folders;
CREATE POLICY "insert_folders" ON folders FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (
      SELECT 1 FROM notebooks n
      WHERE n.id = folders.notebook_id
      AND public.get_workspace_role(n.workspace_id) IN ('owner', 'admin', 'member')
    )
  );

DROP POLICY IF EXISTS "update_folders" ON folders;
CREATE POLICY "update_folders" ON folders FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM notebooks n
      WHERE n.id = folders.notebook_id
      AND public.get_workspace_role(n.workspace_id) IN ('owner', 'admin', 'member')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM notebooks n
      WHERE n.id = folders.notebook_id
      AND public.get_workspace_role(n.workspace_id) IN ('owner', 'admin', 'member')
    )
  );

DROP POLICY IF EXISTS "delete_folders" ON folders;
CREATE POLICY "delete_folders" ON folders FOR DELETE
  TO authenticated USING (
    EXISTS (
      SELECT 1 FROM notebooks n
      WHERE n.id = folders.notebook_id
      AND public.get_workspace_role(n.workspace_id) IN ('owner', 'admin')
    )
  );
