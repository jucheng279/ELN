import DOMPurify from 'dompurify';
import {
  AlertCircle, CheckSquare, Square, Code2, FileText, Image as ImageIcon,
  Paperclip, FlaskConical, Link2, GitBranch, BarChart3, Beaker,
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
  const Tag = `h${Math.min(Math.max(level, 1), 6)}` as keyof JSX.IntrinsicElements;
  const sizes: Record<number, string> = {
    1: 'text-2xl font-bold', 2: 'text-xl font-semibold', 3: 'text-lg font-semibold',
    4: 'text-base font-semibold', 5: 'text-sm font-semibold', 6: 'text-sm font-medium',
  };
  return (
    <Tag
      className={sizes[level] || sizes[2]}
      dangerouslySetInnerHTML={{ __html: sanitize(content.html || '') }}
    />
  );
}

function RoList({ content }: { content: ListContent }) {
  const isNumbered = content.type === 'numbered';
  const Tag = isNumbered ? 'ol' : 'ul';
  return (
    <Tag className={`${isNumbered ? 'list-decimal' : 'list-disc'} pl-6 space-y-1`}>
      {(content.items || []).map((item, i) => (
        <li key={i} className="text-sm" dangerouslySetInnerHTML={{ __html: sanitize(item) }} />
      ))}
    </Tag>
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
          <span className={`text-sm ${item.checked ? 'line-through text-muted-foreground' : ''}`}>
            {item.text}
          </span>
        </div>
      ))}
    </div>
  );
}

function RoCallout({ content }: { content: CalloutContent }) {
  const styles: Record<string, string> = {
    note: 'border-blue-300 bg-blue-50/50 dark:border-blue-700 dark:bg-blue-950/30',
    warning: 'border-amber-300 bg-amber-50/50 dark:border-amber-700 dark:bg-amber-950/30',
    tip: 'border-green-300 bg-green-50/50 dark:border-green-700 dark:bg-green-950/30',
    danger: 'border-red-300 bg-red-50/50 dark:border-red-700 dark:bg-red-950/30',
  };
  return (
    <div className={`border-l-4 rounded-r-md px-4 py-3 ${styles[content.type] || styles.note}`}>
      <div className="flex items-start gap-2">
        <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
        <div
          className="prose prose-sm dark:prose-invert max-w-none"
          dangerouslySetInnerHTML={{ __html: sanitize(content.html || '') }}
        />
      </div>
    </div>
  );
}

function RoParameters({ content }: { content: ParameterBlockContent }) {
  const params = content.parameters || [];
  if (params.length === 0) return <p className="text-sm text-muted-foreground italic">No parameters</p>;
  return (
    <div className="border rounded-md overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-muted/50">
            <th className="text-left px-3 py-1.5 font-medium">Name</th>
            <th className="text-left px-3 py-1.5 font-medium">Value</th>
            <th className="text-left px-3 py-1.5 font-medium">Unit</th>
            <th className="text-left px-3 py-1.5 font-medium">Description</th>
          </tr>
        </thead>
        <tbody>
          {params.map((p, i) => (
            <tr key={i} className="border-t">
              <td className="px-3 py-1.5 font-medium">{p.name}</td>
              <td className="px-3 py-1.5 font-mono">{p.value}</td>
              <td className="px-3 py-1.5">{p.unit}</td>
              <td className="px-3 py-1.5 text-muted-foreground">{p.description}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RoTable({ content }: { content: TableContent }) {
  const cols = content.columns || [];
  const rows = content.rows || [];
  return (
    <div className="border rounded-md overflow-x-auto">
      {content.caption && (
        <div className="px-3 py-1.5 text-sm text-muted-foreground border-b bg-muted/30">
          {content.caption}
        </div>
      )}
      <table className="w-full text-sm">
        {cols.length > 0 && (
          <thead>
            <tr className="bg-muted/50">
              {cols.map((col) => (
                <th key={col.id} className="text-left px-3 py-1.5 font-medium">{col.name}</th>
              ))}
            </tr>
          </thead>
        )}
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri} className="border-t">
              {row.map((cell, ci) => (
                <td key={ci} className="px-3 py-1.5">{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RoImage({ content }: { content: ImageContent }) {
  return (
    <figure className="space-y-1">
      {content.url ? (
        <img src={content.url} alt={content.alt || content.filename || 'Image'} className="max-w-full rounded-md" />
      ) : (
        <div className="flex items-center gap-2 rounded-md border border-dashed px-4 py-6 text-muted-foreground">
          <ImageIcon className="h-5 w-5" />
          <span className="text-sm">{content.filename || 'Image'}</span>
        </div>
      )}
      {content.caption && <figcaption className="text-sm text-muted-foreground">{content.caption}</figcaption>}
    </figure>
  );
}

function RoAttachment({ content }: { content: AttachmentContent }) {
  return (
    <div className="flex items-center gap-3 rounded-md border px-4 py-3 bg-muted/30">
      <Paperclip className="h-4 w-4 text-muted-foreground shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium truncate">{content.displayName || content.filename}</p>
        <p className="text-xs text-muted-foreground">
          {content.mimeType} {content.fileSize ? `· ${(content.fileSize / 1024).toFixed(1)} KB` : ''}
          {content.versionNumber ? ` · v${content.versionNumber}` : ''}
        </p>
      </div>
      {content.caption && <p className="text-xs text-muted-foreground">{content.caption}</p>}
    </div>
  );
}

function RoCode({ content }: { content: CodeContent }) {
  return (
    <div className="rounded-md border overflow-hidden">
      {content.language && (
        <div className="flex items-center gap-1.5 px-3 py-1 bg-muted/50 border-b text-xs text-muted-foreground">
          <Code2 className="h-3 w-3" />
          {content.language}
        </div>
      )}
      <pre className="p-3 overflow-x-auto bg-muted/20">
        <code className="text-sm font-mono">{content.code}</code>
      </pre>
    </div>
  );
}

function RoProtocol({ content }: { content: ProtocolBlockContent }) {
  return (
    <div className="rounded-md border overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 bg-muted/50 border-b">
        <Beaker className="h-4 w-4" />
        <span className="text-sm font-medium">{content.protocol_name || 'Protocol'}</span>
        {content.version_number > 0 && (
          <span className="text-xs text-muted-foreground">v{content.version_number}</span>
        )}
      </div>
      <div className="p-3 space-y-2">
        {(content.steps || []).map((step, i) => (
          <div key={i} className="flex gap-3">
            <span className="text-xs font-mono text-muted-foreground w-6 shrink-0 text-right pt-0.5">
              {step.step_number || i + 1}.
            </span>
            <div className="text-sm flex-1">
              <p>{step.instruction}</p>
              {(step.duration || step.temperature) && (
                <p className="text-xs text-muted-foreground mt-0.5">
                  {step.duration && `Duration: ${step.duration}`}
                  {step.duration && step.temperature && ' · '}
                  {step.temperature && `Temp: ${step.temperature}`}
                </p>
              )}
            </div>
          </div>
        ))}
        {(content.deviations || []).length > 0 && (
          <div className="mt-3 pt-3 border-t space-y-1">
            <p className="text-xs font-medium text-amber-600 dark:text-amber-400">Deviations</p>
            {content.deviations.map((d, i) => (
              <div key={i} className="text-xs text-muted-foreground">
                Step {d.step_index + 1}: {d.original_value} → {d.actual_value}
                {d.reason && ` (${d.reason})`}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function RoResult({ content }: { content: ResultContent }) {
  return (
    <div className="rounded-md border overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 bg-muted/50 border-b">
        <BarChart3 className="h-4 w-4" />
        <span className="text-sm font-medium">{content.label || 'Result'}</span>
      </div>
      <div
        className="p-3 prose prose-sm dark:prose-invert max-w-none"
        dangerouslySetInnerHTML={{ __html: sanitize(content.html || '') }}
      />
    </div>
  );
}

function RoReference({ content }: { content: ReferenceContent }) {
  return (
    <div className="flex items-start gap-2 rounded-md border px-3 py-2">
      <Link2 className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
      <div className="min-w-0 text-sm">
        <p className="font-medium">{content.title || 'Untitled reference'}</p>
        {content.citation && <p className="text-muted-foreground">{content.citation}</p>}
        {content.doi && <p className="text-xs font-mono text-muted-foreground">DOI: {content.doi}</p>}
        {content.notes && <p className="text-xs text-muted-foreground italic mt-1">{content.notes}</p>}
      </div>
    </div>
  );
}

function RoRelatedExperiment({ content }: { content: RelatedExperimentContent }) {
  return (
    <div className="flex items-center gap-2 rounded-md border px-3 py-2">
      <GitBranch className="h-4 w-4 text-muted-foreground shrink-0" />
      <div className="text-sm">
        <span className="font-mono text-xs text-muted-foreground mr-2">{content.experiment_display_id}</span>
        <span className="font-medium">{content.title}</span>
      </div>
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
      return <hr className="border-t" />;
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
        <div className="flex items-center justify-center rounded-md border border-dashed px-4 py-3">
          <p className="text-sm text-muted-foreground">
            Unknown block type: <code className="font-mono">{type}</code>
          </p>
        </div>
      );
  }
}
