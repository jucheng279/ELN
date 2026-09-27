import { useState, useEffect, useRef, useCallback } from 'react';
import type { BlockType } from '@/lib/types';
import {
  Type,
  Heading,
  List,
  CheckSquare,
  Table,
  Sliders,
  Image,
  ClipboardList,
  BookOpen,
  AlertCircle,
  Minus,
  Code,
} from 'lucide-react';

interface BlockTypeOption {
  type: BlockType;
  label: string;
  icon: React.ElementType;
  description: string;
}

const BLOCK_TYPES: BlockTypeOption[] = [
  { type: 'paragraph', label: 'Text', icon: Type, description: 'Plain text paragraph' },
  { type: 'heading', label: 'Heading', icon: Heading, description: 'Section heading' },
  { type: 'list', label: 'List', icon: List, description: 'Bulleted or numbered list' },
  { type: 'checklist', label: 'Checklist', icon: CheckSquare, description: 'Task checklist' },
  { type: 'table', label: 'Table', icon: Table, description: 'Data table' },
  { type: 'parameters', label: 'Parameters', icon: Sliders, description: 'Structured parameters' },
  { type: 'image', label: 'Image', icon: Image, description: 'Upload an image' },
  { type: 'protocol', label: 'Protocol', icon: ClipboardList, description: 'Insert a protocol' },
  { type: 'reference', label: 'Reference', icon: BookOpen, description: 'Scientific reference' },
  { type: 'callout', label: 'Callout', icon: AlertCircle, description: 'Note or callout' },
  { type: 'divider', label: 'Divider', icon: Minus, description: 'Horizontal divider' },
  { type: 'code', label: 'Code', icon: Code, description: 'Code block' },
];

interface BlockTypeMenuProps {
  position: { top: number; left: number };
  onSelect: (type: BlockType) => void;
  onClose: () => void;
  filter?: string;
}

export default function BlockTypeMenu({ position, onSelect, onClose, filter }: BlockTypeMenuProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const menuRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const filteredItems = filter
    ? BLOCK_TYPES.filter((item) =>
        item.label.toLowerCase().includes(filter.toLowerCase())
      )
    : BLOCK_TYPES;

  // Reset selection when filter changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [filter]);

  // Scroll selected item into view
  useEffect(() => {
    const el = itemRefs.current[selectedIndex];
    if (el) {
      el.scrollIntoView({ block: 'nearest' });
    }
  }, [selectedIndex]);

  // Close on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setSelectedIndex((prev) => (prev + 1) % filteredItems.length);
          break;
        case 'ArrowUp':
          e.preventDefault();
          setSelectedIndex((prev) => (prev - 1 + filteredItems.length) % filteredItems.length);
          break;
        case 'Enter':
          e.preventDefault();
          if (filteredItems[selectedIndex]) {
            onSelect(filteredItems[selectedIndex].type);
          }
          break;
        case 'Escape':
          e.preventDefault();
          onClose();
          break;
      }
    },
    [filteredItems, selectedIndex, onSelect, onClose]
  );

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  if (filteredItems.length === 0) {
    return (
      <div
        ref={menuRef}
        className="fixed z-50 w-72 rounded-lg border border-gray-200 bg-white p-3 shadow-lg"
        style={{ top: position.top, left: position.left }}
      >
        <p className="text-sm text-gray-400">No matching blocks</p>
      </div>
    );
  }

  return (
    <div
      ref={menuRef}
      className="fixed z-50 w-72 max-h-80 overflow-y-auto rounded-lg border border-gray-200 bg-white py-1 shadow-lg"
      style={{ top: position.top, left: position.left }}
    >
      {filteredItems.map((item, index) => {
        const Icon = item.icon;
        const isSelected = index === selectedIndex;
        return (
          <button
            key={item.type}
            ref={(el) => {
              itemRefs.current[index] = el;
            }}
            onClick={() => onSelect(item.type)}
            onMouseEnter={() => setSelectedIndex(index)}
            className={`flex w-full items-center gap-3 px-3 py-2 text-left transition-colors ${
              isSelected ? 'bg-gray-100' : 'hover:bg-gray-50'
            }`}
          >
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-gray-100 text-gray-500">
              <Icon className="h-4 w-4" />
            </div>
            <div>
              <div className="text-sm font-medium text-gray-900">{item.label}</div>
              <div className="text-xs text-gray-500">{item.description}</div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
