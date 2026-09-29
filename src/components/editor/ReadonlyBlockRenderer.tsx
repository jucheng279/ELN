import { useState, useEffect } from 'react';
import DOMPurify from 'dompurify';
import {
  AlertCircle, CheckSquare, Square, Code2, Image as ImageIcon,
  Paperclip, Link2, GitBranch, BarChart3, Beaker, Shield, Download,
  Clock, Thermometer, AlertTriangle,
} from 'lucide-react';
import { getSignedUrl } from '@/lib/storage';
import type {
  BlockType, BlockContent, ParagraphContent, HeadingContent, ListContent,
  ChecklistContent, CalloutContent, ParameterBlockContent, TableContent,
  ImageContent, AttachmentContent, CodeContent, ProtocolBlockContent,
  ResultContent, ReferenceContent, RelatedExperimentContent,
} from '@/lib/types';

interface ReadonlyBlockRendererProps {
  type: BlockType;
  content: BlockContent;
  provenanceContext?: ProvenanceContext;
}

export interface ProvenanceContext {
  attachmentProvenance?: Array<{
    block_id: string;
    attachment_version_id: string;
    version_number: number;
    storage_path: string;
    checksum: string | null;
    file_size: number;
    original_filename: string;
    display_name: string;
    mime_type: string;
  }>;
  protocolProvenance?: Array<{
    block_id: string;
    experiment_protocol_id: string;
    snapshot: {
      protocol_name?: string;
      version_number?: number;
      steps?: Array<{ step_number: number; instruction: string; duration?: string | null; temperature?: string | null; warnings?: string | null; notes?: string | null }>;
    };
    deviations?: Array<{
      step_index: number;
      original_value: string;
      actual_value: string;
      reason: string;
    }>;
  }>;
  blockId?: string;
}

function sanitize(html: string): string {
  return DOMPurify.sanitize(html);
}

function checksumFingerprint(checksum: string | null | undefined): string | null {
  if (!checksum || checksum.length < 12) return null;
  return `${checksum.slice(0, 6)}\u2026${checksum.slice(-4)}`;
}

function formatFileSize(bytes: number): string {
  if (!bytes || bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function RoParagraph({ content }: { content: ParagraphContent }) {
  return (
    <div
      className="prose prose-sm dark:prose-invert max-w-none"
      dangerouslySetInnerHTML={{ __html: sanitize(content.html || '') }}
    />
  );
}

function RoHeading({ content }: { content: HeadingContent }) {
  const level = content.level ?? 2;
  const sizes: Record<number, string> = {
    1: 'text-2xl font-bold', 2: 'text-xl font-semibold', 3: 'text-lg font-semibold',
    4: 'text-base font-semibold', 5: 'text-sm font-semibold', 6: 'text-sm font-medium',
  };
  const className = sizes[level] || sizes[2];
  const html = sanitize(content.html || '');
  if (level === 1) return <h1 className={className} dangerouslySetInnerHTML={{ __html: html }} />;
  if (level === 3) return <h3 className={className} dangerouslySetInnerHTML={{ __html: html }} />;
  if (level === 4) return <h4 className={className} dangerouslySetInnerHTML={{ __html: html }} />;
  if (level === 5) return <h5 className={className} dangerouslySetInnerHTML={{ __html: html }} />;
  if (level === 6) return <h6 className={className} dangerouslySetInnerHTML={{ __html: html }} />;
  return <h2 className={className} dangerouslySetInnerHTML={{ __html: html }} />;
}

function RoList({ content }: { content: ListContent }) {
  const isNumbered = content.type === 'numbered';
  return isNumbered ? (
    <ol className="list-decimal pl-6 space-y-1">
      {(content.items || []).map((item, i) => (
        <li key={i} className="text-sm" dangerouslySetInnerHTML={{ __html: sanitize(item) }} />
      ))}
    </ol>
  ) : (
    <ul className="list-disc pl-6 space-y-1">
      {(content.items || []).map((item, i) => (
        <li key={i} className="text-sm" dangerouslySetInnerHTML={{ __html: sanitize(item) }} />
      ))}
    </ul>
  );
}

function RoChecklist({ content }: { content: ChecklistContent }) {
  return (
    <div className="space-y-1">
      {(content.items || []).map((item, i) => (
        <div key={i} className="flex items-start gap-2">
          {item.checked ? (
            <CheckSquare className="h-4 w-4 mt-0.5 text-green-600 shrink-0" />
          ) : (
            <Square className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
          )}
          <span
            className={`text-sm ${item.checked ? 'line-through text-muted-foreground' : ''}`}
            dangerouslySetInnerHTML={{ __html: sanitize(item.text || '') }}
          />
        </div>
      ))}
    </div>
  );
}

function RoCallout({ content }: { content: CalloutContent }) {
  const variants: Record<string, string> = {
    info: 'bg-blue-50 border-blue-200 dark:bg-blue-950/30 dark:border-blue-800',
    warning: 'bg-amber-50 border-amber-200 dark:bg-amber-950/30 dark:border-amber-800',
    error: 'bg-red-50 border-red-200 dark:bg-red-950/30 dark:border-red-800',
    success: 'bg-green-50 border-green-200 dark:bg-green-950/30 dark:border-green-800',
  };
  return (
    <div className={`flex items-start gap-2.5 rounded-md border px-3 py-2.5 ${variants[content.type || 'info'] || variants.info}`}>
      <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
      <div className="text-sm" dangerouslySetInnerHTML={{ __html: sanitize(content.html || '') }} />
    </div>
  );
}

function RoParameters({ content }: { content: ParameterBlockContent }) {
  return (
    <div className="rounded-md border">
      <div className="px-3 py-2 bg-muted/50 border-b text-xs font-medium text-muted-foreground flex items-center gap-1.5">
        <Beaker className="h-3.5 w-3.5" />
        Parameters
      </div>
      <div className="divide-y">
        {(content.parameters || []).map((p, i) => (
          <div key={i} className="flex items-center gap-3 px-3 py-2">
            <span className="text-sm font-medium min-w-[120px]">{p.name}</span>
            <span className="text-sm text-muted-foreground">{p.value}</span>
            {p.unit && <span className="text-xs text-muted-foreground">({p.unit})</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

function RoTable({ content }: { content: TableContent }) {
  const rows = content.rows || [];
  const headers = (content.columns || []).map(c => c.name);
  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full text-sm">
        {headers.length > 0 && (
          <thead className="bg-muted/50">
            <tr>
              {headers.map((h, i) => (
                <th key={i} className="px-3 py-2 text-left font-medium text-muted-foreground border-b">{h}</th>
              ))}
            </tr>
          </thead>
        )}
        <tbody className="divide-y">
          {rows.map((row, ri) => (
            <tr key={ri}>
              {row.map((cell, ci) => (
                <td key={ci} className="px-3 py-2">{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RoImage({ content, provenance }: { content: ImageContent; provenance?: ProvenanceContext['attachmentProvenance'] }) {
  const [resolvedUrl, setResolvedUrl] = useState<string>('');
  const path = content.storagePath;
  const prov = provenance?.[0];
  const effectivePath = prov?.storage_path ?? path;
  const checksum = prov?.checksum ?? content.checksum;
  const versionNumber = prov?.version_number ?? content.versionNumber;
  const fingerprint = checksumFingerprint(checksum);

  useEffect(() => {
    if (effectivePath) {
      getSignedUrl(effectivePath).then(setResolvedUrl).catch(() => setResolvedUrl(''));
    }
  }, [effectivePath]);

  const hasImage = resolvedUrl || content.url;

  return (
    <figure className="space-y-1">
      <div className="rounded-md overflow-hidden border bg-muted/30">
        {hasImage ? (
          <img
            src={resolvedUrl || content.url || ''}
            alt={content.alt || content.filename || 'Image'}
            className="w-full max-h-[500px] object-contain"
          />
        ) : (
          <ImageIcon className="h-12 w-12 mx-auto my-8 text-muted-foreground/30" />
        )}
      </div>
      <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
        {content.filename && <span>{content.filename}</span>}
        {content.fileSize > 0 && <span>&middot; {formatFileSize(content.fileSize)}</span>}
        {versionNumber && versionNumber > 1 && (
          <span className="rounded bg-muted px-1 py-0.5 font-mono">v{versionNumber}</span>
        )}
        {fingerprint && (
          <span className="inline-flex items-center gap-0.5 rounded bg-muted px-1 py-0.5 font-mono" title={`SHA-256 ${checksum}`}>
            <Shield className="h-2.5 w-2.5" />
            {fingerprint}
          </span>
        )}
      </div>
      {content.caption && <figcaption className="text-xs text-center text-muted-foreground">{content.caption}</figcaption>}
    </figure>
  );
}

function RoAttachment({ content, provenance }: { content: AttachmentContent; provenance?: ProvenanceContext['attachmentProvenance'] }) {
  const prov = provenance?.[0];
  const effectivePath = prov?.storage_path ?? content.storagePath;
  const checksum = prov?.checksum ?? content.checksum;
  const versionNumber = prov?.version_number ?? content.versionNumber;
  const fingerprint = checksumFingerprint(checksum);

  async function handleDownload() {
    if (!effectivePath) return;
    try {
      const url = await getSignedUrl(effectivePath);
      window.open(url, '_blank');
    } catch { /* ignore */ }
  }

  return (
    <div className="flex items-center gap-2 rounded-md border px-3 py-2 bg-muted/30">
      <Paperclip className="h-4 w-4 text-muted-foreground shrink-0" />
      <div className="flex-1 min-w-0">
        <span className="text-sm truncate block">{content.displayName || content.filename || 'Attachment'}</span>
        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
          {content.fileSize > 0 && <span>{formatFileSize(content.fileSize)}</span>}
          {versionNumber > 1 && (
            <span className="rounded bg-muted px-1 py-0.5 font-mono">v{versionNumber}</span>
          )}
          {fingerprint && (
            <span className="inline-flex items-center gap-0.5 rounded bg-muted px-1 py-0.5 font-mono" title={`SHA-256 ${checksum}`}>
              <Shield className="h-2.5 w-2.5" />
              {fingerprint}
            </span>
          )}
        </div>
      </div>
      {effectivePath && (
        <button onClick={handleDownload} className="rounded p-1 text-muted-foreground hover:text-foreground" title="Download">
          <Download className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

function RoCode({ content }: { content: CodeContent }) {
  return (
    <div className="rounded-md border overflow-hidden">
      {content.language && (
        <div className="bg-muted/50 px-3 py-1.5 border-b flex items-center gap-1.5">
          <Code2 className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs text-muted-foreground">{content.language}</span>
        </div>
      )}
      <pre className="px-3 py-2 text-sm overflow-x-auto bg-muted/20">
        <code>{content.code || ''}</code>
      </pre>
    </div>
  );
}

function RoProtocol({ content, provenance }: { content: ProtocolBlockContent; provenance?: ProvenanceContext['protocolProvenance'] }) {
  const prov = provenance?.[0];
  const protocolName = prov?.snapshot?.protocol_name ?? content.protocol_name;
  const versionNumber = prov?.snapshot?.version_number ?? content.version_number;
  const steps = prov?.snapshot?.steps ?? content.steps ?? [];
  const deviations = prov?.deviations ?? content.deviations ?? [];

  return (
    <div className="rounded-md border">
      <div className="px-3 py-2 bg-muted/50 border-b flex items-center gap-1.5">
        <GitBranch className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-sm font-medium">{protocolName || 'Protocol'}</span>
        {versionNumber > 0 && (
          <span className="text-xs bg-muted rounded px-1.5 py-0.5 font-mono text-muted-foreground">v{versionNumber}</span>
        )}
        {prov && (
          <span className="inline-flex items-center gap-0.5 text-[10px] font-mono text-muted-foreground">
            <Shield className="h-2.5 w-2.5" />
            pinned
          </span>
        )}
      </div>
      {steps.length > 0 ? (
        <div className="divide-y divide-border">
          {steps.map((step, index) => {
            const deviation = deviations.find((d) => d.step_index === index);
            return (
              <div key={index} className={`px-3 py-2 ${deviation ? 'bg-amber-50 border-l-4 border-amber-400' : ''}`}>
                <div className="flex items-start gap-2.5">
                  <div className="w-6 h-6 rounded-full bg-blue-100 text-blue-700 text-xs font-medium flex items-center justify-center shrink-0 mt-0.5">
                    {step.step_number}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm">{step.instruction}</p>
                    {(step.duration || step.temperature) && (
                      <div className="flex items-center gap-2.5 mt-1">
                        {step.duration && (
                          <span className="inline-flex items-center gap-0.5 text-xs text-muted-foreground">
                            <Clock className="h-3 w-3" />{step.duration}
                          </span>
                        )}
                        {step.temperature && (
                          <span className="inline-flex items-center gap-0.5 text-xs text-muted-foreground">
                            <Thermometer className="h-3 w-3" />{step.temperature}
                          </span>
                        )}
                      </div>
                    )}
                    {step.warnings && (
                      <div className="flex items-center gap-1 mt-1">
                        <AlertTriangle className="h-3 w-3 text-amber-500" />
                        <span className="text-xs text-amber-600">{step.warnings}</span>
                      </div>
                    )}
                    {deviation && (
                      <div className="mt-1.5 pl-2.5 border-l-2 border-amber-300">
                        <p className="text-xs font-medium text-amber-700">
                          Deviation: <span className="font-normal">{deviation.actual_value}</span>
                        </p>
                        <p className="text-xs text-amber-600 mt-0.5">
                          Reason: <span className="font-normal">{deviation.reason}</span>
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="px-3 py-4 text-center text-sm text-muted-foreground">No steps</div>
      )}
    </div>
  );
}

function RoResult({ content }: { content: ResultContent }) {
  return (
    <div className="rounded-md border">
      <div className="px-3 py-2 bg-muted/50 border-b flex items-center gap-1.5">
        <BarChart3 className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-sm font-medium">{content.label || 'Result'}</span>
      </div>
      {content.html && (
        <div className="px-3 py-2 text-sm" dangerouslySetInnerHTML={{ __html: sanitize(content.html) }} />
      )}
    </div>
  );
}

function RoReference({ content }: { content: ReferenceContent }) {
  return (
    <div className="flex items-center gap-2 rounded-md border px-3 py-2 bg-muted/30">
      <Link2 className="h-4 w-4 text-muted-foreground shrink-0" />
      <span className="text-sm">{content.title || content.url || 'Reference'}</span>
    </div>
  );
}

function RoRelatedExperiment({ content }: { content: RelatedExperimentContent }) {
  return (
    <div className="flex items-center gap-2 rounded-md border px-3 py-2 bg-muted/30">
      <Beaker className="h-4 w-4 text-muted-foreground shrink-0" />
      <span className="text-sm">{content.title || content.experiment_id || 'Related experiment'}</span>
    </div>
  );
}

export default function ReadonlyBlockRenderer({ type, content, provenanceContext }: ReadonlyBlockRendererProps) {
  const blockId = provenanceContext?.blockId;
  const attProv = blockId
    ? provenanceContext?.attachmentProvenance?.filter((p) => p.block_id === blockId)
    : undefined;
  const protProv = blockId
    ? provenanceContext?.protocolProvenance?.filter((p) => p.block_id === blockId)
    : undefined;

  switch (type) {
    case 'paragraph':
      return <RoParagraph content={content as ParagraphContent} />;
    case 'heading':
      return <RoHeading content={content as HeadingContent} />;
    case 'list':
      return <RoList content={content as ListContent} />;
    case 'checklist':
      return <RoChecklist content={content as ChecklistContent} />;
    case 'callout':
      return <RoCallout content={content as CalloutContent} />;
    case 'divider':
      return <hr className="border-border" />;
    case 'parameters':
      return <RoParameters content={content as ParameterBlockContent} />;
    case 'table':
      return <RoTable content={content as TableContent} />;
    case 'image':
      return <RoImage content={content as ImageContent} provenance={attProv} />;
    case 'attachment':
      return <RoAttachment content={content as AttachmentContent} provenance={attProv} />;
    case 'code':
      return <RoCode content={content as CodeContent} />;
    case 'protocol':
      return <RoProtocol content={content as ProtocolBlockContent} provenance={protProv} />;
    case 'result':
      return <RoResult content={content as ResultContent} />;
    case 'reference':
      return <RoReference content={content as ReferenceContent} />;
    case 'related_experiment':
      return <RoRelatedExperiment content={content as RelatedExperimentContent} />;
    default:
      return (
        <div className="flex items-center justify-center rounded-md border border-dashed border-gray-300 bg-gray-50 px-4 py-3">
          <p className="text-sm text-gray-400">
            Unknown block type: <code className="font-mono text-gray-500">{type}</code>
          </p>
        </div>
      );
  }
}
