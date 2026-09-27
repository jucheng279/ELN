import { useState, useEffect, useCallback, useRef } from 'react';
import type { Editor } from '@tiptap/react';
import {
  Bold,
  Italic,
  Underline,
  Strikethrough,
  Code,
  Link,
  Superscript,
  Subscript,
  Highlighter,
} from 'lucide-react';

interface FloatingToolbarProps {
  editor: Editor;
}

interface ToolbarButton {
  label: string;
  icon: React.ElementType;
  action: () => void;
  isActive: () => boolean;
}

export default function FloatingToolbar({ editor }: FloatingToolbarProps) {
  const [show, setShow] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const barRef = useRef<HTMLDivElement>(null);

  const updatePosition = useCallback(() => {
    const { from, to } = editor.state.selection;
    if (from === to) {
      setShow(false);
      return;
    }

    const view = editor.view;
    const start = view.coordsAtPos(from);
    const end = view.coordsAtPos(to);

    const top = start.top - 44;
    const left = (start.left + end.left) / 2;

    setPos({ top, left });
    setShow(true);
  }, [editor]);

  useEffect(() => {
    const handler = () => {
      requestAnimationFrame(updatePosition);
    };

    editor.on('selectionUpdate', handler);
    editor.on('blur', () => setShow(false));
    editor.on('focus', handler);

    return () => {
      editor.off('selectionUpdate', handler);
      editor.off('blur', () => setShow(false));
      editor.off('focus', handler);
    };
  }, [editor, updatePosition]);

  const handleLink = useCallback(() => {
    const previousUrl = editor.getAttributes('link').href || '';
    const url = window.prompt('Enter URL:', previousUrl);
    if (url === null) return;
    if (url === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
  }, [editor]);

  const buttons: ToolbarButton[] = [
    { label: 'Bold', icon: Bold, action: () => editor.chain().focus().toggleBold().run(), isActive: () => editor.isActive('bold') },
    { label: 'Italic', icon: Italic, action: () => editor.chain().focus().toggleItalic().run(), isActive: () => editor.isActive('italic') },
    { label: 'Underline', icon: Underline, action: () => editor.chain().focus().toggleUnderline().run(), isActive: () => editor.isActive('underline') },
    { label: 'Strikethrough', icon: Strikethrough, action: () => editor.chain().focus().toggleStrike().run(), isActive: () => editor.isActive('strike') },
    { label: 'Code', icon: Code, action: () => editor.chain().focus().toggleCode().run(), isActive: () => editor.isActive('code') },
    { label: 'Link', icon: Link, action: handleLink, isActive: () => editor.isActive('link') },
    { label: 'Superscript', icon: Superscript, action: () => editor.chain().focus().toggleSuperscript().run(), isActive: () => editor.isActive('superscript') },
    { label: 'Subscript', icon: Subscript, action: () => editor.chain().focus().toggleSubscript().run(), isActive: () => editor.isActive('subscript') },
    { label: 'Highlight', icon: Highlighter, action: () => editor.chain().focus().toggleHighlight().run(), isActive: () => editor.isActive('highlight') },
  ];

  if (!show) return null;

  return (
    <div
      ref={barRef}
      className="fixed z-50 flex items-center gap-0.5 rounded-lg bg-gray-800 px-1 py-1 shadow-xl"
      style={{ top: `${pos.top}px`, left: `${pos.left}px`, transform: 'translateX(-50%)' }}
      onMouseDown={(e) => e.preventDefault()}
    >
      {buttons.map((button) => {
        const Icon = button.icon;
        const active = button.isActive();
        return (
          <button
            key={button.label}
            onClick={button.action}
            title={button.label}
            className={`rounded p-1.5 text-xs font-semibold transition-colors ${
              active
                ? 'bg-gray-600 text-white'
                : 'text-gray-300 hover:bg-gray-700 hover:text-white'
            }`}
          >
            <Icon className="h-4 w-4" />
          </button>
        );
      })}
    </div>
  );
}
