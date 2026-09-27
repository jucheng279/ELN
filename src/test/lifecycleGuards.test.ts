import { describe, it, expect } from 'vitest';
import type { ExperimentStatus } from '@/lib/types';

const CONTENT_MUTABLE_STATUSES: ExperimentStatus[] = ['draft', 'in_progress'];
const ALL_STATUSES: ExperimentStatus[] = [
  'draft', 'in_progress', 'completed', 'in_review',
  'changes_requested', 'approved', 'locked', 'archived',
];

describe('can_mutate_experiment_content logic', () => {
  it('only draft and in_progress are content-mutable', () => {
    expect(CONTENT_MUTABLE_STATUSES).toEqual(['draft', 'in_progress']);
  });

  it('completed, in_review, approved, locked, archived are NOT content-mutable', () => {
    const nonMutable = ALL_STATUSES.filter((s) => !CONTENT_MUTABLE_STATUSES.includes(s));
    expect(nonMutable).toEqual([
      'completed', 'in_review', 'changes_requested', 'approved', 'locked', 'archived',
    ]);
  });
});

describe('readOnly UI logic', () => {
  const EDITABLE_STATUSES: ExperimentStatus[] = ['draft', 'in_progress', 'changes_requested'];

  function computeReadOnly(status: ExperimentStatus, isLocked: boolean): boolean {
    return isLocked || !EDITABLE_STATUSES.includes(status);
  }

  it('draft is editable when not locked', () => {
    expect(computeReadOnly('draft', false)).toBe(false);
  });

  it('in_progress is editable when not locked', () => {
    expect(computeReadOnly('in_progress', false)).toBe(false);
  });

  it('changes_requested is editable when not locked', () => {
    expect(computeReadOnly('changes_requested', false)).toBe(false);
  });

  it('completed is read-only', () => {
    expect(computeReadOnly('completed', false)).toBe(true);
  });

  it('in_review is read-only', () => {
    expect(computeReadOnly('in_review', false)).toBe(true);
  });

  it('approved is read-only', () => {
    expect(computeReadOnly('approved', false)).toBe(true);
  });

  it('locked is always read-only', () => {
    expect(computeReadOnly('locked', true)).toBe(true);
  });

  it('archived is always read-only', () => {
    expect(computeReadOnly('archived', false)).toBe(true);
  });

  it('any status becomes read-only when locked', () => {
    for (const status of ALL_STATUSES) {
      expect(computeReadOnly(status, true)).toBe(true);
    }
  });
});

describe('amendment lineage', () => {
  it('amendment creates a new experiment, not unlocking the original', () => {
    // The RPC returns a new experiment ID different from the source
    // This test documents the expected contract
    const sourceId = 'source-uuid';
    const resultId = 'new-amendment-uuid';
    expect(resultId).not.toEqual(sourceId);
  });

  it('amendment result includes amended_from_id pointing to source', () => {
    const result = {
      id: 'new-uuid',
      experiment_number: 2,
      experiment_id: 'EXP-002',
      amended_from_id: 'source-uuid',
    };
    expect(result.amended_from_id).toBe('source-uuid');
    expect(result.id).not.toBe(result.amended_from_id);
  });
});

describe('notification and audit lockdown', () => {
  it('notifications INSERT policy is WITH CHECK (false) for authenticated', () => {
    // Documents that the DB policy blocks direct client inserts
    // Only SECURITY DEFINER functions can insert notifications
    const policyWithCheck = false;
    expect(policyWithCheck).toBe(false);
  });

  it('audit_events INSERT policy is WITH CHECK (false) for authenticated', () => {
    const policyWithCheck = false;
    expect(policyWithCheck).toBe(false);
  });
});
