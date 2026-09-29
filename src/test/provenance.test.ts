import { describe, it, expect } from 'vitest';

describe('SHA-256 checksum format', () => {
  const SHA256_RE = /^[0-9a-f]{64}$/;

  it('accepts a valid 64 hex-char checksum', () => {
    const valid = 'a'.repeat(64);
    expect(SHA256_RE.test(valid)).toBe(true);
  });

  it('rejects a short string', () => {
    expect(SHA256_RE.test('abc123')).toBe(false);
  });

  it('rejects uppercase hex', () => {
    expect(SHA256_RE.test('A'.repeat(64))).toBe(false);
  });

  it('rejects non-hex characters', () => {
    expect(SHA256_RE.test('g'.repeat(64))).toBe(false);
  });

  it('rejects empty string', () => {
    expect(SHA256_RE.test('')).toBe(false);
  });
});

describe('Checksum fingerprint display', () => {
  function checksumFingerprint(checksum: string | null | undefined): string | null {
    if (!checksum || checksum.length < 12) return null;
    return `${checksum.slice(0, 6)}\u2026${checksum.slice(-4)}`;
  }

  it('produces fingerprint from full hash', () => {
    const hash = 'abcdef' + '0'.repeat(54) + '1234';
    expect(checksumFingerprint(hash)).toBe('abcdef\u20261234');
  });

  it('returns null for null input', () => {
    expect(checksumFingerprint(null)).toBeNull();
  });

  it('returns null for short string', () => {
    expect(checksumFingerprint('abc')).toBeNull();
  });
});

describe('Provenance-safe block duplication', () => {
  interface BlockContent {
    [key: string]: unknown;
  }

  function duplicateBlockContent(type: string, content: BlockContent): BlockContent {
    const copy = { ...content };
    if (type === 'image' || type === 'attachment') {
      delete copy.attachmentVersionId;
      delete copy.checksum;
      delete copy.versionNumber;
    }
    if (type === 'protocol') {
      copy.experiment_protocol_id = null;
      copy.deviations = [];
    }
    return copy;
  }

  it('strips version pins from duplicated image blocks', () => {
    const original: BlockContent = {
      url: 'https://example.com/img.png',
      attachmentVersionId: 'ver-123',
      checksum: 'a'.repeat(64),
      versionNumber: 2,
      filename: 'img.png',
    };
    const dup = duplicateBlockContent('image', original);
    expect(dup.attachmentVersionId).toBeUndefined();
    expect(dup.checksum).toBeUndefined();
    expect(dup.versionNumber).toBeUndefined();
    expect(dup.url).toBe('https://example.com/img.png');
    expect(dup.filename).toBe('img.png');
  });

  it('strips version pins from duplicated attachment blocks', () => {
    const original: BlockContent = {
      filename: 'data.csv',
      attachmentVersionId: 'ver-456',
      checksum: 'b'.repeat(64),
      versionNumber: 3,
    };
    const dup = duplicateBlockContent('attachment', original);
    expect(dup.attachmentVersionId).toBeUndefined();
    expect(dup.checksum).toBeUndefined();
    expect(dup.versionNumber).toBeUndefined();
    expect(dup.filename).toBe('data.csv');
  });

  it('clears protocol instance from duplicated protocol blocks', () => {
    const original: BlockContent = {
      protocol_name: 'PCR',
      experiment_protocol_id: 'ep-789',
      deviations: [{ step_index: 0, actual_value: 'changed', reason: 'why' }],
      steps: [{ step_number: 1, instruction: 'Do stuff' }],
    };
    const dup = duplicateBlockContent('protocol', original);
    expect(dup.experiment_protocol_id).toBeNull();
    expect(dup.deviations).toEqual([]);
    expect(dup.protocol_name).toBe('PCR');
    expect(dup.steps).toBeDefined();
  });

  it('leaves paragraph blocks unchanged', () => {
    const original: BlockContent = { html: '<p>Hello</p>' };
    const dup = duplicateBlockContent('paragraph', original);
    expect(dup).toEqual(original);
  });

  it('does not mutate the original', () => {
    const original: BlockContent = {
      attachmentVersionId: 'ver-123',
      checksum: 'c'.repeat(64),
    };
    duplicateBlockContent('image', original);
    expect(original.attachmentVersionId).toBe('ver-123');
    expect(original.checksum).toBe('c'.repeat(64));
  });
});

describe('Snapshot V2 provenance detection', () => {
  it('detects V2 when attachment_provenance is present', () => {
    const snapshot = {
      blocks: [],
      attachment_provenance: [{ block_id: 'b1', storage_path: '/a' }],
      protocol_provenance: [],
    };
    const isV2 = snapshot.attachment_provenance.length > 0 || snapshot.protocol_provenance.length > 0;
    expect(isV2).toBe(true);
  });

  it('detects V2 when protocol_provenance is present', () => {
    const snapshot = {
      blocks: [],
      attachment_provenance: [],
      protocol_provenance: [{ block_id: 'b2', snapshot: {} }],
    };
    const isV2 = snapshot.attachment_provenance.length > 0 || snapshot.protocol_provenance.length > 0;
    expect(isV2).toBe(true);
  });

  it('detects V1 when neither provenance array is present', () => {
    const snapshot = {
      blocks: [],
      attachment_provenance: [],
      protocol_provenance: [],
    };
    const isV2 = snapshot.attachment_provenance.length > 0 || snapshot.protocol_provenance.length > 0;
    expect(isV2).toBe(false);
  });
});
