import type { ExperimentBlock, BlockContent } from '@/lib/types';
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
import type {
  ParagraphContent,
  HeadingContent,
  ListContent,
  ChecklistContent,
  CalloutContent,
  DividerContent,
  ParameterBlockContent,
  TableContent,
  ImageContent,
  CodeContent,
  ProtocolBlockContent,
  ReferenceContent,
  RelatedExperimentContent,
  AttachmentContent,
  ResultContent,
} from '@/lib/types';

interface BlockRendererProps {
  block: ExperimentBlock;
  onUpdate: (content: BlockContent) => void;
  readOnly: boolean;
  workspaceId?: string;
  experimentId?: string;
  onSlashCommand?: (rect: { top: number; left: number }) => void;
}

export default function BlockRenderer({
  block,
  onUpdate,
  readOnly,
  workspaceId,
  experimentId,
  onSlashCommand,
}: BlockRendererProps) {
  const { type, content } = block;

  switch (type) {
    case 'paragraph':
      return (
        <TextBlock
          content={content as ParagraphContent}
          onUpdate={onUpdate}
          readOnly={readOnly}
          onSlashCommand={onSlashCommand}
        />
      );

    case 'heading':
      return <HeadingBlock content={content as HeadingContent} onUpdate={onUpdate} readOnly={readOnly} />;

    case 'list':
      return <ListBlock content={content as ListContent} onUpdate={onUpdate} readOnly={readOnly} />;

    case 'checklist':
      return <ChecklistBlock content={content as ChecklistContent} onUpdate={onUpdate} readOnly={readOnly} />;

    case 'callout':
      return <CalloutBlock content={content as CalloutContent} onUpdate={onUpdate} readOnly={readOnly} />;

    case 'divider':
      return <DividerBlock content={content as DividerContent} onUpdate={onUpdate} readOnly={readOnly} />;

    case 'parameters':
      return <ParameterBlock content={content as ParameterBlockContent} onUpdate={onUpdate} readOnly={readOnly} />;

    case 'table':
      return <TableBlock content={content as TableContent} onUpdate={onUpdate} readOnly={readOnly} />;

    case 'image':
      return (
        <ImageBlock
          content={content as ImageContent}
          onUpdate={onUpdate}
          readOnly={readOnly}
          workspaceId={workspaceId}
          experimentId={experimentId}
        />
      );

    case 'code':
      return <CodeBlock content={content as CodeContent} onUpdate={onUpdate} readOnly={readOnly} />;

    case 'protocol':
      return (
        <ProtocolBlock
          content={content as ProtocolBlockContent}
          onUpdate={onUpdate}
          readOnly={readOnly}
          workspaceId={workspaceId}
          experimentId={experimentId}
        />
      );

    case 'reference':
      return <ReferenceBlock content={content as ReferenceContent} onUpdate={onUpdate} readOnly={readOnly} />;

    case 'related_experiment':
      return <RelatedExperimentBlock content={content as RelatedExperimentContent} onUpdate={onUpdate} readOnly={readOnly} />;

    case 'attachment':
      return (
        <AttachmentBlock
          block={{ content: content as AttachmentContent }}
          onUpdate={onUpdate}
          readOnly={readOnly}
          workspaceId={workspaceId}
          experimentId={experimentId}
        />
      );

    case 'result':
      return <ResultBlock block={{ content: content as ResultContent }} onUpdate={onUpdate} readOnly={readOnly} />;

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
