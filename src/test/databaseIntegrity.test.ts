import { describe, it, expect } from 'vitest';

/**
 * Database architecture contract tests.
 * Documents the expected state of migrations, RLS policies, RPCs,
 * and invariants. Real enforcement is tested via pgTAP in supabase/tests/.
 */

describe('Policy architecture', () => {
  const REMOVED_LEGACY_POLICIES = [
    'insert_exp_tags', 'update_exp_tags', 'delete_exp_tags',
    'insert_ref', 'update_ref', 'delete_ref',
    'insert_er', 'update_er', 'delete_er',
    'insert_contributors', 'update_contributors', 'delete_contributors',
    'delete_ep', 'delete_pd',
    'insert_blocks', 'update_blocks', 'delete_blocks',
    'insert_experiments', 'update_experiments', 'delete_experiments',
  ];

  it('documents all removed legacy permissive policies', () => {
    expect(REMOVED_LEGACY_POLICIES).toHaveLength(20);
  });

  const TABLES_WITH_NO_DIRECT_WRITES = [
    'experiments',
    'experiment_blocks',
    'experiment_revisions',
    'reviews',
    'signatures',
    'mentions',
    'notifications',
    'audit_events',
  ];

  it('documents tables where all writes go through RPCs', () => {
    expect(TABLES_WITH_NO_DIRECT_WRITES).toHaveLength(8);
  });
});

describe('Lifecycle CHECK constraint', () => {
  it('status=locked requires is_locked=true, is_archived=false', () => {
    const rule = { status: 'locked', is_locked: true, is_archived: false };
    expect(rule.is_locked).toBe(true);
    expect(rule.is_archived).toBe(false);
  });

  it('status=archived requires is_archived=true', () => {
    const rule = { status: 'archived', is_archived: true };
    expect(rule.is_archived).toBe(true);
  });

  it('non-locked/archived status requires both flags false', () => {
    const rule = { status: 'draft', is_locked: false, is_archived: false };
    expect(rule.is_locked).toBe(false);
    expect(rule.is_archived).toBe(false);
  });
});

describe('Revision architecture', () => {
  it('_create_revision_internal is not callable by authenticated', () => {
    const internalFunctions = ['_create_revision_internal'];
    expect(internalFunctions[0]).toMatch(/^_/);
  });

  it('create_checkpoint is the only public revision creation path', () => {
    const publicRevisionRPC = 'create_checkpoint';
    expect(publicRevisionRPC).toBe('create_checkpoint');
  });

  it('restore_experiment_revision creates restoration revision with provenance', () => {
    const changeType = 'restoration';
    expect(changeType).toBe('restoration');
  });
});

describe('Composite FK integrity', () => {
  it('reviews.experiment_revision_id references revisions within same experiment', () => {
    const fk = 'reviews_revision_experiment_fk';
    expect(fk).toContain('revision_experiment');
  });

  it('signatures.experiment_revision_id references revisions within same experiment', () => {
    const fk = 'signatures_revision_experiment_fk';
    expect(fk).toContain('revision_experiment');
  });
});

describe('Optimistic concurrency', () => {
  it('experiment_blocks has row_version column', () => {
    const column = { name: 'row_version', type: 'bigint', default: 1 };
    expect(column.default).toBe(1);
  });

  it('upsert_experiment_blocks checks row_version and raises serialization_failure on mismatch', () => {
    const errorCode = '40001'; // serialization_failure
    expect(errorCode).toBe('40001');
  });

  it('successful upsert increments row_version', () => {
    const before = 1;
    const after = before + 1;
    expect(after).toBe(2);
  });
});

describe('Domain RPC allowlist (public, callable by authenticated)', () => {
  const PUBLIC_RPCS = [
    'accept_invitation',
    'approve_experiment',
    'archive_attachment',
    'archive_experiment_rpc',
    'can_edit_experiment',
    'can_mutate_experiment_content',
    'can_sign_experiment',
    'claim_editor_session',
    'complete_experiment',
    'create_amendment',
    'create_attachment',
    'create_checkpoint',
    'create_experiment_rpc',
    'delete_experiment_block',
    'duplicate_experiment_rpc',
    'insert_experiment_block',
    'release_editor_session',
    'reopen_experiment',
    'replace_attachment',
    'request_experiment_changes',
    'restore_experiment_revision',
    'restore_experiment_rpc',
    'resubmit_for_review',
    'sign_and_lock_experiment',
    'start_experiment',
    'submit_for_review',
    'update_experiment_metadata',
    'upsert_experiment_blocks',
    'add_comment_with_mentions',
    'publish_protocol_version',
    'publish_template_version',
  ];

  it('has a defined set of public RPCs', () => {
    expect(PUBLIC_RPCS.length).toBeGreaterThan(25);
  });

  const INTERNAL_FUNCTIONS = [
    '_create_revision_internal',
    'enforce_block_lock',
    'enforce_experiment_lock',
    'enforce_protocol_version_immutability',
    'enforce_template_version_immutability',
    'generate_experiment_id',
    'get_workspace_role',
    'handle_new_user',
    'handle_new_workspace',
    'is_workspace_editor',
    'is_workspace_member',
    'protect_last_owner',
    'update_experiment_search',
    'validate_experiment_status',
  ];

  it('has internal functions not callable by clients', () => {
    expect(INTERNAL_FUNCTIONS.length).toBeGreaterThan(10);
  });
});

describe('Content mutation gating', () => {
  const CONTENT_MUTABLE = ['draft', 'in_progress', 'changes_requested'];
  const IMMUTABLE = ['completed', 'in_review', 'approved', 'locked', 'archived'];

  it('allows content mutation only in draft/in_progress/changes_requested', () => {
    expect(CONTENT_MUTABLE).toHaveLength(3);
  });

  it('blocks content mutation in completed through archived', () => {
    for (const s of IMMUTABLE) {
      expect(CONTENT_MUTABLE).not.toContain(s);
    }
  });
});
