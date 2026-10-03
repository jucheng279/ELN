import { describe, expect, it } from 'vitest';
import { assembleLivePdfModel, assembleRevisionPdfModel, pdfFileName, type SignatureRow } from '@/lib/pdfModel';
import type { ExperimentRevision } from '@/lib/types';
import { makeBlock, makeExperiment } from '@/test/supabaseMock';

const HASH = 'f'.repeat(64);

const experiment = makeExperiment({
  experiment_id: 'EXP-0042',
  title: 'Live title',
  status: 'locked',
  is_locked: true,
});

const liveBlocks = [
  makeBlock('b2', { content: { html: 'live edited text' } }),
  makeBlock('b1', { content: { html: 'live first' } }),
];

function makeRevision(overrides: Partial<ExperimentRevision> = {}): ExperimentRevision {
  return {
    id: 'rev-3',
    experiment_id: 'exp-1',
    revision_number: 3,
    content_hash: HASH,
    change_summary: null,
    change_type: 'approval',
    created_by: 'user-1',
    created_at: '2026-10-01T10:00:00Z',
    snapshot: {
      title: 'Signed title',
      experiment_date: '2026-09-30',
      tags: [{ name: 'pcr' }, 'buffer'],
      blocks: [
        { id: 'b9', type: 'paragraph', content: { html: 'snapshot second' }, order_key: 'a9' },
        { id: 'b1', type: 'paragraph', content: { html: 'snapshot first' }, order_key: 'a1' },
      ],
    } as unknown as ExperimentRevision['snapshot'],
    ...overrides,
  };
}

function makeSignature(overrides: Partial<SignatureRow> = {}): SignatureRow {
  return {
    id: 'sig-1',
    experiment_id: 'exp-1',
    experiment_revision_id: 'rev-3',
    revision_number: 3,
    content_hash: HASH,
    declaration: 'I certify this record.',
    signed_at: '2026-10-02T08:30:00Z',
    signer: { display_name: 'Dr. Ada' },
    ...overrides,
  };
}

const htmlOf = (b: { content: unknown }) => (b.content as { html: string }).html;

describe('revision PDF assembly', () => {
  it('uses only snapshot blocks, sorted by order_key, never live editor blocks', () => {
    const model = assembleRevisionPdfModel(experiment, makeRevision(), makeSignature());
    expect(model.blocks.map((b) => b.id)).toEqual(['b1', 'b9']);
    expect(model.blocks.map(htmlOf)).toEqual(['snapshot first', 'snapshot second']);
    expect(model.blocks.map(htmlOf)).not.toContain('live edited text');
  });

  it('takes title, date and tags from the snapshot rather than the live experiment', () => {
    const model = assembleRevisionPdfModel(experiment, makeRevision(), null);
    expect(model.title).toBe('Signed title');
    expect(model.experimentDate).toBe('2026-09-30');
    expect(model.tags).toEqual(['pcr', 'buffer']);
  });

  it('carries signer, declaration, revision number and content hash for a signed revision', () => {
    const model = assembleRevisionPdfModel(experiment, makeRevision(), makeSignature());
    expect(model.record).toEqual({
      kind: 'revision',
      revisionId: 'rev-3',
      revisionNumber: 3,
      contentHash: HASH,
      createdAt: '2026-10-01T10:00:00Z',
      signature: {
        signerName: 'Dr. Ada',
        signedAt: '2026-10-02T08:30:00Z',
        declaration: 'I certify this record.',
        revisionNumber: 3,
        contentHash: HASH,
      },
    });
    expect(pdfFileName(model)).toBe('EXP-0042_Signed_title_v3_signed.pdf');
  });

  it('exports an unsigned viewed revision with its hash and no signature', () => {
    const model = assembleRevisionPdfModel(experiment, makeRevision(), null);
    expect(model.record).toMatchObject({ kind: 'revision', revisionNumber: 3, contentHash: HASH, signature: null });
    expect(pdfFileName(model)).toBe('EXP-0042_Signed_title_v3.pdf');
  });

  it.each([
    ['revision id', { experiment_revision_id: 'rev-2' }],
    ['revision number', { revision_number: 2 }],
    ['content hash', { content_hash: 'e'.repeat(64) }],
  ])('refuses to export when the signature %s does not match the revision', (_label, overrides) => {
    expect(() => assembleRevisionPdfModel(experiment, makeRevision(), makeSignature(overrides))).toThrow(
      'The signature does not match this revision',
    );
  });

  it('refuses a snapshot without blocks instead of falling back to live content', () => {
    const revision = makeRevision({ snapshot: { title: 'x' } as unknown as ExperimentRevision['snapshot'] });
    expect(() => assembleRevisionPdfModel(experiment, revision, null)).toThrow('no readable content snapshot');
  });

  it('refuses a revision that belongs to another experiment', () => {
    expect(() => assembleRevisionPdfModel(experiment, makeRevision({ experiment_id: 'exp-2' }), null)).toThrow(
      'different experiment',
    );
  });
});

describe('live PDF assembly', () => {
  it('uses live blocks and is marked as an unsigned working copy', () => {
    const model = assembleLivePdfModel(experiment, liveBlocks);
    expect(model.record).toEqual({ kind: 'live' });
    expect(model.title).toBe('Live title');
    expect(model.blocks.map(htmlOf)).toEqual(['live first', 'live edited text']);
    expect(pdfFileName(model)).toBe('EXP-0042_Live_title_working-copy.pdf');
  });
});
