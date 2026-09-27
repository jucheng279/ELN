import { useState, useCallback, useRef, useMemo } from 'react';
import { useExperimentStore } from '@/stores/experimentStore';
import BlockRenderer from '@/components/editor/BlockRenderer';
import BlockTypeMenu from '@/components/editor/BlockTypeMenu';
import type { BlockType, ExperimentBlock } from '@/lib/types';
import { Plus, GripVertical, Trash2, Copy } from 'lucide-react';

// ──────────────────────────────────────────────
// Default content factories per block type
// ──────────────────────────────────────────────

const DEFAULT_CONTENT: Record<BlockType, () => any> = {
  paragraph: () => ({ html: '' }),
  heading: () => ({ html: '', level: 2 }),
  list: () => ({ type: 'bullet', items: [''] }),
  checklist: () => ({ items: [{ text: '', checked: false }] }),
  callout: () => ({ type: 'note', html: '' }),
  divider: () => ({}),
  parameters: () => ({
    parameters: [{ name: '', value: '', unit: '', description: '' }],
  }),
  table: () => ({
    columns: [
      { id: 'col1', name: 'Column 1', type: 'text', width: 150 },
      { id: 'col2', name: 'Column 2', type: 'text', width: 150 },
    ],
    rows: [['', '']],
    caption: '',
  }),
  image: () => ({ url: '', caption: '', alt: '', filename: '', fileSize: 0 }),
  attachment: () => ({ url: '', filename: '', fileSize: 0, mimeType: '' }),
  code: () => ({ code: '', language: '' }),
  protocol: () => ({
    protocol_id: null,
    protocol_version_id: null,
    protocol_name: '',
    version_number: 0,
    steps: [],
    deviations: [],
  }),
  result: () => ({ data: null, type: 'text', html: '' }),
  reference: () => ({ doi: '', url: '', title: '', citation: '', notes: '' }),
  related_experiment: () => ({
    experiment_id: null,
    experiment_display_id: '',
    title: '',
    status: 'draft',
  }),
};

// ──────────────────────────────────────────────
// Helper: generate an order key between two existing keys
// ──────────────────────────────────────────────

function orderKeyBetween(before: string | null, after: string | null): string {
  if (!before && !after) return 'a0';
  if (!before) return (after ?? 'a0').slice(0, -1) + '0';
  if (!after) return before + '1';
  return before + '8';
}

// ──────────────────────────────────────────────
// Props
// ──────────────────────────────────────────────

interface BlockEditorProps {
  experimentId: string;
  readOnly: boolean;
}

// ──────────────────────────────────────────────
// Component
// ──────────────────────────────────────────────

export default function BlockEditor({ experimentId, readOnly }: BlockEditorProps) {
  const blocks = useExperimentStore((s) => s.blocks);
  const addBlock = useExperimentStore((s) => s.addBlock);
  const updateBlock = useExperimentStore((s) => s.updateBlock);
  const deleteBlock = useExperimentStore((s) => s.deleteBlock);
  const reorderBlocks = useExperimentStore((s) => s.reorderBlocks);

  // ── Add-block menu state ─────────────────────
  const [addMenuOpen, setAddMenuOpen] = useState<{
    position: { top: number; left: number };
    afterBlockId: string | null;
  } | null>(null);

  // ── Slash-command menu state ─────────────────
  const [slashMenu, setSlashMenu] = useState<{
    position: { top: number; left: number };
    blockId: string;
    filter: string;
  } | null>(null);

  // ── Hover state ──────────────────────────────
  const [hoveredBlockId, setHoveredBlockId] = useState<string | null>(null);

  // ── Drag & drop state ────────────────────────
  const [draggedBlockId, setDraggedBlockId] = useState<string | null>(null);
  const [dropTargetIndex, setDropTargetIndex] = useState<number | null>(null);
  const dragHandleActive = useRef<string | null>(null);

  // ── Sorted blocks ────────────────────────────
  const sortedBlocks = useMemo(
    () => [...blocks].sort((a, b) => a.order_key.localeCompare(b.order_key)),
    [blocks]
  );

  // ── Add block handler ────────────────────────

  const handleAddBlock = useCallback(
    async (type: BlockType, afterBlockId: string | null) => {
      const content = DEFAULT_CONTENT[type]?.() ?? {};
      await addBlock(experimentId, type, content, afterBlockId ?? undefined);
      setAddMenuOpen(null);
    },
    [experimentId, addBlock]
  );

  // ── Slash-command: called when "/" is typed ───

  const handleSlashCommand = useCallback(
    (blockId: string, rect: { top: number; left: number }) => {
      setSlashMenu({ position: rect, blockId, filter: '' });
    },
    []
  );

  const handleSlashSelect = useCallback(
    async (type: BlockType) => {
      if (!slashMenu) return;
      const blockId = slashMenu.blockId;
      // Delete the empty paragraph and insert the chosen type in its place
      const blockIndex = sortedBlocks.findIndex((b) => b.id === blockId);
      const afterBlockId =
        blockIndex > 0 ? sortedBlocks[blockIndex - 1].id : null;
      await deleteBlock(blockId);
      const content = DEFAULT_CONTENT[type]?.() ?? {};
      await addBlock(experimentId, type, content, afterBlockId ?? undefined);
      setSlashMenu(null);
    },
    [slashMenu, sortedBlocks, deleteBlock, addBlock, experimentId]
  );

  // ── Duplicate block ──────────────────────────

  const handleDuplicate = useCallback(
    async (block: ExperimentBlock) => {
      await addBlock(experimentId, block.type, { ...block.content }, block.id);
    },
    [experimentId, addBlock]
  );

  // ── Delete block ─────────────────────────────

  const handleDelete = useCallback(
    async (blockId: string) => {
      await deleteBlock(blockId);
    },
    [deleteBlock]
  );

  // ── Update block content ─────────────────────

  const handleUpdateBlock = useCallback(
    (blockId: string) => (content: any) => {
      updateBlock(blockId, content);
    },
    [updateBlock]
  );

  // ── Drag & drop handlers ─────────────────────

  const handleDragStart = useCallback(
    (e: React.DragEvent<HTMLDivElement>, blockId: string) => {
      if (dragHandleActive.current !== blockId) {
        e.preventDefault();
        return;
      }
      setDraggedBlockId(blockId);
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', blockId);
    },
    []
  );

  const handleDragOver = useCallback(
    (e: React.DragEvent<HTMLDivElement>, index: number) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      setDropTargetIndex(index);
    },
    []
  );

  const handleDragEnd = useCallback(() => {
    setDraggedBlockId(null);
    setDropTargetIndex(null);
    dragHandleActive.current = null;
  }, []);

  const handleDrop = useCallback(
    async (e: React.DragEvent<HTMLDivElement>, targetIndex: number) => {
      e.preventDefault();
      const blockId = e.dataTransfer.getData('text/plain');
      if (!blockId) return;

      const beforeKey =
        targetIndex > 0 ? sortedBlocks[targetIndex - 1]?.order_key ?? null : null;
      // If the drop is between two blocks, the "after" block is at targetIndex
      // We need a key between beforeKey and afterKey
      const sourceIndex = sortedBlocks.findIndex((b) => b.id === blockId);

      // Adjust target: skip the source block itself
      let adjustedTarget = targetIndex;
      if (sourceIndex < targetIndex) {
        adjustedTarget = targetIndex;
      }

      const prevKey =
        adjustedTarget > 0
          ? sortedBlocks[adjustedTarget - 1]?.order_key ?? null
          : null;
      const nextKey =
        adjustedTarget < sortedBlocks.length
          ? sortedBlocks[adjustedTarget]?.order_key ?? null
          : null;

      // Don't use the dragged block's own key as a boundary
      const safePrevKey =
        prevKey && sortedBlocks[adjustedTarget - 1]?.id === blockId
          ? adjustedTarget > 1
            ? sortedBlocks[adjustedTarget - 2]?.order_key ?? null
            : null
          : prevKey;
      const safeNextKey =
        nextKey && sortedBlocks[adjustedTarget]?.id === blockId
          ? adjustedTarget + 1 < sortedBlocks.length
            ? sortedBlocks[adjustedTarget + 1]?.order_key ?? null
            : null
          : nextKey;

      const newOrderKey = orderKeyBetween(safePrevKey, safeNextKey);
      await reorderBlocks(experimentId, blockId, newOrderKey);

      setDraggedBlockId(null);
      setDropTargetIndex(null);
      dragHandleActive.current = null;
    },
    [sortedBlocks, reorderBlocks, experimentId]
  );

  // ── Add-block zone ───────────────────────────

  const renderAddZone = (afterBlockId: string | null, key: string) => {
    if (readOnly) return null;
    return (
      <div
        key={key}
        className="group relative flex h-6 items-center justify-center"
      >
        {/* Horizontal line */}
        <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-transparent transition-colors group-hover:bg-gray-200" />
        {/* Plus button */}
        <button
          onClick={(e) => {
            const rect = (e.target as HTMLElement).getBoundingClientRect();
            setAddMenuOpen({
              position: { top: rect.bottom + 4, left: rect.left - 120 },
              afterBlockId,
            });
          }}
          className="relative z-10 flex h-5 w-5 items-center justify-center rounded-full border border-gray-300 bg-white text-gray-400 opacity-0 transition-opacity hover:border-blue-400 hover:text-blue-500 group-hover:opacity-100"
          aria-label="Add block"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  };

  // ── Drop indicator ───────────────────────────

  const renderDropIndicator = (index: number) => {
    if (dropTargetIndex !== index || draggedBlockId === null) return null;
    return (
      <div className="pointer-events-none h-0.5 rounded-full bg-blue-500" />
    );
  };

  // ── Empty state ──────────────────────────────

  if (sortedBlocks.length === 0 && !readOnly) {
    return (
      <div className="px-12 py-8">
        <div className="flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-gray-200 py-16 text-center">
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-blue-50 text-blue-500">
            <Plus className="h-6 w-6" />
          </div>
          <h3 className="mb-1 text-sm font-medium text-gray-900">
            No blocks yet
          </h3>
          <p className="mb-4 text-sm text-gray-500">
            Click the button below to add your first block
          </p>
          <button
            onClick={(e) => {
              const rect = (e.target as HTMLElement).getBoundingClientRect();
              setAddMenuOpen({
                position: { top: rect.bottom + 4, left: rect.left - 120 },
                afterBlockId: null,
              });
            }}
            className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-blue-700 transition-colors"
          >
            <Plus className="h-4 w-4" />
            Add block
          </button>
        </div>

        {/* Add-block menu */}
        {addMenuOpen && (
          <BlockTypeMenu
            position={addMenuOpen.position}
            onSelect={(type) => handleAddBlock(type, addMenuOpen.afterBlockId)}
            onClose={() => setAddMenuOpen(null)}
          />
        )}
      </div>
    );
  }

  // ── Main render ──────────────────────────────

  return (
    <div className="px-12 py-8">
      <div className="space-y-1">
        {/* Top add zone */}
        {renderAddZone(null, 'add-zone-top')}

        {sortedBlocks.map((block, index) => (
          <div key={block.id}>
            {/* Drop indicator above this block */}
            {renderDropIndicator(index)}

            {/* Block wrapper */}
            <div
              className={`group/block relative py-1 transition-all ${
                hoveredBlockId === block.id && !readOnly
                  ? 'border-l-2 border-blue-500 pl-0'
                  : 'border-l-2 border-transparent pl-0'
              } ${
                draggedBlockId === block.id ? 'opacity-40' : ''
              }`}
              onMouseEnter={() => setHoveredBlockId(block.id)}
              onMouseLeave={() => setHoveredBlockId(null)}
              draggable={dragHandleActive.current === block.id}
              onDragStart={(e) => handleDragStart(e, block.id)}
              onDragOver={(e) => handleDragOver(e, index)}
              onDragEnd={handleDragEnd}
              onDrop={(e) => handleDrop(e, index)}
            >
              {/* Block toolbar (left margin, appears on hover) */}
              {!readOnly && (
                <div
                  className={`absolute -left-8 top-1 z-10 flex flex-col items-center gap-0.5 opacity-0 transition-opacity ${
                    hoveredBlockId === block.id
                      ? 'opacity-100'
                      : 'group-hover/block:opacity-100'
                  }`}
                >
                  {/* Drag handle */}
                  <button
                    onMouseDown={() => {
                      dragHandleActive.current = block.id;
                    }}
                    onMouseUp={() => {
                      dragHandleActive.current = null;
                    }}
                    className="flex h-6 w-6 cursor-grab items-center justify-center rounded text-gray-400 hover:bg-gray-100 hover:text-gray-600 active:cursor-grabbing"
                    aria-label="Drag to reorder"
                  >
                    <GripVertical className="h-3.5 w-3.5" />
                  </button>

                  {/* Duplicate */}
                  <button
                    onClick={() => handleDuplicate(block)}
                    className="flex h-6 w-6 items-center justify-center rounded text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                    aria-label="Duplicate block"
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </button>

                  {/* Delete */}
                  <button
                    onClick={() => handleDelete(block.id)}
                    className="flex h-6 w-6 items-center justify-center rounded text-gray-400 hover:bg-gray-100 hover:text-red-500"
                    aria-label="Delete block"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}

              {/* Block content */}
              <BlockRenderer
                block={block}
                onUpdate={handleUpdateBlock(block.id)}
                readOnly={readOnly}
                onSlashCommand={
                  block.type === 'paragraph'
                    ? (rect: { top: number; left: number }) =>
                        handleSlashCommand(block.id, rect)
                    : undefined
                }
              />
            </div>

            {/* Add zone after this block */}
            {renderAddZone(block.id, `add-zone-${block.id}`)}
          </div>
        ))}

        {/* Drop indicator at the very end */}
        {renderDropIndicator(sortedBlocks.length)}
      </div>

      {/* Add-block type menu (positioned near the + button) */}
      {addMenuOpen && (
        <BlockTypeMenu
          position={addMenuOpen.position}
          onSelect={(type) => handleAddBlock(type, addMenuOpen.afterBlockId)}
          onClose={() => setAddMenuOpen(null)}
        />
      )}

      {/* Slash-command menu (inline, near the block) */}
      {slashMenu && (
        <BlockTypeMenu
          position={slashMenu.position}
          onSelect={handleSlashSelect}
          onClose={() => setSlashMenu(null)}
          filter={slashMenu.filter}
        />
      )}
    </div>
  );
}
