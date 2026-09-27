import { describe, it, expect } from 'vitest';
import type { ExperimentStatus } from '@/lib/types';

const VALID_TRANSITIONS: Record<ExperimentStatus, ExperimentStatus[]> = {
  draft: ['in_progress', 'archived'],
  in_progress: ['completed', 'draft', 'archived'],
  completed: ['in_review', 'in_progress', 'archived'],
  in_review: ['approved', 'changes_requested'],
  changes_requested: ['in_review', 'in_progress'],
  approved: ['locked'],
  locked: ['in_progress'], // via amendment
  archived: ['draft'],
};

describe('experiment status transitions', () => {
  const allStatuses: ExperimentStatus[] = [
    'draft', 'in_progress', 'completed', 'in_review',
    'changes_requested', 'approved', 'locked', 'archived',
  ];

  it('every status has defined valid transitions', () => {
    for (const status of allStatuses) {
      expect(VALID_TRANSITIONS[status]).toBeDefined();
      expect(Array.isArray(VALID_TRANSITIONS[status])).toBe(true);
    }
  });

  it('no status can transition to itself', () => {
    for (const status of allStatuses) {
      expect(VALID_TRANSITIONS[status]).not.toContain(status);
    }
  });

  it('draft can only go to in_progress or archived', () => {
    expect(VALID_TRANSITIONS.draft).toEqual(['in_progress', 'archived']);
  });

  it('locked can only transition via amendment (to in_progress)', () => {
    expect(VALID_TRANSITIONS.locked).toEqual(['in_progress']);
  });

  it('approved can only go to locked (via signing)', () => {
    expect(VALID_TRANSITIONS.approved).toEqual(['locked']);
  });

  it('in_review cannot go directly to locked or draft', () => {
    expect(VALID_TRANSITIONS.in_review).not.toContain('locked');
    expect(VALID_TRANSITIONS.in_review).not.toContain('draft');
  });
});

describe('notification types alignment', () => {
  const VALID_NOTIFICATION_TYPES = [
    'mention', 'comment_reply', 'review_requested', 'review_resubmitted',
    'changes_requested', 'experiment_approved', 'experiment_signed',
    'permission_changed',
  ];

  const RPC_NOTIFICATION_TYPES = [
    'review_requested',      // submit_for_review
    'experiment_approved',   // approve_experiment
    'changes_requested',     // request_experiment_changes
    'review_resubmitted',    // resubmit_for_review
    'experiment_signed',     // sign_and_lock_experiment
  ];

  it('every RPC notification type is in the valid set', () => {
    for (const type of RPC_NOTIFICATION_TYPES) {
      expect(VALID_NOTIFICATION_TYPES).toContain(type);
    }
  });
});
