import type { Experiment } from '@/lib/types';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { useAuthStore } from '@/stores/authStore';

export interface ExperimentCapabilities {
  canEditContent: boolean;
  canEditMetadata: boolean;
  canStart: boolean;
  canComplete: boolean;
  canReopen: boolean;
  canSubmitReview: boolean;
  canReview: boolean;
  canSign: boolean;
  canArchive: boolean;
  canRestore: boolean;
  canCreateAmendment: boolean;
  canRestoreRevision: boolean;
  canDuplicate: boolean;
  canComment: boolean;
  isReadOnly: boolean;
  role: string | null;
}

const CONTENT_MUTABLE = new Set(['draft', 'in_progress', 'changes_requested']);

export function useExperimentCapabilities(
  experiment: Experiment | null
): ExperimentCapabilities {
  const { members } = useWorkspaceStore();
  const { user } = useAuthStore();

  const none: ExperimentCapabilities = {
    canEditContent: false,
    canEditMetadata: false,
    canStart: false,
    canComplete: false,
    canReopen: false,
    canSubmitReview: false,
    canReview: false,
    canSign: false,
    canArchive: false,
    canRestore: false,
    canCreateAmendment: false,
    canRestoreRevision: false,
    canDuplicate: false,
    canComment: false,
    isReadOnly: true,
    role: null,
  };

  if (!experiment || !user) return none;

  const member = members.find((m) => m.user_id === user.id);
  const role = member?.role ?? null;
  if (!role) return none;

  const isGuest = role === 'guest';
  const isEditor = !isGuest; // member, admin, owner are all editors
  const isAuthor = user.id === experiment.created_by;
  const status = experiment.status;
  const isMutable = CONTENT_MUTABLE.has(status);
  const isLocked = !!experiment.is_locked;
  const isArchived = !!experiment.is_archived;

  return {
    canEditContent: isEditor && isMutable && !isLocked && !isArchived,
    canEditMetadata: isEditor && isMutable && !isLocked && !isArchived,
    canStart: isEditor && status === 'draft',
    canComplete: isEditor && status === 'in_progress',
    canReopen: isEditor && status === 'completed',
    canSubmitReview: isEditor && isAuthor && (status === 'completed' || status === 'changes_requested'),
    canReview: false, // determined per-review by reviewer_id match
    canSign: false, // determined server-side by can_sign_experiment
    canArchive: isEditor && !isArchived && status !== 'locked',
    canRestore: isEditor && isArchived,
    canCreateAmendment: isEditor && isLocked,
    canRestoreRevision: isEditor && isMutable && !isLocked && !isArchived,
    canDuplicate: isEditor,
    canComment: !isGuest,
    isReadOnly: isGuest || !isMutable || isLocked,
    role,
  };
}
