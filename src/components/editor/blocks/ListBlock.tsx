import { useState, useCallback, useRef, KeyboardEvent } from 'react';
import { List, ListOrdered, Plus } from 'lucide-react';

interface ListBlockProps {
  content: any;
  onUpdate: (content: any) => void;
  readOnly: boolean;
}

type ListType = 'bullet' | 'numbered';

export default function ListBlock({
  content,
  onUpdate,
  readOnly,
}: ListBlockProps) {
  const type: ListType = content?.type || 'bullet';
  const items: string[] = content?.items || [''];
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  const updateList = useCallback(
    (newType: ListType, newItems: string[]) => {
      onUpdate({ type: newType, items: newItems });
    },
    [onUpdate]
  );

  const handleTypeChange = useCallback(
    (newType: ListType) => {
      updateList(newType, items);
    },
    [items, updateList]
  );

  const handleItemChange = useCallback(
    (index: number, value: string) => {
      const newItems = items.map((item, i) => (i === index ? value : item));
      updateList(type, newItems);
    },
    [items, type, updateList]
  );

  const handleKeyDown = useCallback(
    (index: number, e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const newItems = [...items];
        newItems.splice(index + 1, 0, '');
        updateList(type, newItems);

        requestAnimationFrame(() => {
          inputRefs.current[index + 1]?.focus();
        });
      }

      if (
        e.key === 'Backspace' &&
        items[index] === '' &&
        items.length > 1
      ) {
        e.preventDefault();
        const newItems = items.filter((_, i) => i !== index);
        updateList(type, newItems);

        requestAnimationFrame(() => {
          const focusIndex = Math.max(0, index - 1);
          inputRefs.current[focusIndex]?.focus();
        });
      }
    },
    [items, type, updateList]
  );

  const handleAddItem = useCallback(() => {
    const newItems = [...items, ''];
    updateList(type, newItems);

    requestAnimationFrame(() => {
      inputRefs.current[newItems.length - 1]?.focus();
    });
  }, [items, type, updateList]);

  return (
    <div>
      {!readOnly && (
        <div className="mb-2 flex items-center gap-1">
          <button
            type="button"
            onClick={() => handleTypeChange('bullet')}
            className={`rounded p-1 transition-colors ${
              type === 'bullet'
                ? 'bg-gray-200 text-gray-900'
                : 'text-gray-500 hover:bg-gray-100'
            }`}
            title="Bullet list"
          >
            <List className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => handleTypeChange('numbered')}
            className={`rounded p-1 transition-colors ${
              type === 'numbered'
                ? 'bg-gray-200 text-gray-900'
                : 'text-gray-500 hover:bg-gray-100'
            }`}
            title="Numbered list"
          >
            <ListOrdered className="h-4 w-4" />
          </button>
        </div>
      )}

      <div className="space-y-1">
        {items.map((item, index) => (
          <div key={index} className="flex items-center gap-2">
            <span className="w-5 flex-shrink-0 text-right text-sm text-gray-400">
              {type === 'bullet' ? '•' : `${index + 1}.`}
            </span>
            <input
              ref={(el) => {
                inputRefs.current[index] = el;
              }}
              type="text"
              value={item}
              onChange={(e) => handleItemChange(index, e.target.value)}
              onKeyDown={(e) => handleKeyDown(index, e)}
              disabled={readOnly}
              placeholder="List item..."
              className="flex-1 bg-transparent text-sm text-gray-800 outline-none placeholder:text-gray-400"
            />
          </div>
        ))}
      </div>

      {!readOnly && (
        <button
          type="button"
          onClick={handleAddItem}
          className="mt-1 flex items-center gap-1 pl-7 text-sm text-gray-400 transition-colors hover:text-gray-600"
        >
          <Plus className="h-3.5 w-3.5" />
          Add item
        </button>
      )}
    </div>
  );
}
