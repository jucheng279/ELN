import { useEffect, useRef } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import Underline from '@tiptap/extension-underline';
import Link from '@tiptap/extension-link';
import Subscript from '@tiptap/extension-subscript';
import Superscript from '@tiptap/extension-superscript';
import Highlight from '@tiptap/extension-highlight';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import FloatingToolbar from '@/components/editor/FloatingToolbar';
import type { ParagraphContent } from '@/lib/types';

interface TextBlockProps {
  content: ParagraphContent;
  onUpdate: (content: ParagraphContent) => void;
  readOnly: boolean;
  onSlashCommand?: (rect: { top: number; left: number }) => void;
}

export default function TextBlock({
  content,
  onUpdate,
  readOnly,
  onSlashCommand,
}: TextBlockProps) {
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const editor = useEditor({
    extensions: [
      StarterKit,
      Placeholder.configure({
        placeholder: 'Type something...',
      }),
      Underline,
      Link.configure({
        openOnClick: false,
      }),
      Subscript,
      Superscript,
      Highlight,
      TaskList,
      TaskItem.configure({
        nested: true,
      }),
    ],
    content: content?.html || '',
    editable: !readOnly,
    onUpdate: ({ editor }) => {
      const textContent = editor.getText();

      if (textContent === '/') {
        const { view } = editor;
        const coords = view.coordsAtPos(view.state.selection.from);
        onSlashCommand?.({ top: coords.bottom, left: coords.left });
      }

      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
      }

      debounceTimer.current = setTimeout(() => {
        onUpdate({ html: editor.getHTML() });
      }, 500);
    },
  });

  useEffect(() => {
    if (editor) {
      editor.setEditable(!readOnly);
    }
  }, [editor, readOnly]);

  useEffect(() => {
    if (editor && !editor.isFocused) {
      const currentHtml = editor.getHTML();
      const newHtml = content?.html || '';
      if (currentHtml !== newHtml) {
        editor.commands.setContent(newHtml);
      }
    }
  }, [editor, content?.html]);

  useEffect(() => {
    return () => {
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
      }
    };
  }, []);

  return (
    <div className="prose prose-sm max-w-none text-base leading-relaxed text-gray-800">
      <style>{`
        .ProseMirror {
          outline: none;
        }
        .ProseMirror p.is-editor-empty:first-child::before {
          content: attr(data-placeholder);
          float: left;
          color: #adb5bd;
          pointer-events: none;
          height: 0;
        }
      `}</style>
      {editor && !readOnly && <FloatingToolbar editor={editor} />}
      <EditorContent editor={editor} />
    </div>
  );
}
