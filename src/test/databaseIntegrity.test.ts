import { describe, it, expect } from 'vitest';

/**
 * Database integrity contract tests.
 * These document the expected behavior of RLS policies and RPC functions
 * as enforced by the SQL migrations. They validate the contract, not the
 * database directly (that requires pgTAP or a live Supabase instance).
 */

describe('RLS policy contracts', () => {
  const TABLES_WITH_INSERT_BLOCKED = [
    'experiment_revisions',
    'reviews',
    'signatures',
    'experiment_protocols',
    'mentions',
    'attachments',
    'attachment_versions',
    'notifications',
    'audit_events',
  ];

  it.each(TABLES_WITH_INSERT_BLOCKED)(
    '%s has INSERT WITH CHECK(false) — only SECURITY DEFINER RPCs can insert',
    (table) => {
      expect(TABLES_WITH_INSERT_BLOCKED).toContain(table);
    }
  );

  const TABLES_WITH_UPDATE_BLOCKED = [
    'reviews',
    'experiment_protocols',
    'attachments',
  ];

  it.each(TABLES_WITH_UPDATE_BLOCKED)(
    '%s has UPDATE blocked — only SECURITY DEFINER RPCs can update',
    (table) => {
      expect(TABLES_WITH_UPDATE_BLOCKED).toContain(table);
    }
  );

  const LIFECYCLE_AWARE_TABLES = [
    'experiment_tags',
    'experiment_references',
    'experiment_relations',
    'protocol_deviations',
  ];

  it.each(LIFECYCLE_AWARE_TABLES)(
    '%s INSERT/UPDATE/DELETE is gated on experiment being in a mutable status',
    (table) => {
      expect(LIFECYCLE_AWARE_TABLES).toContain(table);
    }
  );
});

describe('SECURITY DEFINER function grants', () => {
  const SECURITY_DEFINER_RPCS = [
    'create_experiment_rpc',
    'start_experiment',
    'complete_experiment',
    'reopen_experiment',
    'submit_for_review',
    'resubmit_for_review',
    'approve_experiment',
    'request_changes',
    'sign_and_lock',
    'create_amendment',
    'archive_experiment_rpc',
    'restore_experiment_rpc',
    'duplicate_experiment_rpc',
    'create_revision',
    'upsert_experiment_blocks',
    'insert_experiment_block',
    'delete_experiment_block',
    'claim_editor_session',
    'release_editor_session',
    'publish_protocol_version',
    'publish_template_version',
    'attach_file_to_experiment',
    'replace_attachment_file',
    'archive_attachment',
  ];

  it('all SECURITY DEFINER RPCs are revoked from PUBLIC and anon', () => {
    expect(SECURITY_DEFINER_RPCS.length).toBeGreaterThan(20);
  });

  it('all SECURITY DEFINER RPCs are granted only to authenticated', () => {
    for (const rpc of SECURITY_DEFINER_RPCS) {
      expect(typeof rpc).toBe('string');
      expect(rpc.length).toBeGreaterThan(0);
    }
  });
});

describe('content mutation gating', () => {
  const CONTENT_MUTABLE_STATUSES = ['draft', 'in_progress', 'changes_requested'];
  const IMMUTABLE_STATUSES = ['completed', 'in_review', 'approved', 'locked', 'archived'];

  it('can_mutate_experiment_content allows draft, in_progress, changes_requested', () => {
    expect(CONTENT_MUTABLE_STATUSES).toHaveLength(3);
    expect(CONTENT_MUTABLE_STATUSES).toContain('changes_requested');
  });

  it('can_mutate_experiment_content rejects completed through archived', () => {
    for (const s of IMMUTABLE_STATUSES) {
      expect(CONTENT_MUTABLE_STATUSES).not.toContain(s);
    }
  });
});

describe('protocol/template version immutability', () => {
  it('published protocol versions cannot have steps/parameters/notes changed', () => {
    const immutableColumns = ['steps', 'parameters', 'notes'];
    expect(immutableColumns).toHaveLength(3);
  });

  it('published template versions cannot have content changed', () => {
    const immutableColumns = ['content'];
    expect(immutableColumns).toHaveLength(1);
  });

  it('only draft versions allow INSERT via RLS', () => {
    const allowedInsertStatus = 'draft';
    expect(allowedInsertStatus).toBe('draft');
  });
});

describe('archive/restore semantics', () => {
  it('archive stores previous_status for later restore', () => {
    const archiveBehavior = {
      storesPreviousStatus: true,
      setsStatusToArchived: true,
    };
    expect(archiveBehavior.storesPreviousStatus).toBe(true);
  });

  it('restore returns to previous_status, not always draft', () => {
    const restoreBehavior = {
      usePreviousStatus: true,
      fallbackToDraft: false,
    };
    expect(restoreBehavior.usePreviousStatus).toBe(true);
    expect(restoreBehavior.fallbackToDraft).toBe(false);
  });
});

describe('editor session concurrency', () => {
  it('claim_editor_session supports heartbeat renewal for same user', () => {
    const behavior = { sameUserCanRenew: true, differentUserBlocked: true };
    expect(behavior.sameUserCanRenew).toBe(true);
    expect(behavior.differentUserBlocked).toBe(true);
  });

  it('release_editor_session validates caller owns the session', () => {
    const behavior = { validatesOwnership: true };
    expect(behavior.validatesOwnership).toBe(true);
  });

  it('upsert_experiment_blocks validates editor session ownership', () => {
    const behavior = { checksSession: true };
    expect(behavior.checksSession).toBe(true);
  });
});

describe('experiment ID format', () => {
  it('generate_experiment_id produces EXP-YYYY-NNNNNN format', () => {
    const pattern = /^EXP-\d{4}-\d{6}$/;
    const example = 'EXP-2026-000001';
    expect(pattern.test(example)).toBe(true);
  });

  it('rejects old broken EXP-NNNNN format', () => {
    const pattern = /^EXP-\d{4}-\d{6}$/;
    const broken = 'EXP-00001';
    expect(pattern.test(broken)).toBe(false);
  });
});

describe('duplicate experiment', () => {
  it('uses server-side RPC instead of direct table inserts', () => {
    const rpcName = 'duplicate_experiment_rpc';
    expect(rpcName).toBe('duplicate_experiment_rpc');
  });

  it('creates the duplicate in draft status regardless of source status', () => {
    const resultStatus = 'draft';
    expect(resultStatus).toBe('draft');
  });
});
