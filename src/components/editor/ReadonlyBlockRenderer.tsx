import DOMPurify from 'dompurify';
import {
  AlertCircle, CheckSquare, Square, Code2, Image as ImageIcon,
  Paperclip, Link2, GitBranch, BarChart3, Beaker,
} from 'lucide-react';
import type {
  BlockType, BlockContent, ParagraphContent, HeadingContent, ListContent,
  ChecklistContent, CalloutContent, ParameterBlockContent, TableContent,
  ImageContent, AttachmentContent, CodeContent, ProtocolBlockContent,
  ResultContent, ReferenceContent, RelatedExperimentContent,
} from '@/lib/types';

interface ReadonlyBlockRendererProps {
  type: BlockType;
  content: BlockContent;
}

function sanitize(html: string): string {
  return DOMPurify.sanitize(html);
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

function RoImage({ content }: { content: ImageContent }) {
  if (!content.url) return null;
  return (
    <figure className="space-y-1">
      <div className="rounded-md overflow-hidden border bg-muted/30">
        <ImageIcon className="h-12 w-12 mx-auto my-8 text-muted-foreground/30" />
      </div>
      {content.caption && <figcaption className="text-xs text-center text-muted-foreground">{content.caption}</figcaption>}
    </figure>
  );
}

function RoAttachment({ content }: { content: AttachmentContent }) {
  return (
    <div className="flex items-center gap-2 rounded-md border px-3 py-2 bg-muted/30">
      <Paperclip className="h-4 w-4 text-muted-foreground shrink-0" />
      <span className="text-sm truncate">{content.displayName || content.filename || 'Attachment'}</span>
      {content.fileSize > 0 && (
        <span className="text-xs text-muted-foreground ml-auto shrink-0">{(content.fileSize / 1024).toFixed(1)} KB</span>
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

function RoProtocol({ content }: { content: ProtocolBlockContent }) {
  return (
    <div className="rounded-md border">
      <div className="px-3 py-2 bg-muted/50 border-b flex items-center gap-1.5">
        <GitBranch className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-sm font-medium">{content.protocol_name || 'Protocol'}</span>
      </div>
      {content.steps && content.steps.length > 0 && (
        <ol className="list-decimal pl-8 pr-3 py-2 space-y-1">
          {content.steps.map((step, i) => (
            <li key={i} className="text-sm">{step.instruction}</li>
          ))}
        </ol>
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

export default function ReadonlyBlockRenderer({ type, content }: ReadonlyBlockRendererProps) {
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
      return <RoImage content={content as ImageContent} />;
    case 'attachment':
      return <RoAttachment content={content as AttachmentContent} />;
    case 'code':
      return <RoCode content={content as CodeContent} />;
    case 'protocol':
      return <RoProtocol content={content as ProtocolBlockContent} />;
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
