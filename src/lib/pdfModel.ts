import type { BlockContent, BlockType, Experiment, ExperimentBlock, ExperimentRevision } from '@/lib/types';

export interface PdfBlock {
  id: string;
  type: BlockType;
  content: BlockContent;
  order_key: string;
}

export interface PdfSignature {
  signerName: string;
  signedAt: string;
  declaration: string;
  revisionNumber: number;
  contentHash: string;
}

export type PdfRecord =
  | { kind: 'live' }
  | {
      kind: 'revision';
      revisionId: string;
      revisionNumber: number;
      contentHash: string;
      createdAt: string;
      signature: PdfSignature | null;
    };

export interface PdfModel {
  experimentId: string;
  title: string;
  experimentDate: string | null;
  notebookName: string | null;
  authorName: string | null;
  tags: string[];
  blocks: PdfBlock[];
  record: PdfRecord;
}

export interface SignatureRow {
  id: string;
  experiment_id: string;
  experiment_revision_id: string | null;
  revision_number: number;
  content_hash: string;
  declaration: string;
  signed_at: string;
  signer?: { display_name: string } | null;
}

function sortBlocks<T extends { order_key: string }>(blocks: T[]): T[] {
  return [...blocks].sort((a, b) => a.order_key.localeCompare(b.order_key));
}

function tagNames(tags: unknown): string[] {
  if (!Array.isArray(tags)) return [];
  return tags
    .map((t) => (typeof t === 'string' ? t : String((t as { name?: unknown })?.name ?? '')))
    .filter(Boolean);
}

export function assembleLivePdfModel(experiment: Experiment, blocks: ExperimentBlock[]): PdfModel {
  return {
    experimentId: experiment.experiment_id,
    title: experiment.title,
    experimentDate: experiment.experiment_date,
    notebookName: experiment.notebook?.name ?? null,
    authorName: experiment.created_by_profile?.display_name ?? null,
    tags: tagNames(experiment.tags),
    blocks: sortBlocks(blocks).map(({ id, type, content, order_key }) => ({ id, type, content, order_key })),
    record: { kind: 'live' },
  };
}

function snapshotBlocks(revision: ExperimentRevision): PdfBlock[] {
  const raw = (revision.snapshot as { blocks?: unknown } | null)?.blocks;
  if (!Array.isArray(raw)) {
    throw new Error(`Revision v${revision.revision_number} has no readable content snapshot`);
  }
  return sortBlocks(
    raw.map((b, i) => {
      const block = b as Partial<PdfBlock>;
      return {
        id: String(block.id ?? i),
        type: block.type as BlockType,
        content: (block.content ?? {}) as BlockContent,
        order_key: String(block.order_key ?? ''),
      };
    }),
  );
}

function verifiedSignature(revision: ExperimentRevision, signature: SignatureRow | null): PdfSignature | null {
  if (!signature) return null;
  if (
    signature.experiment_revision_id !== revision.id ||
    signature.revision_number !== revision.revision_number ||
    signature.content_hash !== revision.content_hash
  ) {
    throw new Error('The signature does not match this revision; export was stopped');
  }
  return {
    signerName: signature.signer?.display_name || 'Unknown signer',
    signedAt: signature.signed_at,
    declaration: signature.declaration,
    revisionNumber: signature.revision_number,
    contentHash: signature.content_hash,
  };
}

export function assembleRevisionPdfModel(
  experiment: Experiment,
  revision: ExperimentRevision,
  signature: SignatureRow | null,
): PdfModel {
  if (revision.experiment_id !== experiment.id) {
    throw new Error('This revision belongs to a different experiment');
  }
  const snapshot = (revision.snapshot ?? {}) as { title?: unknown; experiment_date?: unknown; tags?: unknown };
  return {
    experimentId: experiment.experiment_id,
    title: typeof snapshot.title === 'string' && snapshot.title ? snapshot.title : experiment.title,
    experimentDate: typeof snapshot.experiment_date === 'string' ? snapshot.experiment_date : null,
    notebookName: experiment.notebook?.name ?? null,
    authorName: experiment.created_by_profile?.display_name ?? null,
    tags: tagNames(snapshot.tags),
    blocks: snapshotBlocks(revision),
    record: {
      kind: 'revision',
      revisionId: revision.id,
      revisionNumber: revision.revision_number,
      contentHash: revision.content_hash,
      createdAt: revision.created_at,
      signature: verifiedSignature(revision, signature),
    },
  };
}

export function pdfFileName(model: PdfModel): string {
  const base = `${model.experimentId}_${model.title.replace(/\s+/g, '_').slice(0, 40)}`;
  if (model.record.kind === 'live') return `${base}_working-copy.pdf`;
  return `${base}_v${model.record.revisionNumber}${model.record.signature ? '_signed' : ''}.pdf`;
}
