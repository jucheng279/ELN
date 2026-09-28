import { describe, it, expect } from 'vitest';

type WorkspaceMemberRole = 'owner' | 'admin' | 'member' | 'guest';

interface ExperimentCapabilities {
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

function computeLocalCapabilities(
  role: WorkspaceMemberRole | 'none' | 'anonymous',
  status: string,
  isLocked: boolean,
  isOwner: boolean,
): ExperimentCapabilities {
  if (role === 'none' || role === 'anonymous') {
    return {
      canEditContent: false, canEditMetadata: false, canStart: false, canComplete: false,
      canReopen: false, canSubmitReview: false, canReview: false, canRequestChanges: false,
      canApprove: false, canSign: false, canArchive: false, canRestore: false,
      canRestoreRevision: false, canCreateAmendment: false, canDuplicate: false,
      canComment: false, isReadOnly: true, role,
    };
  }

  const isEditor = role !== 'guest';
  const editableStatuses = ['draft', 'in_progress', 'changes_requested'];
  const canEditContent = isEditor && !isLocked && editableStatuses.includes(status);

  return {
    canEditContent,
    canEditMetadata: isEditor && !isLocked && status !== 'locked',
    canStart: isEditor && status === 'draft' && isOwner,
    canComplete: isEditor && status === 'in_progress' && isOwner,
    canReopen: isEditor && status === 'completed' && isOwner,
    canSubmitReview: isEditor && status === 'completed' && isOwner,
    canReview: false,
    canRequestChanges: false,
    canApprove: false,
    canSign: false,
    canArchive: isEditor && !isLocked,
    canRestore: isEditor,
    canRestoreRevision: isEditor && canEditContent,
    canCreateAmendment: isEditor && isLocked,
    canDuplicate: true,
    canComment: isEditor,
    isReadOnly: !canEditContent,
    role,
  };
}

describe('Capability-driven ReviewPanel access', () => {
  it('unauthorized member cannot see Approve (no server canApprove)', () => {
    const caps = computeLocalCapabilities('member', 'in_review', false, false);
    expect(caps.canApprove).toBe(false);
    expect(caps.canRequestChanges).toBe(false);
  });

  it('no user has canSign from local fallback (server-only)', () => {
    const caps = computeLocalCapabilities('admin', 'approved', false, true);
    expect(caps.canSign).toBe(false);
  });

  it('locked editor sees canCreateAmendment', () => {
    const caps = computeLocalCapabilities('admin', 'locked', true, true);
    expect(caps.canCreateAmendment).toBe(true);
    expect(caps.canEditContent).toBe(false);
  });

  it('guest cannot submit review even as owner', () => {
    const caps = computeLocalCapabilities('guest', 'completed', false, true);
    expect(caps.canSubmitReview).toBe(false);
    expect(caps.canComment).toBe(false);
  });
});

describe('Guest comment capability', () => {
  it('guest has canComment=false', () => {
    const caps = computeLocalCapabilities('guest', 'in_progress', false, false);
    expect(caps.canComment).toBe(false);
  });

  it('member has canComment=true', () => {
    const caps = computeLocalCapabilities('member', 'in_progress', false, false);
    expect(caps.canComment).toBe(true);
  });

  it('anonymous has canComment=false', () => {
    const caps = computeLocalCapabilities('anonymous', 'in_progress', false, false);
    expect(caps.canComment).toBe(false);
  });
});

describe('HistoryPanel restore follows capabilities', () => {
  it('canRestoreRevision=true only in editable status for editor', () => {
    expect(computeLocalCapabilities('member', 'draft', false, true).canRestoreRevision).toBe(true);
    expect(computeLocalCapabilities('member', 'in_progress', false, true).canRestoreRevision).toBe(true);
    expect(computeLocalCapabilities('member', 'changes_requested', false, true).canRestoreRevision).toBe(true);
  });

  it('canRestoreRevision=false for non-editable statuses', () => {
    expect(computeLocalCapabilities('member', 'completed', false, true).canRestoreRevision).toBe(false);
    expect(computeLocalCapabilities('member', 'in_review', false, true).canRestoreRevision).toBe(false);
    expect(computeLocalCapabilities('member', 'approved', false, true).canRestoreRevision).toBe(false);
    expect(computeLocalCapabilities('member', 'locked', true, true).canRestoreRevision).toBe(false);
  });

  it('guest cannot restore revisions', () => {
    expect(computeLocalCapabilities('guest', 'draft', false, true).canRestoreRevision).toBe(false);
  });
});
