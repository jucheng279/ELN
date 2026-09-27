import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import Underline from '@tiptap/extension-underline';
import Subscript from '@tiptap/extension-subscript';
import Superscript from '@tiptap/extension-superscript';
import Highlight from '@tiptap/extension-highlight';
import type { ResultContent } from '@/lib/types';

const DEFAULT: ResultContent = { label: 'Results', html: '' };

export default function ResultBlock({
  block,
  onUpdate,
  readOnly,
}: {
  block: { content: ResultContent };
  onUpdate: (content: ResultContent) => void;
  readOnly: boolean;
}) {
  const data: ResultContent = { ...DEFAULT, ...block.content };

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: false }),
      Placeholder.configure({ placeholder: 'Enter results...' }),
      Underline,
      Subscript,
      Superscript,
      Highlight,
    ],
    content: data.html,
    editable: !readOnly,
    onUpdate: ({ editor: e }) => {
      onUpdate({ ...data, html: e.getHTML() });
    },
  });

  return (
    <div className="rounded-lg border border-green-200 bg-green-50/30">
      <div className="flex items-center gap-2 border-b border-green-200 px-3 py-2">
        <div className="h-2 w-2 rounded-full bg-green-500" />
        {!readOnly ? (
          <input
            type="text"
            value={data.label}
            onChange={(e) => onUpdate({ ...data, label: e.target.value })}
            className="text-sm font-semibold text-green-800 bg-transparent outline-none placeholder:text-green-400"
            placeholder="Section label"
          />
        ) : (
          <span className="text-sm font-semibold text-green-800">{data.label}</span>
        )}
      </div>
      <div className="px-3 py-2">
        <EditorContent
          editor={editor}
          className="prose prose-sm max-w-none text-gray-800 focus:outline-none [&_.ProseMirror]:outline-none [&_.ProseMirror]:min-h-[2rem]"
        />
      </div>
    </div>
  );
}
