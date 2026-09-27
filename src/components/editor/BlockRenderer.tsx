import type { ExperimentBlock } from '@/lib/types';
import TextBlock from '@/components/editor/blocks/TextBlock';
import HeadingBlock from '@/components/editor/blocks/HeadingBlock';
import ListBlock from '@/components/editor/blocks/ListBlock';
import ChecklistBlock from '@/components/editor/blocks/ChecklistBlock';
import CalloutBlock from '@/components/editor/blocks/CalloutBlock';
import DividerBlock from '@/components/editor/blocks/DividerBlock';
import ParameterBlock from '@/components/editor/blocks/ParameterBlock';
import TableBlock from '@/components/editor/blocks/TableBlock';
import ImageBlock from '@/components/editor/blocks/ImageBlock';
import CodeBlock from '@/components/editor/blocks/CodeBlock';
import ProtocolBlock from '@/components/editor/blocks/ProtocolBlock';
import ReferenceBlock from '@/components/editor/blocks/ReferenceBlock';
import RelatedExperimentBlock from '@/components/editor/blocks/RelatedExperimentBlock';
import AttachmentBlock from '@/components/editor/blocks/AttachmentBlock';
import ResultBlock from '@/components/editor/blocks/ResultBlock';

// ──────────────────────────────────────────────
// Props
// ──────────────────────────────────────────────

interface BlockRendererProps {
  block: ExperimentBlock;
  onUpdate: (content: any) => void;
  readOnly: boolean;
  onSlashCommand?: (rect: { top: number; left: number }) => void;
}

// ──────────────────────────────────────────────
// Component
// ──────────────────────────────────────────────

export default function BlockRenderer({
  block,
  onUpdate,
  readOnly,
  onSlashCommand,
}: BlockRendererProps) {
  const { type, content } = block;

  switch (type) {
    case 'paragraph':
      return (
        <TextBlock
          content={content}
          onUpdate={onUpdate}
          readOnly={readOnly}
          onSlashCommand={onSlashCommand}
        />
      );

    case 'heading':
      return (
        <HeadingBlock
          content={content}
          onUpdate={onUpdate}
          readOnly={readOnly}
        />
      );

    case 'list':
      return (
        <ListBlock
          content={content}
          onUpdate={onUpdate}
          readOnly={readOnly}
        />
      );

    case 'checklist':
      return (
        <ChecklistBlock
          content={content}
          onUpdate={onUpdate}
          readOnly={readOnly}
        />
      );

    case 'callout':
      return (
        <CalloutBlock
          content={content}
          onUpdate={onUpdate}
          readOnly={readOnly}
        />
      );

    case 'divider':
      return <DividerBlock content={content} onUpdate={onUpdate} readOnly={readOnly} />;

    case 'parameters':
      return (
        <ParameterBlock
          content={content}
          onUpdate={onUpdate}
          readOnly={readOnly}
        />
      );

    case 'table':
      return (
        <TableBlock
          content={content}
          onUpdate={onUpdate}
          readOnly={readOnly}
        />
      );

    case 'image':
      return (
        <ImageBlock
          content={content}
          onUpdate={onUpdate}
          readOnly={readOnly}
        />
      );

    case 'code':
      return (
        <CodeBlock
          content={content}
          onUpdate={onUpdate}
          readOnly={readOnly}
        />
      );

    case 'protocol':
      return (
        <ProtocolBlock
          content={content}
          onUpdate={onUpdate}
          readOnly={readOnly}
        />
      );

    case 'reference':
      return (
        <ReferenceBlock
          content={content}
          onUpdate={onUpdate}
          readOnly={readOnly}
        />
      );

    case 'related_experiment':
      return (
        <RelatedExperimentBlock
          content={content}
          onUpdate={onUpdate}
          readOnly={readOnly}
        />
      );

    case 'attachment':
      return (
        <AttachmentBlock
          block={{ content }}
          onUpdate={onUpdate}
          readOnly={readOnly}
        />
      );

    case 'result':
      return (
        <ResultBlock
          block={{ content }}
          onUpdate={onUpdate}
          readOnly={readOnly}
        />
      );

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
