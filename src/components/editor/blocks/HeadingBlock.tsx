import { useEffect, useRef, useCallback } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';

interface HeadingBlockProps {
  content: any;
  onUpdate: (content: any) => void;
  readOnly: boolean;
}

const headingStyles: Record<number, string> = {
  1: 'text-3xl font-bold',
  2: 'text-2xl font-semibold',
  3: 'text-xl font-semibold',
};

export default function HeadingBlock({
  content,
  onUpdate,
  readOnly,
}: HeadingBlockProps) {
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const level = content?.level || 1;
  const html = content?.html || '';

  const editor = useEditor({
    extensions: [
      StarterKit,
      Placeholder.configure({
        placeholder: 'Heading',
      }),
    ],
    content: html,
    editable: !readOnly,
    onUpdate: ({ editor }) => {
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
      }

      debounceTimer.current = setTimeout(() => {
        onUpdate({ html: editor.getHTML(), level });
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

  const handleLevelChange = useCallback(
    (newLevel: number) => {
      onUpdate({ html: editor?.getHTML() || html, level: newLevel });
    },
    [editor, html, onUpdate]
  );

  return (
    <div>
      {!readOnly && (
        <div className="mb-1 flex items-center gap-1">
          {[1, 2, 3].map((lvl) => (
            <button
              key={lvl}
              type="button"
              onClick={() => handleLevelChange(lvl)}
              className={`rounded px-1.5 py-0.5 text-xs font-semibold transition-colors ${
                level === lvl
                  ? 'bg-gray-200 text-gray-900'
                  : 'text-gray-500 hover:bg-gray-100'
              }`}
            >
              H{lvl}
            </button>
          ))}
        </div>
      )}
      <div className={headingStyles[level] || headingStyles[1]}>
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
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}
