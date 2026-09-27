/*
# Templates, Protocols, Comments, Reviews, Signatures, Audit

1. New Tables
  - `templates` - Reusable experiment templates
  - `template_versions` - Versioned template content
  - `protocols` - Reusable scientific protocols/methods
  - `protocol_versions` - Versioned protocol content with steps
  - `experiment_protocols` - Protocol instances within experiments
  - `protocol_deviations` - Deviations from protocol steps
  - `experiment_relations` - Links between experiments
  - `experiment_references` - Scientific references (DOI, URL)
  - `attachments` - File attachments with versioning
  - `attachment_versions` - Historical attachment versions
  - `comment_threads` - Comment threads on experiments/blocks
  - `comments` - Individual comments within threads
  - `mentions` - @mentions linking comments to users
  - `notifications` - User notification center
  - `reviews` - Formal review records
  - `signatures` - Electronic approval signatures
  - `audit_events` - Immutable audit trail

2. Security
  - RLS on all tables, workspace-scoped via experiment ownership
  - Audit events: insert-only, no update/delete for regular users
  - Signatures: insert-only after creation

3. Important Notes
  - Template/protocol versions are immutable once published
  - Audit events form append-only log
  - Signatures record exact revision + content hash
*/

-- Templates
CREATE TABLE IF NOT EXISTS templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  category text,
  current_version integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  created_by uuid NOT NULL DEFAULT auth.uid() REFERENCES profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE templates ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_templates_workspace ON templates(workspace_id);

-- Template versions
CREATE TABLE IF NOT EXISTS template_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
  version_number integer NOT NULL,
  content jsonb NOT NULL DEFAULT '[]'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'superseded', 'archived')),
  published_at timestamptz,
  created_by uuid NOT NULL DEFAULT auth.uid() REFERENCES profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(template_id, version_number)
);
ALTER TABLE template_versions ENABLE ROW LEVEL SECURITY;

-- Protocols
CREATE TABLE IF NOT EXISTS protocols (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  category text,
  current_version integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  created_by uuid NOT NULL DEFAULT auth.uid() REFERENCES profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE protocols ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_protocols_workspace ON protocols(workspace_id);

-- Protocol versions
CREATE TABLE IF NOT EXISTS protocol_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  protocol_id uuid NOT NULL REFERENCES protocols(id) ON DELETE CASCADE,
  version_number integer NOT NULL,
  steps jsonb NOT NULL DEFAULT '[]'::jsonb,
  parameters jsonb NOT NULL DEFAULT '[]'::jsonb,
  notes text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'superseded', 'archived')),
  published_at timestamptz,
  created_by uuid NOT NULL DEFAULT auth.uid() REFERENCES profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(protocol_id, version_number)
);
ALTER TABLE protocol_versions ENABLE ROW LEVEL SECURITY;

-- Experiment protocol instances
CREATE TABLE IF NOT EXISTS experiment_protocols (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  experiment_id uuid NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
  protocol_id uuid NOT NULL REFERENCES protocols(id),
  protocol_version_id uuid NOT NULL REFERENCES protocol_versions(id),
  snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE experiment_protocols ENABLE ROW LEVEL SECURITY;

-- Protocol deviations
CREATE TABLE IF NOT EXISTS protocol_deviations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  experiment_protocol_id uuid NOT NULL REFERENCES experiment_protocols(id) ON DELETE CASCADE,
  step_index integer NOT NULL,
  original_value text NOT NULL,
  actual_value text NOT NULL,
  reason text,
  created_by uuid NOT NULL DEFAULT auth.uid() REFERENCES profiles(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE protocol_deviations ENABLE ROW LEVEL SECURITY;

-- Experiment relations
CREATE TABLE IF NOT EXISTS experiment_relations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_experiment_id uuid NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
  target_experiment_id uuid NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
  relation_type text NOT NULL DEFAULT 'related' CHECK (relation_type IN ('related', 'follow_up', 'depends_on', 'continuation')),
  created_by uuid NOT NULL DEFAULT auth.uid() REFERENCES profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(source_experiment_id, target_experiment_id)
);
ALTER TABLE experiment_relations ENABLE ROW LEVEL SECURITY;

-- Scientific references
CREATE TABLE IF NOT EXISTS experiment_references (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  experiment_id uuid NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
  doi text,
  url text,
  title text,
  citation text,
  notes text,
  created_by uuid NOT NULL DEFAULT auth.uid() REFERENCES profiles(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE experiment_references ENABLE ROW LEVEL SECURITY;

-- Attachments
CREATE TABLE IF NOT EXISTS attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  experiment_id uuid NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
  original_filename text NOT NULL,
  display_name text NOT NULL,
  storage_path text NOT NULL,
  mime_type text,
  file_size bigint,
  checksum text,
  current_version integer NOT NULL DEFAULT 1,
  uploaded_by uuid NOT NULL DEFAULT auth.uid() REFERENCES profiles(id),
  is_archived boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE attachments ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_attachments_experiment ON attachments(experiment_id);

-- Attachment versions
CREATE TABLE IF NOT EXISTS attachment_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attachment_id uuid NOT NULL REFERENCES attachments(id) ON DELETE CASCADE,
  version_number integer NOT NULL,
  storage_path text NOT NULL,
  file_size bigint,
  checksum text,
  uploaded_by uuid NOT NULL DEFAULT auth.uid() REFERENCES profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(attachment_id, version_number)
);
ALTER TABLE attachment_versions ENABLE ROW LEVEL SECURITY;

-- Comment threads
CREATE TABLE IF NOT EXISTS comment_threads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  experiment_id uuid NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
  block_id uuid REFERENCES experiment_blocks(id) ON DELETE SET NULL,
  is_resolved boolean NOT NULL DEFAULT false,
  resolved_by uuid REFERENCES profiles(id),
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE comment_threads ENABLE ROW LEVEL SECURITY;

-- Comments
CREATE TABLE IF NOT EXISTS comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id uuid NOT NULL REFERENCES comment_threads(id) ON DELETE CASCADE,
  content text NOT NULL,
  created_by uuid NOT NULL DEFAULT auth.uid() REFERENCES profiles(id),
  is_edited boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE comments ENABLE ROW LEVEL SECURITY;

-- Mentions
CREATE TABLE IF NOT EXISTS mentions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  comment_id uuid NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES profiles(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE mentions ENABLE ROW LEVEL SECURITY;

-- Notifications
CREATE TABLE IF NOT EXISTS notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('mention', 'comment_reply', 'review_requested', 'changes_requested', 'approved', 'permission_change')),
  title text NOT NULL,
  body text,
  experiment_id uuid REFERENCES experiments(id) ON DELETE CASCADE,
  is_read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, is_read, created_at DESC);

-- Reviews
CREATE TABLE IF NOT EXISTS reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  experiment_id uuid NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
  reviewer_id uuid NOT NULL REFERENCES profiles(id),
  revision_number integer NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'changes_requested')),
  comment text,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE reviews ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_reviews_experiment ON reviews(experiment_id);

-- Signatures
CREATE TABLE IF NOT EXISTS signatures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  experiment_id uuid NOT NULL REFERENCES experiments(id) ON DELETE CASCADE,
  signer_id uuid NOT NULL REFERENCES profiles(id),
  revision_number integer NOT NULL,
  content_hash text,
  declaration text NOT NULL DEFAULT 'I approve and sign this experiment record.',
  signed_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE signatures ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_signatures_experiment ON signatures(experiment_id);

-- Audit events (append-only)
CREATE TABLE IF NOT EXISTS audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  object_type text NOT NULL,
  object_id uuid NOT NULL,
  event_type text NOT NULL,
  actor_id uuid NOT NULL REFERENCES profiles(id),
  revision_number integer,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS idx_audit_workspace ON audit_events(workspace_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_object ON audit_events(object_type, object_id, created_at DESC);

-- RLS POLICIES for all new tables

-- Templates
DROP POLICY IF EXISTS "select_templates" ON templates;
CREATE POLICY "select_templates" ON templates FOR SELECT TO authenticated USING (public.is_workspace_member(workspace_id));
DROP POLICY IF EXISTS "insert_templates" ON templates;
CREATE POLICY "insert_templates" ON templates FOR INSERT TO authenticated WITH CHECK (public.get_workspace_role(workspace_id) IN ('owner', 'admin', 'member'));
DROP POLICY IF EXISTS "update_templates" ON templates;
CREATE POLICY "update_templates" ON templates FOR UPDATE TO authenticated USING (public.is_workspace_member(workspace_id)) WITH CHECK (public.is_workspace_member(workspace_id));
DROP POLICY IF EXISTS "delete_templates" ON templates;
CREATE POLICY "delete_templates" ON templates FOR DELETE TO authenticated USING (public.get_workspace_role(workspace_id) IN ('owner', 'admin'));

-- Template versions
DROP POLICY IF EXISTS "select_tv" ON template_versions;
CREATE POLICY "select_tv" ON template_versions FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM templates t WHERE t.id = template_versions.template_id AND public.is_workspace_member(t.workspace_id)));
DROP POLICY IF EXISTS "insert_tv" ON template_versions;
CREATE POLICY "insert_tv" ON template_versions FOR INSERT TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM templates t WHERE t.id = template_versions.template_id AND public.is_workspace_member(t.workspace_id)));
DROP POLICY IF EXISTS "update_tv" ON template_versions;
CREATE POLICY "update_tv" ON template_versions FOR UPDATE TO authenticated USING (EXISTS (SELECT 1 FROM templates t WHERE t.id = template_versions.template_id AND public.is_workspace_member(t.workspace_id))) WITH CHECK (EXISTS (SELECT 1 FROM templates t WHERE t.id = template_versions.template_id AND public.is_workspace_member(t.workspace_id)));
DROP POLICY IF EXISTS "delete_tv" ON template_versions;
CREATE POLICY "delete_tv" ON template_versions FOR DELETE TO authenticated USING (false);

-- Protocols
DROP POLICY IF EXISTS "select_protocols" ON protocols;
CREATE POLICY "select_protocols" ON protocols FOR SELECT TO authenticated USING (public.is_workspace_member(workspace_id));
DROP POLICY IF EXISTS "insert_protocols" ON protocols;
CREATE POLICY "insert_protocols" ON protocols FOR INSERT TO authenticated WITH CHECK (public.get_workspace_role(workspace_id) IN ('owner', 'admin', 'member'));
DROP POLICY IF EXISTS "update_protocols" ON protocols;
CREATE POLICY "update_protocols" ON protocols FOR UPDATE TO authenticated USING (public.is_workspace_member(workspace_id)) WITH CHECK (public.is_workspace_member(workspace_id));
DROP POLICY IF EXISTS "delete_protocols" ON protocols;
CREATE POLICY "delete_protocols" ON protocols FOR DELETE TO authenticated USING (public.get_workspace_role(workspace_id) IN ('owner', 'admin'));

-- Protocol versions
DROP POLICY IF EXISTS "select_pv" ON protocol_versions;
CREATE POLICY "select_pv" ON protocol_versions FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM protocols p WHERE p.id = protocol_versions.protocol_id AND public.is_workspace_member(p.workspace_id)));
DROP POLICY IF EXISTS "insert_pv" ON protocol_versions;
CREATE POLICY "insert_pv" ON protocol_versions FOR INSERT TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM protocols p WHERE p.id = protocol_versions.protocol_id AND public.is_workspace_member(p.workspace_id)));
DROP POLICY IF EXISTS "update_pv" ON protocol_versions;
CREATE POLICY "update_pv" ON protocol_versions FOR UPDATE TO authenticated USING (EXISTS (SELECT 1 FROM protocols p WHERE p.id = protocol_versions.protocol_id AND public.is_workspace_member(p.workspace_id))) WITH CHECK (EXISTS (SELECT 1 FROM protocols p WHERE p.id = protocol_versions.protocol_id AND public.is_workspace_member(p.workspace_id)));
DROP POLICY IF EXISTS "delete_pv" ON protocol_versions;
CREATE POLICY "delete_pv" ON protocol_versions FOR DELETE TO authenticated USING (false);

-- Experiment protocols
DROP POLICY IF EXISTS "select_ep" ON experiment_protocols;
CREATE POLICY "select_ep" ON experiment_protocols FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM experiments e WHERE e.id = experiment_protocols.experiment_id AND public.is_workspace_member(e.workspace_id)));
DROP POLICY IF EXISTS "insert_ep" ON experiment_protocols;
CREATE POLICY "insert_ep" ON experiment_protocols FOR INSERT TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM experiments e WHERE e.id = experiment_protocols.experiment_id AND public.is_workspace_member(e.workspace_id)));
DROP POLICY IF EXISTS "update_ep" ON experiment_protocols;
CREATE POLICY "update_ep" ON experiment_protocols FOR UPDATE TO authenticated USING (EXISTS (SELECT 1 FROM experiments e WHERE e.id = experiment_protocols.experiment_id AND public.is_workspace_member(e.workspace_id))) WITH CHECK (EXISTS (SELECT 1 FROM experiments e WHERE e.id = experiment_protocols.experiment_id AND public.is_workspace_member(e.workspace_id)));
DROP POLICY IF EXISTS "delete_ep" ON experiment_protocols;
CREATE POLICY "delete_ep" ON experiment_protocols FOR DELETE TO authenticated USING (EXISTS (SELECT 1 FROM experiments e WHERE e.id = experiment_protocols.experiment_id AND public.is_workspace_member(e.workspace_id)));

-- Protocol deviations
DROP POLICY IF EXISTS "select_pd" ON protocol_deviations;
CREATE POLICY "select_pd" ON protocol_deviations FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM experiment_protocols ep JOIN experiments e ON e.id = ep.experiment_id WHERE ep.id = protocol_deviations.experiment_protocol_id AND public.is_workspace_member(e.workspace_id)));
DROP POLICY IF EXISTS "insert_pd" ON protocol_deviations;
CREATE POLICY "insert_pd" ON protocol_deviations FOR INSERT TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM experiment_protocols ep JOIN experiments e ON e.id = ep.experiment_id WHERE ep.id = protocol_deviations.experiment_protocol_id AND public.is_workspace_member(e.workspace_id)));
DROP POLICY IF EXISTS "update_pd" ON protocol_deviations;
CREATE POLICY "update_pd" ON protocol_deviations FOR UPDATE TO authenticated USING (EXISTS (SELECT 1 FROM experiment_protocols ep JOIN experiments e ON e.id = ep.experiment_id WHERE ep.id = protocol_deviations.experiment_protocol_id AND public.is_workspace_member(e.workspace_id))) WITH CHECK (EXISTS (SELECT 1 FROM experiment_protocols ep JOIN experiments e ON e.id = ep.experiment_id WHERE ep.id = protocol_deviations.experiment_protocol_id AND public.is_workspace_member(e.workspace_id)));
DROP POLICY IF EXISTS "delete_pd" ON protocol_deviations;
CREATE POLICY "delete_pd" ON protocol_deviations FOR DELETE TO authenticated USING (EXISTS (SELECT 1 FROM experiment_protocols ep JOIN experiments e ON e.id = ep.experiment_id WHERE ep.id = protocol_deviations.experiment_protocol_id AND public.is_workspace_member(e.workspace_id)));

-- Experiment relations
DROP POLICY IF EXISTS "select_er" ON experiment_relations;
CREATE POLICY "select_er" ON experiment_relations FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM experiments e WHERE e.id = experiment_relations.source_experiment_id AND public.is_workspace_member(e.workspace_id)));
DROP POLICY IF EXISTS "insert_er" ON experiment_relations;
CREATE POLICY "insert_er" ON experiment_relations FOR INSERT TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM experiments e WHERE e.id = experiment_relations.source_experiment_id AND public.is_workspace_member(e.workspace_id)));
DROP POLICY IF EXISTS "update_er" ON experiment_relations;
CREATE POLICY "update_er" ON experiment_relations FOR UPDATE TO authenticated USING (EXISTS (SELECT 1 FROM experiments e WHERE e.id = experiment_relations.source_experiment_id AND public.is_workspace_member(e.workspace_id))) WITH CHECK (EXISTS (SELECT 1 FROM experiments e WHERE e.id = experiment_relations.source_experiment_id AND public.is_workspace_member(e.workspace_id)));
DROP POLICY IF EXISTS "delete_er" ON experiment_relations;
CREATE POLICY "delete_er" ON experiment_relations FOR DELETE TO authenticated USING (EXISTS (SELECT 1 FROM experiments e WHERE e.id = experiment_relations.source_experiment_id AND public.is_workspace_member(e.workspace_id)));

-- Experiment references
DROP POLICY IF EXISTS "select_ref" ON experiment_references;
CREATE POLICY "select_ref" ON experiment_references FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM experiments e WHERE e.id = experiment_references.experiment_id AND public.is_workspace_member(e.workspace_id)));
DROP POLICY IF EXISTS "insert_ref" ON experiment_references;
CREATE POLICY "insert_ref" ON experiment_references FOR INSERT TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM experiments e WHERE e.id = experiment_references.experiment_id AND public.is_workspace_member(e.workspace_id)));
DROP POLICY IF EXISTS "update_ref" ON experiment_references;
CREATE POLICY "update_ref" ON experiment_references FOR UPDATE TO authenticated USING (EXISTS (SELECT 1 FROM experiments e WHERE e.id = experiment_references.experiment_id AND public.is_workspace_member(e.workspace_id))) WITH CHECK (EXISTS (SELECT 1 FROM experiments e WHERE e.id = experiment_references.experiment_id AND public.is_workspace_member(e.workspace_id)));
DROP POLICY IF EXISTS "delete_ref" ON experiment_references;
CREATE POLICY "delete_ref" ON experiment_references FOR DELETE TO authenticated USING (EXISTS (SELECT 1 FROM experiments e WHERE e.id = experiment_references.experiment_id AND public.is_workspace_member(e.workspace_id)));

-- Attachments
DROP POLICY IF EXISTS "select_attach" ON attachments;
CREATE POLICY "select_attach" ON attachments FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM experiments e WHERE e.id = attachments.experiment_id AND public.is_workspace_member(e.workspace_id)));
DROP POLICY IF EXISTS "insert_attach" ON attachments;
CREATE POLICY "insert_attach" ON attachments FOR INSERT TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM experiments e WHERE e.id = attachments.experiment_id AND public.is_workspace_member(e.workspace_id)));
DROP POLICY IF EXISTS "update_attach" ON attachments;
CREATE POLICY "update_attach" ON attachments FOR UPDATE TO authenticated USING (EXISTS (SELECT 1 FROM experiments e WHERE e.id = attachments.experiment_id AND public.is_workspace_member(e.workspace_id))) WITH CHECK (EXISTS (SELECT 1 FROM experiments e WHERE e.id = attachments.experiment_id AND public.is_workspace_member(e.workspace_id)));
DROP POLICY IF EXISTS "delete_attach" ON attachments;
CREATE POLICY "delete_attach" ON attachments FOR DELETE TO authenticated USING (EXISTS (SELECT 1 FROM experiments e WHERE e.id = attachments.experiment_id AND public.is_workspace_member(e.workspace_id)));

-- Attachment versions
DROP POLICY IF EXISTS "select_av" ON attachment_versions;
CREATE POLICY "select_av" ON attachment_versions FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM attachments a JOIN experiments e ON e.id = a.experiment_id WHERE a.id = attachment_versions.attachment_id AND public.is_workspace_member(e.workspace_id)));
DROP POLICY IF EXISTS "insert_av" ON attachment_versions;
CREATE POLICY "insert_av" ON attachment_versions FOR INSERT TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM attachments a JOIN experiments e ON e.id = a.experiment_id WHERE a.id = attachment_versions.attachment_id AND public.is_workspace_member(e.workspace_id)));
DROP POLICY IF EXISTS "update_av" ON attachment_versions;
CREATE POLICY "update_av" ON attachment_versions FOR UPDATE TO authenticated USING (false) WITH CHECK (false);
DROP POLICY IF EXISTS "delete_av" ON attachment_versions;
CREATE POLICY "delete_av" ON attachment_versions FOR DELETE TO authenticated USING (false);

-- Comment threads
DROP POLICY IF EXISTS "select_ct" ON comment_threads;
CREATE POLICY "select_ct" ON comment_threads FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM experiments e WHERE e.id = comment_threads.experiment_id AND public.is_workspace_member(e.workspace_id)));
DROP POLICY IF EXISTS "insert_ct" ON comment_threads;
CREATE POLICY "insert_ct" ON comment_threads FOR INSERT TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM experiments e WHERE e.id = comment_threads.experiment_id AND public.is_workspace_member(e.workspace_id)));
DROP POLICY IF EXISTS "update_ct" ON comment_threads;
CREATE POLICY "update_ct" ON comment_threads FOR UPDATE TO authenticated USING (EXISTS (SELECT 1 FROM experiments e WHERE e.id = comment_threads.experiment_id AND public.is_workspace_member(e.workspace_id))) WITH CHECK (EXISTS (SELECT 1 FROM experiments e WHERE e.id = comment_threads.experiment_id AND public.is_workspace_member(e.workspace_id)));
DROP POLICY IF EXISTS "delete_ct" ON comment_threads;
CREATE POLICY "delete_ct" ON comment_threads FOR DELETE TO authenticated USING (false);

-- Comments
DROP POLICY IF EXISTS "select_comments" ON comments;
CREATE POLICY "select_comments" ON comments FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM comment_threads ct JOIN experiments e ON e.id = ct.experiment_id WHERE ct.id = comments.thread_id AND public.is_workspace_member(e.workspace_id)));
DROP POLICY IF EXISTS "insert_comments" ON comments;
CREATE POLICY "insert_comments" ON comments FOR INSERT TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM comment_threads ct JOIN experiments e ON e.id = ct.experiment_id WHERE ct.id = comments.thread_id AND public.is_workspace_member(e.workspace_id)));
DROP POLICY IF EXISTS "update_comments" ON comments;
CREATE POLICY "update_comments" ON comments FOR UPDATE TO authenticated USING (auth.uid() = created_by) WITH CHECK (auth.uid() = created_by);
DROP POLICY IF EXISTS "delete_comments" ON comments;
CREATE POLICY "delete_comments" ON comments FOR DELETE TO authenticated USING (auth.uid() = created_by);

-- Mentions
DROP POLICY IF EXISTS "select_mentions" ON mentions;
CREATE POLICY "select_mentions" ON mentions FOR SELECT TO authenticated USING (auth.uid() = user_id OR EXISTS (SELECT 1 FROM comments c JOIN comment_threads ct ON ct.id = c.thread_id JOIN experiments e ON e.id = ct.experiment_id WHERE c.id = mentions.comment_id AND public.is_workspace_member(e.workspace_id)));
DROP POLICY IF EXISTS "insert_mentions" ON mentions;
CREATE POLICY "insert_mentions" ON mentions FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "update_mentions" ON mentions;
CREATE POLICY "update_mentions" ON mentions FOR UPDATE TO authenticated USING (false) WITH CHECK (false);
DROP POLICY IF EXISTS "delete_mentions" ON mentions;
CREATE POLICY "delete_mentions" ON mentions FOR DELETE TO authenticated USING (false);

-- Notifications
DROP POLICY IF EXISTS "select_notif" ON notifications;
CREATE POLICY "select_notif" ON notifications FOR SELECT TO authenticated USING (auth.uid() = user_id);
DROP POLICY IF EXISTS "insert_notif" ON notifications;
CREATE POLICY "insert_notif" ON notifications FOR INSERT TO authenticated WITH CHECK (true);
DROP POLICY IF EXISTS "update_notif" ON notifications;
CREATE POLICY "update_notif" ON notifications FOR UPDATE TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
DROP POLICY IF EXISTS "delete_notif" ON notifications;
CREATE POLICY "delete_notif" ON notifications FOR DELETE TO authenticated USING (auth.uid() = user_id);

-- Reviews
DROP POLICY IF EXISTS "select_reviews" ON reviews;
CREATE POLICY "select_reviews" ON reviews FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM experiments e WHERE e.id = reviews.experiment_id AND public.is_workspace_member(e.workspace_id)));
DROP POLICY IF EXISTS "insert_reviews" ON reviews;
CREATE POLICY "insert_reviews" ON reviews FOR INSERT TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM experiments e WHERE e.id = reviews.experiment_id AND public.is_workspace_member(e.workspace_id)));
DROP POLICY IF EXISTS "update_reviews" ON reviews;
CREATE POLICY "update_reviews" ON reviews FOR UPDATE TO authenticated USING (auth.uid() = reviewer_id) WITH CHECK (auth.uid() = reviewer_id);
DROP POLICY IF EXISTS "delete_reviews" ON reviews;
CREATE POLICY "delete_reviews" ON reviews FOR DELETE TO authenticated USING (false);

-- Signatures
DROP POLICY IF EXISTS "select_sigs" ON signatures;
CREATE POLICY "select_sigs" ON signatures FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM experiments e WHERE e.id = signatures.experiment_id AND public.is_workspace_member(e.workspace_id)));
DROP POLICY IF EXISTS "insert_sigs" ON signatures;
CREATE POLICY "insert_sigs" ON signatures FOR INSERT TO authenticated WITH CHECK (EXISTS (SELECT 1 FROM experiments e WHERE e.id = signatures.experiment_id AND public.is_workspace_member(e.workspace_id)));
DROP POLICY IF EXISTS "update_sigs" ON signatures;
CREATE POLICY "update_sigs" ON signatures FOR UPDATE TO authenticated USING (false) WITH CHECK (false);
DROP POLICY IF EXISTS "delete_sigs" ON signatures;
CREATE POLICY "delete_sigs" ON signatures FOR DELETE TO authenticated USING (false);

-- Audit events (append-only)
DROP POLICY IF EXISTS "select_audit" ON audit_events;
CREATE POLICY "select_audit" ON audit_events FOR SELECT TO authenticated USING (public.is_workspace_member(workspace_id));
DROP POLICY IF EXISTS "insert_audit" ON audit_events;
CREATE POLICY "insert_audit" ON audit_events FOR INSERT TO authenticated WITH CHECK (public.is_workspace_member(workspace_id));
DROP POLICY IF EXISTS "update_audit" ON audit_events;
CREATE POLICY "update_audit" ON audit_events FOR UPDATE TO authenticated USING (false) WITH CHECK (false);
DROP POLICY IF EXISTS "delete_audit" ON audit_events;
CREATE POLICY "delete_audit" ON audit_events FOR DELETE TO authenticated USING (false);
