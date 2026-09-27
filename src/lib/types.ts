// ──────────────────────────────────────────────
// Profile
// ──────────────────────────────────────────────
export interface Profile {
  id: string;
  email: string;
  display_name: string;
  avatar_url: string | null;
  timezone: string;
  created_at: string;
  updated_at: string;
}

// ──────────────────────────────────────────────
// Workspace
// ──────────────────────────────────────────────
export interface Workspace {
  id: string;
  name: string;
  description: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export type WorkspaceMemberRole = 'owner' | 'admin' | 'member' | 'guest';

export interface WorkspaceMember {
  id: string;
  workspace_id: string;
  user_id: string;
  role: WorkspaceMemberRole;
  permissions: Record<string, boolean> | null;
  invited_by: string | null;
  joined_at: string;
  profile?: Profile;
}

export interface WorkspaceInvitation {
  id: string;
  workspace_id: string;
  email: string;
  role: WorkspaceMemberRole;
  invited_by: string;
  token: string;
  expires_at: string;
  accepted_at: string | null;
  created_at: string;
}

// ──────────────────────────────────────────────
// Notebook & Folder
// ──────────────────────────────────────────────
export interface Notebook {
  id: string;
  workspace_id: string;
  name: string;
  description: string | null;
  created_by: string;
  is_archived: boolean;
  created_at: string;
  updated_at: string;
}

export interface Folder {
  id: string;
  notebook_id: string;
  parent_id: string | null;
  name: string;
  order_key: string;
  created_by: string;
  created_at: string;
}

// ──────────────────────────────────────────────
// Experiment
// ──────────────────────────────────────────────
export type ExperimentStatus =
  | 'draft'
  | 'in_progress'
  | 'completed'
  | 'in_review'
  | 'changes_requested'
  | 'approved'
  | 'locked'
  | 'archived';

export interface Experiment {
  id: string;
  workspace_id: string;
  notebook_id: string;
  folder_id: string | null;
  experiment_number: number;
  experiment_id: string;
  title: string;
  status: ExperimentStatus;
  created_by: string;
  experiment_date: string;
  current_revision: number;
  is_locked: boolean;
  is_archived: boolean;
  template_id: string | null;
  template_version_id: string | null;
  search_vector: string | null;
  created_at: string;
  updated_at: string;
  // Optional joined fields
  notebook?: Notebook;
  created_by_profile?: Profile;
  tags?: Tag[];
  is_favorited?: boolean;
}

// ──────────────────────────────────────────────
// Experiment Blocks
// ──────────────────────────────────────────────
export type BlockType =
  | 'paragraph'
  | 'heading'
  | 'list'
  | 'checklist'
  | 'callout'
  | 'divider'
  | 'parameters'
  | 'table'
  | 'image'
  | 'attachment'
  | 'protocol'
  | 'result'
  | 'reference'
  | 'related_experiment'
  | 'code';

export interface ExperimentBlock {
  id: string;
  experiment_id: string;
  type: BlockType;
  content: any;
  order_key: string;
  created_by: string;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

// ──────────────────────────────────────────────
// Revisions
// ──────────────────────────────────────────────
export interface ExperimentRevision {
  id: string;
  experiment_id: string;
  revision_number: number;
  snapshot: any;
  content_hash: string;
  change_summary: string | null;
  change_type: string;
  created_by: string;
  created_at: string;
  profile?: Profile;
}

// ──────────────────────────────────────────────
// Templates
// ──────────────────────────────────────────────
export interface Template {
  id: string;
  workspace_id: string;
  name: string;
  description: string | null;
  category: string | null;
  current_version: number;
  status: string;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface TemplateVersion {
  id: string;
  template_id: string;
  version_number: number;
  content: any;
  metadata: Record<string, any> | null;
  status: string;
  published_at: string | null;
  created_by: string;
  created_at: string;
}

// ──────────────────────────────────────────────
// Protocols
// ──────────────────────────────────────────────
export interface Protocol {
  id: string;
  workspace_id: string;
  name: string;
  description: string | null;
  category: string | null;
  current_version: number;
  status: string;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface ProtocolStep {
  step_number: number;
  instruction: string;
  duration: string | null;
  temperature: string | null;
  parameters: Record<string, any> | null;
  notes: string | null;
  warnings: string | null;
  substeps: ProtocolStep[] | null;
}

export interface ProtocolVersion {
  id: string;
  protocol_id: string;
  version_number: number;
  steps: ProtocolStep[];
  parameters: Record<string, any> | null;
  notes: string | null;
  status: string;
  published_at: string | null;
  created_by: string;
  created_at: string;
}

export interface ExperimentProtocol {
  id: string;
  experiment_id: string;
  protocol_id: string;
  protocol_version_id: string;
  snapshot: any;
  created_at: string;
  protocol?: Protocol;
  version?: ProtocolVersion;
  deviations?: ProtocolDeviation[];
}

export interface ProtocolDeviation {
  id: string;
  experiment_protocol_id: string;
  step_index: number;
  original_value: string;
  actual_value: string;
  reason: string;
  created_by: string;
  created_at: string;
}

// ──────────────────────────────────────────────
// Relations & References
// ──────────────────────────────────────────────
export interface ExperimentRelation {
  id: string;
  source_experiment_id: string;
  target_experiment_id: string;
  relation_type: string;
  created_by: string;
  created_at: string;
  target?: Experiment;
}

export interface ExperimentReference {
  id: string;
  experiment_id: string;
  doi: string | null;
  url: string | null;
  title: string;
  citation: string | null;
  notes: string | null;
  created_by: string;
  created_at: string;
}

// ──────────────────────────────────────────────
// Attachments
// ──────────────────────────────────────────────
export interface Attachment {
  id: string;
  experiment_id: string;
  original_filename: string;
  display_name: string;
  storage_path: string;
  mime_type: string;
  file_size: number;
  checksum: string | null;
  current_version: number;
  uploaded_by: string;
  is_archived: boolean;
  created_at: string;
  updated_at: string;
}

export interface AttachmentVersion {
  id: string;
  attachment_id: string;
  version_number: number;
  storage_path: string;
  file_size: number;
  checksum: string | null;
  uploaded_by: string;
  created_at: string;
}

// ──────────────────────────────────────────────
// Comments & Mentions
// ──────────────────────────────────────────────
export interface CommentThread {
  id: string;
  experiment_id: string;
  block_id: string | null;
  is_resolved: boolean;
  resolved_by: string | null;
  resolved_at: string | null;
  created_at: string;
  comments?: Comment[];
}

export interface Comment {
  id: string;
  thread_id: string;
  content: string;
  created_by: string;
  is_edited: boolean;
  created_at: string;
  updated_at: string;
  profile?: Profile;
}

export interface Mention {
  id: string;
  comment_id: string;
  mentioned_user_id: string;
  created_at: string;
}

// ──────────────────────────────────────────────
// Notifications
// ──────────────────────────────────────────────
export interface Notification {
  id: string;
  user_id: string;
  type: string;
  title: string;
  body: string | null;
  experiment_id: string | null;
  is_read: boolean;
  created_at: string;
}

// ──────────────────────────────────────────────
// Reviews & Signatures
// ──────────────────────────────────────────────
export interface Review {
  id: string;
  experiment_id: string;
  reviewer_id: string;
  revision_number: number;
  status: string;
  comment: string | null;
  reviewed_at: string | null;
  created_at: string;
  reviewer?: Profile;
}

export interface Signature {
  id: string;
  experiment_id: string;
  signer_id: string;
  revision_number: number;
  content_hash: string;
  declaration: string;
  signed_at: string;
  signer?: Profile;
}

// ──────────────────────────────────────────────
// Audit
// ──────────────────────────────────────────────
export interface AuditEvent {
  id: string;
  workspace_id: string;
  object_type: string;
  object_id: string;
  event_type: string;
  actor_id: string;
  revision_number: number | null;
  metadata: Record<string, any> | null;
  created_at: string;
  actor?: Profile;
}

// ──────────────────────────────────────────────
// Tags, Favorites, Recents, Contributors
// ──────────────────────────────────────────────
export interface Tag {
  id: string;
  workspace_id: string;
  name: string;
  color: string | null;
  created_at: string;
}

export interface Favorite {
  id: string;
  user_id: string;
  experiment_id: string;
  created_at: string;
}

export interface RecentItem {
  id: string;
  user_id: string;
  experiment_id: string;
  accessed_at: string;
}

export interface ExperimentContributor {
  id: string;
  experiment_id: string;
  user_id: string;
  role: string;
  added_at: string;
  profile?: Profile;
}

// ──────────────────────────────────────────────
// Filter helpers
// ──────────────────────────────────────────────
export interface ExperimentFilters {
  status?: ExperimentStatus | null;
  notebook_id?: string | null;
  tag_ids?: string[];
  search?: string;
  created_by?: string | null;
  date_from?: string | null;
  date_to?: string | null;
  sort_by?: 'created_at' | 'updated_at' | 'title' | 'experiment_number';
  sort_order?: 'asc' | 'desc';
}
