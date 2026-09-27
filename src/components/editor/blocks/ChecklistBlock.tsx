import { useState, useCallback, useRef, KeyboardEvent } from 'react';
import { Plus } from 'lucide-react';

interface ChecklistItem {
  text: string;
  checked: boolean;
}

interface ChecklistBlockProps {
  content: any;
  onUpdate: (content: any) => void;
  readOnly: boolean;
}

export default function ChecklistBlock({
  content,
  onUpdate,
  readOnly,
}: ChecklistBlockProps) {
  const items: ChecklistItem[] = content?.items || [
    { text: '', checked: false },
  ];
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  const updateItems = useCallback(
    (newItems: ChecklistItem[]) => {
      onUpdate({ items: newItems });
    },
    [onUpdate]
  );

  const handleToggleCheck = useCallback(
    (index: number) => {
      const newItems = items.map((item, i) =>
        i === index ? { ...item, checked: !item.checked } : item
      );
      updateItems(newItems);
    },
    [items, updateItems]
  );

  const handleTextChange = useCallback(
    (index: number, text: string) => {
      const newItems = items.map((item, i) =>
        i === index ? { ...item, text } : item
      );
      updateItems(newItems);
    },
    [items, updateItems]
  );

  const handleKeyDown = useCallback(
    (index: number, e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const newItems = [...items];
        newItems.splice(index + 1, 0, { text: '', checked: false });
        updateItems(newItems);

        requestAnimationFrame(() => {
          inputRefs.current[index + 1]?.focus();
        });
      }

      if (e.key === 'Backspace' && items[index].text === '' && items.length > 1) {
        e.preventDefault();
        const newItems = items.filter((_, i) => i !== index);
        updateItems(newItems);

        requestAnimationFrame(() => {
          const focusIndex = Math.max(0, index - 1);
          inputRefs.current[focusIndex]?.focus();
        });
      }
    },
    [items, updateItems]
  );

  const handleAddItem = useCallback(() => {
    const newItems = [...items, { text: '', checked: false }];
    updateItems(newItems);

    requestAnimationFrame(() => {
      inputRefs.current[newItems.length - 1]?.focus();
    });
  }, [items, updateItems]);

  return (
    <div className="space-y-1">
      {items.map((item, index) => (
        <div key={index} className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={item.checked}
            onChange={() => handleToggleCheck(index)}
            disabled={readOnly}
            className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
          />
          <input
            ref={(el) => {
              inputRefs.current[index] = el;
            }}
            type="text"
            value={item.text}
            onChange={(e) => handleTextChange(index, e.target.value)}
            onKeyDown={(e) => handleKeyDown(index, e)}
            disabled={readOnly}
            placeholder="List item..."
            className={`flex-1 bg-transparent text-sm outline-none ${
              item.checked ? 'text-gray-400 line-through' : 'text-gray-800'
            }`}
          />
        </div>
      ))}
      {!readOnly && (
        <button
          type="button"
          onClick={handleAddItem}
          className="flex items-center gap-1 pt-1 text-sm text-gray-400 transition-colors hover:text-gray-600"
        >
          <Plus className="h-3.5 w-3.5" />
          Add item
        </button>
      )}
    </div>
  );
}
