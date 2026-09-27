import { describe, it, expect } from 'vitest';
import type { ExperimentStatus } from '@/lib/types';

/**
 * These transitions match the DB trigger `validate_experiment_status_transition`.
 * They document the adjacency graph; actual enforcement is in the database.
 * Domain RPCs further restrict which transitions are allowed (e.g. locked->in_progress
 * is only valid through a formal amendment, not a direct status write).
 */
const VALID_TRANSITIONS: Record<ExperimentStatus, ExperimentStatus[]> = {
  draft: ['in_progress', 'archived'],
  in_progress: ['completed', 'draft', 'archived'],
  completed: ['in_review', 'in_progress', 'archived'],
  in_review: ['changes_requested', 'approved', 'archived'],
  changes_requested: ['in_review', 'in_progress', 'archived'],
  approved: ['locked', 'archived'],
  locked: ['archived'],
  archived: ['draft'],
};

describe('experiment status transitions (adjacency map)', () => {
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

  it('locked cannot transition to in_progress directly (amendment creates a new experiment)', () => {
    expect(VALID_TRANSITIONS.locked).not.toContain('in_progress');
  });

  it('approved can go to locked or archived', () => {
    expect(VALID_TRANSITIONS.approved).toEqual(['locked', 'archived']);
  });

  it('in_review cannot go directly to locked or draft', () => {
    expect(VALID_TRANSITIONS.in_review).not.toContain('locked');
    expect(VALID_TRANSITIONS.in_review).not.toContain('draft');
  });

  it('archived can only restore to draft', () => {
    expect(VALID_TRANSITIONS.archived).toEqual(['draft']);
  });
});

describe('notification types alignment', () => {
  const VALID_NOTIFICATION_TYPES = [
    'mention', 'comment_reply', 'review_requested', 'review_resubmitted',
    'changes_requested', 'experiment_approved', 'experiment_signed',
    'permission_changed',
  ];

  const RPC_NOTIFICATION_TYPES = [
    'review_requested',
    'experiment_approved',
    'changes_requested',
    'review_resubmitted',
    'experiment_signed',
  ];

  it('every RPC notification type is in the valid set', () => {
    for (const type of RPC_NOTIFICATION_TYPES) {
      expect(VALID_NOTIFICATION_TYPES).toContain(type);
    }
  });
});
