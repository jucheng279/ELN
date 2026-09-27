/*
# Experiments, Blocks, Revisions, Tags

1. New Tables
  - `experiments` - Core scientific experiment entries
    - `id` (uuid, PK)
    - `workspace_id` (uuid, FK)
    - `notebook_id` (uuid, FK)
    - `folder_id` (uuid, nullable FK)
    - `experiment_number` (bigint, auto-generated)
    - `experiment_id` (text, human-readable: EXP-YYYY-NNNNNN)
    - `title` (text)
    - `status` (text: draft/in_progress/completed/in_review/changes_requested/approved/locked/archived)
    - `created_by` (uuid, FK)
    - `experiment_date` (date)
    - `current_revision` (integer)
    - `is_locked` (boolean)
    - `is_archived` (boolean)
    - `template_id` / `template_version_id` for provenance
    - `search_vector` (tsvector) for full-text search
    - Various timestamps
  - `experiment_blocks` - Block-based content for experiments
    - `id` (uuid, PK)
    - `experiment_id` (uuid, FK)
    - `type` (text: paragraph/heading/list/table/image/etc.)
    - `content` (jsonb, typed block payload)
    - `order_key` (text, lexicographic ordering)
    - `created_by` / `updated_by` (uuid)
    - Various timestamps
  - `experiment_revisions` - Version checkpoints
    - `id` (uuid, PK)
    - `experiment_id` (uuid, FK)
    - `revision_number` (integer)
    - `snapshot` (jsonb, full experiment state)
    - `change_summary` (text)
    - `change_type` (text)
    - `created_by` (uuid, FK)
    - `created_at` (timestamptz)
  - `tags` - Workspace-scoped tags
    - `id` (uuid, PK)
    - `workspace_id` (uuid, FK)
    - `name` (text)
    - `color` (text, nullable)
  - `experiment_tags` - Junction table
    - `experiment_id` + `tag_id` (composite PK)
  - `experiment_contributors` - People who contributed
    - `id` (uuid, PK)
    - `experiment_id` (uuid, FK)
    - `user_id` (uuid, FK)
    - `role` (text)
  - `favorites` - Per-user experiment favorites
    - `user_id` + `experiment_id` (composite PK)
  - `recent_items` - Per-user recent experiments
    - `id` (uuid, PK)
    - `user_id` (uuid, FK)
    - `experiment_id` (uuid, FK)
    - `viewed_at` (timestamptz)

2. Security
  - RLS on all tables, workspace-member scoped
  - Experiment ID generation via database sequence + trigger

3. Important Notes
  - Experiment IDs auto-generated server-side using sequence
  - Full-text search vector auto-maintained via trigger
  - Block ordering uses lexicographic keys for efficient reordering
*/

-- Sequence for experiment numbering
CREATE SEQUENCE IF NOT EXISTS experiment_number_seq START 1;

-- Experiments
CREATE TABLE IF NOT EXISTS experiments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  notebook_id uuid NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,
  folder_id uuid REFERENCES folders(id) ON DELETE SET NULL,
  experiment_number bigint NOT NULL DEFAULT nextval('experiment_number_seq'),
  experiment_id text NOT NULL UNIQUE,
  title text NOT NULL DEFAULT 'Untitled Experiment',
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'in_progress', 'completed', 'in_review', 'changes_requested', 'approved', 'locked', 'archived')),
  created_by uuid NOT NULL DEFAULT auth.uid() REFERENCES profiles(id),
  experiment_date date NOT NULL DEFAULT CURRENT_DATE,
  current_revision integer NOT NULL DEFAULT 1,
  is_locked boolean NOT NULL DEFAULT false,
  is_archived boolean NOT NULL DEFAULT false,
  template_id uuid,
  template_version_id uuid,
  search_vector tsvector,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE experiments ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_experiments_workspace ON experiments(workspace_id);
CREATE INDEX IF NOT EXISTS idx_experiments_notebook ON experiments(notebook_id);
CREATE INDEX IF NOT EXISTS idx_experiments_created_by ON experiments(created_by);
CREATE INDEX IF NOT EXISTS idx_experiments_status ON experiments(status);
CREATE INDEX IF NOT EXISTS idx_experiments_experiment_date ON experiments(experiment_date);
CREATE INDEX IF NOT EXISTS idx_experiments_search ON experiments USING gin(search_vector);
CREATE INDEX IF NOT EXISTS idx_experiments_experiment_id ON experiments(experiment_id);

-- Auto-generate experiment_id
CREATE OR REPLACE FUNCTION public.generate_experiment_id()
RETURNS trigger AS $$
BEGIN
  NEW.experiment_id := 'EXP-' || to_char(CURRENT_DATE, 'YYYY') || '-' || lpad(NEW.experiment_number::text, 6, '0');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_experiment_id ON experiments;
CREATE TRIGGER set_experiment_id
  BEFORE INSERT ON experiments
  FOR EACH ROW EXECUTE FUNCTION public.generate_experiment_id();

-- Update search vector
CREATE OR REPLACE FUNCTION public.update_experiment_search()
RETURNS trigger AS $$
BEGIN
  NEW.search_vector := to_tsvector('english',
    coalesce(NEW.title, '') || ' ' ||
    coalesce(NEW.experiment_id, '')
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_experiment_search_trigger ON experiments;
CREATE TRIGGER update_experiment_search_trigger
  BEFORE INSERT OR UPDATE OF title ON experiments
  FOR EACH ROW EXECUTE FUNCTION public.update_experiment_search();

-- Experiment blocks
CREATE TABLE IF NOT EXISTS experiment_blocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  experiment_id uuid NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN (
    'paragraph', 'heading', 'list', 'checklist', 'callout', 'divider',
    'parameters', 'table', 'image', 'attachment', 'protocol', 'result',
    'reference', 'related_experiment', 'code'
  )),
  content jsonb NOT NULL DEFAULT '{}'::jsonb,
  order_key text NOT NULL DEFAULT '0',
  created_by uuid NOT NULL DEFAULT auth.uid() REFERENCES profiles(id),
  updated_by uuid REFERENCES profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE experiment_blocks ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_blocks_experiment ON experiment_blocks(experiment_id);
CREATE INDEX IF NOT EXISTS idx_blocks_order ON experiment_blocks(experiment_id, order_key);

-- Experiment revisions
CREATE TABLE IF NOT EXISTS experiment_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  experiment_id uuid NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
  revision_number integer NOT NULL,
  snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  content_hash text,
  change_summary text,
  change_type text NOT NULL DEFAULT 'edit' CHECK (change_type IN (
    'created', 'edit', 'checkpoint', 'status_change', 'completion',
    'review_submit', 'changes_requested', 'resubmit', 'approval',
    'signature', 'amendment', 'restoration'
  )),
  created_by uuid NOT NULL DEFAULT auth.uid() REFERENCES profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(experiment_id, revision_number)
);

ALTER TABLE experiment_revisions ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_revisions_experiment ON experiment_revisions(experiment_id);

-- Tags
CREATE TABLE IF NOT EXISTS tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  color text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(workspace_id, name)
);

ALTER TABLE tags ENABLE ROW LEVEL SECURITY;

-- Experiment tags junction
CREATE TABLE IF NOT EXISTS experiment_tags (
  experiment_id uuid NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
  tag_id uuid NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (experiment_id, tag_id)
);

ALTER TABLE experiment_tags ENABLE ROW LEVEL SECURITY;

-- Experiment contributors
CREATE TABLE IF NOT EXISTS experiment_contributors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  experiment_id uuid NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES profiles(id),
  role text NOT NULL DEFAULT 'contributor',
  added_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(experiment_id, user_id)
);

ALTER TABLE experiment_contributors ENABLE ROW LEVEL SECURITY;

-- Favorites
CREATE TABLE IF NOT EXISTS favorites (
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES profiles(id) ON DELETE CASCADE,
  experiment_id uuid NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, experiment_id)
);

ALTER TABLE favorites ENABLE ROW LEVEL SECURITY;

-- Recent items
CREATE TABLE IF NOT EXISTS recent_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES profiles(id) ON DELETE CASCADE,
  experiment_id uuid NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
  viewed_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE recent_items ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_recent_user ON recent_items(user_id, viewed_at DESC);

-- EXPERIMENTS policies
DROP POLICY IF EXISTS "select_experiments" ON experiments;
CREATE POLICY "select_experiments" ON experiments FOR SELECT
  TO authenticated USING (public.is_workspace_member(workspace_id));

DROP POLICY IF EXISTS "insert_experiments" ON experiments;
CREATE POLICY "insert_experiments" ON experiments FOR INSERT
  TO authenticated WITH CHECK (
    public.get_workspace_role(workspace_id) IN ('owner', 'admin', 'member')
  );

DROP POLICY IF EXISTS "update_experiments" ON experiments;
CREATE POLICY "update_experiments" ON experiments FOR UPDATE
  TO authenticated
  USING (public.is_workspace_member(workspace_id))
  WITH CHECK (public.is_workspace_member(workspace_id));

DROP POLICY IF EXISTS "delete_experiments" ON experiments;
CREATE POLICY "delete_experiments" ON experiments FOR DELETE
  TO authenticated USING (
    public.get_workspace_role(workspace_id) IN ('owner', 'admin')
  );

-- EXPERIMENT_BLOCKS policies
DROP POLICY IF EXISTS "select_blocks" ON experiment_blocks;
CREATE POLICY "select_blocks" ON experiment_blocks FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM experiments e WHERE e.id = experiment_blocks.experiment_id AND public.is_workspace_member(e.workspace_id))
  );

DROP POLICY IF EXISTS "insert_blocks" ON experiment_blocks;
CREATE POLICY "insert_blocks" ON experiment_blocks FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM experiments e WHERE e.id = experiment_blocks.experiment_id AND public.is_workspace_member(e.workspace_id))
  );

DROP POLICY IF EXISTS "update_blocks" ON experiment_blocks;
CREATE POLICY "update_blocks" ON experiment_blocks FOR UPDATE
  TO authenticated
  USING (EXISTS (SELECT 1 FROM experiments e WHERE e.id = experiment_blocks.experiment_id AND public.is_workspace_member(e.workspace_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM experiments e WHERE e.id = experiment_blocks.experiment_id AND public.is_workspace_member(e.workspace_id)));

DROP POLICY IF EXISTS "delete_blocks" ON experiment_blocks;
CREATE POLICY "delete_blocks" ON experiment_blocks FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM experiments e WHERE e.id = experiment_blocks.experiment_id AND public.is_workspace_member(e.workspace_id))
  );

-- REVISIONS policies
DROP POLICY IF EXISTS "select_revisions" ON experiment_revisions;
CREATE POLICY "select_revisions" ON experiment_revisions FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM experiments e WHERE e.id = experiment_revisions.experiment_id AND public.is_workspace_member(e.workspace_id))
  );

DROP POLICY IF EXISTS "insert_revisions" ON experiment_revisions;
CREATE POLICY "insert_revisions" ON experiment_revisions FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM experiments e WHERE e.id = experiment_revisions.experiment_id AND public.is_workspace_member(e.workspace_id))
  );

DROP POLICY IF EXISTS "update_revisions" ON experiment_revisions;
CREATE POLICY "update_revisions" ON experiment_revisions FOR UPDATE
  TO authenticated
  USING (EXISTS (SELECT 1 FROM experiments e WHERE e.id = experiment_revisions.experiment_id AND public.is_workspace_member(e.workspace_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM experiments e WHERE e.id = experiment_revisions.experiment_id AND public.is_workspace_member(e.workspace_id)));

DROP POLICY IF EXISTS "delete_revisions" ON experiment_revisions;
CREATE POLICY "delete_revisions" ON experiment_revisions FOR DELETE
  TO authenticated USING (false);

-- TAGS policies
DROP POLICY IF EXISTS "select_tags" ON tags;
CREATE POLICY "select_tags" ON tags FOR SELECT
  TO authenticated USING (public.is_workspace_member(workspace_id));

DROP POLICY IF EXISTS "insert_tags" ON tags;
CREATE POLICY "insert_tags" ON tags FOR INSERT
  TO authenticated WITH CHECK (public.is_workspace_member(workspace_id));

DROP POLICY IF EXISTS "update_tags" ON tags;
CREATE POLICY "update_tags" ON tags FOR UPDATE
  TO authenticated USING (public.is_workspace_member(workspace_id)) WITH CHECK (public.is_workspace_member(workspace_id));

DROP POLICY IF EXISTS "delete_tags" ON tags;
CREATE POLICY "delete_tags" ON tags FOR DELETE
  TO authenticated USING (public.get_workspace_role(workspace_id) IN ('owner', 'admin'));

-- EXPERIMENT_TAGS policies
DROP POLICY IF EXISTS "select_exp_tags" ON experiment_tags;
CREATE POLICY "select_exp_tags" ON experiment_tags FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM experiments e WHERE e.id = experiment_tags.experiment_id AND public.is_workspace_member(e.workspace_id))
  );

DROP POLICY IF EXISTS "insert_exp_tags" ON experiment_tags;
CREATE POLICY "insert_exp_tags" ON experiment_tags FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM experiments e WHERE e.id = experiment_tags.experiment_id AND public.is_workspace_member(e.workspace_id))
  );

DROP POLICY IF EXISTS "update_exp_tags" ON experiment_tags;
CREATE POLICY "update_exp_tags" ON experiment_tags FOR UPDATE
  TO authenticated
  USING (EXISTS (SELECT 1 FROM experiments e WHERE e.id = experiment_tags.experiment_id AND public.is_workspace_member(e.workspace_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM experiments e WHERE e.id = experiment_tags.experiment_id AND public.is_workspace_member(e.workspace_id)));

DROP POLICY IF EXISTS "delete_exp_tags" ON experiment_tags;
CREATE POLICY "delete_exp_tags" ON experiment_tags FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM experiments e WHERE e.id = experiment_tags.experiment_id AND public.is_workspace_member(e.workspace_id))
  );

-- CONTRIBUTORS policies
DROP POLICY IF EXISTS "select_contributors" ON experiment_contributors;
CREATE POLICY "select_contributors" ON experiment_contributors FOR SELECT
  TO authenticated USING (
    EXISTS (SELECT 1 FROM experiments e WHERE e.id = experiment_contributors.experiment_id AND public.is_workspace_member(e.workspace_id))
  );

DROP POLICY IF EXISTS "insert_contributors" ON experiment_contributors;
CREATE POLICY "insert_contributors" ON experiment_contributors FOR INSERT
  TO authenticated WITH CHECK (
    EXISTS (SELECT 1 FROM experiments e WHERE e.id = experiment_contributors.experiment_id AND public.is_workspace_member(e.workspace_id))
  );

DROP POLICY IF EXISTS "update_contributors" ON experiment_contributors;
CREATE POLICY "update_contributors" ON experiment_contributors FOR UPDATE
  TO authenticated
  USING (EXISTS (SELECT 1 FROM experiments e WHERE e.id = experiment_contributors.experiment_id AND public.is_workspace_member(e.workspace_id)))
  WITH CHECK (EXISTS (SELECT 1 FROM experiments e WHERE e.id = experiment_contributors.experiment_id AND public.is_workspace_member(e.workspace_id)));

DROP POLICY IF EXISTS "delete_contributors" ON experiment_contributors;
CREATE POLICY "delete_contributors" ON experiment_contributors FOR DELETE
  TO authenticated USING (
    EXISTS (SELECT 1 FROM experiments e WHERE e.id = experiment_contributors.experiment_id AND public.is_workspace_member(e.workspace_id))
  );

-- FAVORITES policies
DROP POLICY IF EXISTS "select_favorites" ON favorites;
CREATE POLICY "select_favorites" ON favorites FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "insert_favorites" ON favorites;
CREATE POLICY "insert_favorites" ON favorites FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_favorites" ON favorites;
CREATE POLICY "update_favorites" ON favorites FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "delete_favorites" ON favorites;
CREATE POLICY "delete_favorites" ON favorites FOR DELETE
  TO authenticated USING (auth.uid() = user_id);

-- RECENT_ITEMS policies
DROP POLICY IF EXISTS "select_recent" ON recent_items;
CREATE POLICY "select_recent" ON recent_items FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "insert_recent" ON recent_items;
CREATE POLICY "insert_recent" ON recent_items FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "update_recent" ON recent_items;
CREATE POLICY "update_recent" ON recent_items FOR UPDATE
  TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "delete_recent" ON recent_items;
CREATE POLICY "delete_recent" ON recent_items FOR DELETE
  TO authenticated USING (auth.uid() = user_id);
