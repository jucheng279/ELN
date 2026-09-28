import { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { useAuthStore } from '@/stores/authStore';
import type { Experiment, WorkspaceMemberRole } from '@/lib/types';

export interface ExperimentCapabilities {
  canEditContent: boolean;
  canEditMetadata: boolean;
  canStart: boolean;
  canComplete: boolean;
  canReopen: boolean;
  canSubmitReview: boolean;
  canReview: boolean;
  canRequestChanges: boolean;
  canApprove: boolean;
  canSign: boolean;
  canArchive: boolean;
  canRestore: boolean;
  canRestoreRevision: boolean;
  canCreateAmendment: boolean;
  canDuplicate: boolean;
  canComment: boolean;
  isReadOnly: boolean;
  role: WorkspaceMemberRole | 'none' | 'anonymous';
}

const EMPTY_CAPS: ExperimentCapabilities = {
  canEditContent: false, canEditMetadata: false,
  canStart: false, canComplete: false, canReopen: false,
  canSubmitReview: false, canReview: false, canRequestChanges: false,
  canApprove: false, canSign: false, canArchive: false, canRestore: false,
  canRestoreRevision: false, canCreateAmendment: false, canDuplicate: false,
  canComment: false, isReadOnly: true, role: 'none',
};

function localFallback(
  experiment: Experiment | null,
  role: WorkspaceMemberRole | null,
  userId: string | null
): ExperimentCapabilities {
  if (!experiment || !role || !userId) return EMPTY_CAPS;
  const isEditor = role !== 'guest';
  const isAuthor = experiment.created_by === userId;
  const mutableStatuses = ['draft', 'in_progress', 'changes_requested'];
  const isMutable = mutableStatuses.includes(experiment.status) && !experiment.is_locked && !experiment.is_archived;

  return {
    canEditContent: isEditor && isMutable,
    canEditMetadata: isEditor && isMutable,
    canStart: isEditor && experiment.status === 'draft',
    canComplete: isEditor && experiment.status === 'in_progress',
    canReopen: isEditor && experiment.status === 'completed' && !experiment.is_locked && !experiment.is_archived,
    canSubmitReview: isEditor && isAuthor && ['completed', 'changes_requested'].includes(experiment.status) && !experiment.is_locked,
    canReview: false,
    canRequestChanges: false,
    canApprove: false,
    canSign: false,
    canArchive: isEditor && !experiment.is_archived && !experiment.is_locked,
    canRestore: isEditor && experiment.is_archived,
    canRestoreRevision: isEditor && isMutable,
    canCreateAmendment: isEditor && experiment.is_locked,
    canDuplicate: isEditor,
    canComment: role !== 'guest',
    isReadOnly: !isEditor || !isMutable,
    role: role,
  };
}

export function useExperimentCapabilities(experiment: Experiment | null) {
  const { members } = useWorkspaceStore();
  const { user } = useAuthStore();
  const [serverCaps, setServerCaps] = useState<ExperimentCapabilities | null>(null);

  const userRole = useMemo(() => {
    if (!user || !members.length) return null;
    const member = members.find((m) => m.user_id === user.id);
    return member?.role ?? null;
  }, [user, members]);

  const fallback = useMemo(
    () => localFallback(experiment, userRole, user?.id ?? null),
    [experiment, userRole, user]
  );

  useEffect(() => {
    if (!experiment?.id) {
      setServerCaps(null);
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const { data, error } = await supabase.rpc('get_experiment_capabilities', {
          p_experiment_id: experiment.id,
        });
        if (cancelled || error || !data) return;
        const d = data as Record<string, unknown>;
        if (d.error) return;

        setServerCaps({
          canEditContent: !!d.can_edit_content,
          canEditMetadata: !!d.can_edit_metadata,
          canStart: !!d.can_start,
          canComplete: !!d.can_complete,
          canReopen: !!d.can_reopen,
          canSubmitReview: !!d.can_submit_review,
          canReview: !!d.can_review,
          canRequestChanges: !!d.can_request_changes,
          canApprove: !!d.can_approve,
          canSign: !!d.can_sign,
          canArchive: !!d.can_archive,
          canRestore: !!d.can_restore,
          canRestoreRevision: !!d.can_restore_revision,
          canCreateAmendment: !!d.can_create_amendment,
          canDuplicate: !!d.can_duplicate,
          canComment: !!d.can_comment,
          isReadOnly: d.is_read_only !== false,
          role: (d.role as ExperimentCapabilities['role']) ?? 'none',
        });
      } catch {
        // Fall back to local derivation
      }
    })();

    return () => { cancelled = true; };
  }, [experiment?.id, experiment?.status, experiment?.is_locked, experiment?.is_archived]);

  return serverCaps ?? fallback;
}
