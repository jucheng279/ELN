import { useState, useCallback, useRef, useEffect, useMemo, KeyboardEvent, ClipboardEvent } from 'react';
import { Plus, X, Download, GripVertical } from 'lucide-react';

interface Column {
  id: string;
  name: string;
  type: string;
  width: number;
}

interface TableContent {
  columns: Column[];
  rows: string[][];
  caption: string;
}

interface TableBlockProps {
  content: TableContent;
  onUpdate: (content: TableContent) => void;
  readOnly: boolean;
}

type CellAddress = { row: number; col: number };

// --- Helpers ---

function colIndexToLetter(index: number): string {
  let letter = '';
  let n = index;
  while (n >= 0) {
    letter = String.fromCharCode((n % 26) + 65) + letter;
    n = Math.floor(n / 26) - 1;
  }
  return letter;
}

function letterToColIndex(letter: string): number {
  let index = 0;
  for (let i = 0; i < letter.length; i++) {
    index = index * 26 + (letter.charCodeAt(i) - 64);
  }
  return index - 1;
}

function parseCellRef(ref: string): { col: number; row: number } | null {
  const match = ref.trim().match(/^([A-Z]+)(\d+)$/);
  if (!match) return null;
  return {
    col: letterToColIndex(match[1]),
    row: parseInt(match[2], 10) - 1,
  };
}

function parseRange(range: string): { start: CellAddress; end: CellAddress } | null {
  const parts = range.split(':');
  if (parts.length !== 2) return null;
  const start = parseCellRef(parts[0]);
  const end = parseCellRef(parts[1]);
  if (!start || !end) return null;
  return { start, end };
}

function getCellValues(rows: string[][], start: CellAddress, end: CellAddress): number[] {
  const values: number[] = [];
  const minRow = Math.min(start.row, end.row);
  const maxRow = Math.max(start.row, end.row);
  const minCol = Math.min(start.col, end.col);
  const maxCol = Math.max(start.col, end.col);

  for (let r = minRow; r <= maxRow; r++) {
    for (let c = minCol; c <= maxCol; c++) {
      if (rows[r] && rows[r][c] !== undefined) {
        const val = parseFloat(rows[r][c]);
        if (!isNaN(val)) values.push(val);
      }
    }
  }
  return values;
}

function evaluateFormula(formula: string, rows: string[][]): string {
  try {
    const match = formula.trim().match(/^=(\w+)\(([^)]+)\)$/i);
    if (!match) return '#ERROR';

    const fn = match[1].toUpperCase();
    const range = parseRange(match[2]);
    if (!range) return '#ERROR';

    const values = getCellValues(rows, range.start, range.end);
    if (values.length === 0) return '0';

    switch (fn) {
      case 'SUM':
        return values.reduce((a, b) => a + b, 0).toString();
      case 'MEAN':
        return (values.reduce((a, b) => a + b, 0) / values.length).toString();
      case 'COUNT':
        return values.length.toString();
      case 'MIN':
        return Math.min(...values).toString();
      case 'MAX':
        return Math.max(...values).toString();
      default:
        return '#ERROR';
    }
  } catch {
    return '#ERROR';
  }
}

function generateId(): string {
  return Math.random().toString(36).substring(2, 9);
}

// --- Component ---

export default function TableBlock({ content, onUpdate, readOnly }: TableBlockProps) {
  const { columns, rows, caption } = content;

  const [selectedCell, setSelectedCell] = useState<CellAddress | null>(null);
  const [editingCell, setEditingCell] = useState<CellAddress | null>(null);
  const [editValue, setEditValue] = useState('');
  const [editingHeader, setEditingHeader] = useState<number | null>(null);
  const [editHeaderValue, setEditHeaderValue] = useState('');
  const [resizingCol, setResizingCol] = useState<number | null>(null);
  const [resizeStartX, setResizeStartX] = useState(0);
  const [resizeStartWidth, setResizeStartWidth] = useState(0);
  const [typeDropdownCol, setTypeDropdownCol] = useState<number | null>(null);

  const editInputRef = useRef<HTMLInputElement>(null);
  const headerInputRef = useRef<HTMLInputElement>(null);
  const tableRef = useRef<HTMLDivElement>(null);

  // Focus edit input when entering edit mode
  useEffect(() => {
    if (editingCell && editInputRef.current) {
      editInputRef.current.focus();
    }
  }, [editingCell]);

  useEffect(() => {
    if (editingHeader !== null && headerInputRef.current) {
      headerInputRef.current.focus();
      headerInputRef.current.select();
    }
  }, [editingHeader]);

  // Column resize mouse handlers
  useEffect(() => {
    if (resizingCol === null) return;

    const handleMouseMove = (e: MouseEvent) => {
      const delta = e.clientX - resizeStartX;
      const newWidth = Math.max(80, resizeStartWidth + delta);
      const newColumns = columns.map((col, i) =>
        i === resizingCol ? { ...col, width: newWidth } : col
      );
      onUpdate({ ...content, columns: newColumns });
    };

    const handleMouseUp = () => {
      setResizingCol(null);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [resizingCol, resizeStartX, resizeStartWidth, columns, content, onUpdate]);

  // Close type dropdown on outside click
  useEffect(() => {
    if (typeDropdownCol === null) return;
    const handleClick = () => setTypeDropdownCol(null);
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, [typeDropdownCol]);

  // --- Cell display value (with formula evaluation) ---
  const getDisplayValue = useCallback(
    (rowIdx: number, colIdx: number): string => {
      const raw = rows[rowIdx]?.[colIdx] ?? '';
      if (raw.startsWith('=')) {
        return evaluateFormula(raw, rows);
      }
      return raw;
    },
    [rows]
  );

  // --- Update helpers ---
  const updateCell = useCallback(
    (rowIdx: number, colIdx: number, value: string) => {
      const newRows = rows.map((row, ri) =>
        ri === rowIdx ? row.map((cell, ci) => (ci === colIdx ? value : cell)) : [...row]
      );
      onUpdate({ ...content, rows: newRows });
    },
    [rows, content, onUpdate]
  );

  const commitEdit = useCallback(() => {
    if (!editingCell) return;
    updateCell(editingCell.row, editingCell.col, editValue);
    setEditingCell(null);
  }, [editingCell, editValue, updateCell]);

  const cancelEdit = useCallback(() => {
    setEditingCell(null);
    setEditValue('');
  }, []);

  const startEdit = useCallback(
    (row: number, col: number) => {
      if (readOnly) return;
      const raw = rows[row]?.[col] ?? '';
      setEditingCell({ row, col });
      setEditValue(raw);
    },
    [readOnly, rows]
  );

  // --- Navigation ---
  const moveSelection = useCallback(
    (dRow: number, dCol: number) => {
      if (!selectedCell) return;
      const newRow = Math.max(0, Math.min(rows.length - 1, selectedCell.row + dRow));
      const newCol = Math.max(0, Math.min(columns.length - 1, selectedCell.col + dCol));
      setSelectedCell({ row: newRow, col: newCol });
    },
    [selectedCell, rows.length, columns.length]
  );

  const moveToNextCell = useCallback(
    (reverse: boolean = false) => {
      if (!selectedCell) return;
      let { row, col } = selectedCell;
      if (reverse) {
        col--;
        if (col < 0) {
          col = columns.length - 1;
          row--;
          if (row < 0) row = 0;
        }
      } else {
        col++;
        if (col >= columns.length) {
          col = 0;
          row++;
          if (row >= rows.length) row = rows.length - 1;
        }
      }
      setSelectedCell({ row, col });
    },
    [selectedCell, columns.length, rows.length]
  );

  // --- Keyboard handling ---
  const handleCellKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (!selectedCell) return;

      if (editingCell) {
        if (e.key === 'Enter') {
          e.preventDefault();
          commitEdit();
          moveSelection(1, 0);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          cancelEdit();
        } else if (e.key === 'Tab') {
          e.preventDefault();
          commitEdit();
          moveToNextCell(e.shiftKey);
        }
        return;
      }

      // Navigation when not editing
      switch (e.key) {
        case 'ArrowUp':
          e.preventDefault();
          moveSelection(-1, 0);
          break;
        case 'ArrowDown':
          e.preventDefault();
          moveSelection(1, 0);
          break;
        case 'ArrowLeft':
          e.preventDefault();
          moveSelection(0, -1);
          break;
        case 'ArrowRight':
          e.preventDefault();
          moveSelection(0, 1);
          break;
        case 'Enter':
          e.preventDefault();
          startEdit(selectedCell.row, selectedCell.col);
          break;
        case 'Tab':
          e.preventDefault();
          moveToNextCell(e.shiftKey);
          break;
        case 'Escape':
          e.preventDefault();
          setSelectedCell(null);
          break;
        default:
          // Start editing if the user types a printable character
          if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
            startEdit(selectedCell.row, selectedCell.col);
            setEditValue(e.key);
          }
          break;
      }
    },
    [selectedCell, editingCell, commitEdit, cancelEdit, moveSelection, moveToNextCell, startEdit]
  );

  // --- Copy ---
  const handleCopy = useCallback(
    (e: ClipboardEvent<HTMLDivElement>) => {
      if (!selectedCell || editingCell) return;
      e.preventDefault();
      const value = getDisplayValue(selectedCell.row, selectedCell.col);
      e.clipboardData.setData('text/plain', value);
    },
    [selectedCell, editingCell, getDisplayValue]
  );

  // --- Paste ---
  const handlePaste = useCallback(
    (e: ClipboardEvent<HTMLDivElement>) => {
      if (readOnly || !selectedCell || editingCell) return;
      e.preventDefault();

      const text = e.clipboardData.getData('text/plain');
      if (!text) return;

      const pastedRows = text.split('\n').map((line) => line.split('\t'));
      const startRow = selectedCell.row;
      const startCol = selectedCell.col;

      let newColumns = [...columns];
      let newRows = rows.map((r) => [...r]);

      // Expand columns if needed
      const maxCols = startCol + Math.max(...pastedRows.map((r) => r.length));
      while (newColumns.length < maxCols) {
        const colIdx = newColumns.length;
        newColumns.push({
          id: generateId(),
          name: colIndexToLetter(colIdx),
          type: 'text',
          width: 120,
        });
        newRows = newRows.map((r) => [...r, '']);
      }

      // Expand rows if needed
      const maxRows = startRow + pastedRows.length;
      while (newRows.length < maxRows) {
        newRows.push(new Array(newColumns.length).fill(''));
      }

      // Fill values
      for (let r = 0; r < pastedRows.length; r++) {
        for (let c = 0; c < pastedRows[r].length; c++) {
          const targetRow = startRow + r;
          const targetCol = startCol + c;
          if (targetRow < newRows.length && targetCol < newColumns.length) {
            newRows[targetRow][targetCol] = pastedRows[r][c];
          }
        }
      }

      onUpdate({ ...content, columns: newColumns, rows: newRows });
    },
    [readOnly, selectedCell, editingCell, columns, rows, content, onUpdate]
  );

  // --- Column operations ---
  const addColumn = useCallback(() => {
    const colIdx = columns.length;
    const newCol: Column = {
      id: generateId(),
      name: colIndexToLetter(colIdx),
      type: 'text',
      width: 120,
    };
    const newRows = rows.map((row) => [...row, '']);
    onUpdate({ ...content, columns: [...columns, newCol], rows: newRows });
  }, [columns, rows, content, onUpdate]);

  const removeColumn = useCallback(
    (colIdx: number) => {
      if (columns.length <= 1) return;
      const newColumns = columns.filter((_, i) => i !== colIdx);
      const newRows = rows.map((row) => row.filter((_, i) => i !== colIdx));
      onUpdate({ ...content, columns: newColumns, rows: newRows });
      if (selectedCell?.col === colIdx) setSelectedCell(null);
      if (editingCell?.col === colIdx) cancelEdit();
    },
    [columns, rows, content, onUpdate, selectedCell, editingCell, cancelEdit]
  );

  // --- Row operations ---
  const addRow = useCallback(() => {
    const newRow = new Array(columns.length).fill('');
    onUpdate({ ...content, rows: [...rows, newRow] });
  }, [columns.length, rows, content, onUpdate]);

  const removeRow = useCallback(
    (rowIdx: number) => {
      if (rows.length <= 1) return;
      const newRows = rows.filter((_, i) => i !== rowIdx);
      onUpdate({ ...content, rows: newRows });
      if (selectedCell?.row === rowIdx) setSelectedCell(null);
      if (editingCell?.row === rowIdx) cancelEdit();
    },
    [rows, content, onUpdate, selectedCell, editingCell, cancelEdit]
  );

  // --- Header editing ---
  const startHeaderEdit = useCallback(
    (colIdx: number) => {
      if (readOnly) return;
      setEditingHeader(colIdx);
      setEditHeaderValue(columns[colIdx].name);
    },
    [readOnly, columns]
  );

  const commitHeaderEdit = useCallback(() => {
    if (editingHeader === null) return;
    const newColumns = columns.map((col, i) =>
      i === editingHeader ? { ...col, name: editHeaderValue } : col
    );
    onUpdate({ ...content, columns: newColumns });
    setEditingHeader(null);
  }, [editingHeader, editHeaderValue, columns, content, onUpdate]);

  // --- Column type change ---
  const changeColumnType = useCallback(
    (colIdx: number, type: string) => {
      const newColumns = columns.map((col, i) =>
        i === colIdx ? { ...col, type } : col
      );
      onUpdate({ ...content, columns: newColumns });
      setTypeDropdownCol(null);
    },
    [columns, content, onUpdate]
  );

  // --- Column resize ---
  const startResize = useCallback(
    (colIdx: number, e: React.MouseEvent) => {
      if (readOnly) return;
      e.preventDefault();
      e.stopPropagation();
      setResizingCol(colIdx);
      setResizeStartX(e.clientX);
      setResizeStartWidth(columns[colIdx].width);
    },
    [readOnly, columns]
  );

  // --- CSV Export ---
  const exportCSV = useCallback(() => {
    const headerRow = columns.map((c) => `"${c.name.replace(/"/g, '""')}"`).join(',');
    const dataRows = rows.map((row) =>
      row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(',')
    );
    const csv = [headerRow, ...dataRows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'table-data.csv';
    a.click();
    URL.revokeObjectURL(url);
  }, [columns, rows]);

  // --- Computed min width ---
  const tableMinWidth = useMemo(() => {
    const rowNumWidth = 48;
    const colWidths = columns.reduce((sum, col) => sum + col.width, 0);
    return rowNumWidth + colWidths + (readOnly ? 0 : 40);
  }, [columns, readOnly]);

  const columnTypes = ['text', 'number', 'date', 'checkbox', 'select'];

  return (
    <div className="w-full">
      {/* Toolbar */}
      <div className="flex items-center justify-end mb-2">
        <button
          onClick={exportCSV}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-600 bg-white border border-gray-200 rounded-md hover:bg-gray-50 transition-colors"
        >
          <Download className="w-3.5 h-3.5" />
          Export CSV
        </button>
      </div>

      {/* Table wrapper */}
      <div
        ref={tableRef}
        className="rounded-lg border border-gray-200 overflow-hidden"
      >
        <div className="overflow-x-auto">
          <div
            className="outline-none"
            tabIndex={0}
            onKeyDown={handleCellKeyDown}
            onCopy={handleCopy}
            onPaste={handlePaste}
            style={{ minWidth: tableMinWidth }}
          >
            {/* Header row */}
            <div className="flex bg-gray-50 border-b border-gray-200">
              {/* Row number header */}
              <div className="flex-shrink-0 w-12 px-2 py-1.5 text-xs font-medium uppercase text-gray-400 border-r border-gray-200 text-center">
                #
              </div>

              {/* Column headers */}
              {columns.map((col, colIdx) => (
                <div
                  key={col.id}
                  className="relative flex-shrink-0 border-r border-gray-200 group"
                  style={{ width: col.width }}
                >
                  <div className="flex items-center px-2 py-1.5">
                    {editingHeader === colIdx ? (
                      <input
                        ref={headerInputRef}
                        value={editHeaderValue}
                        onChange={(e) => setEditHeaderValue(e.target.value)}
                        onBlur={commitHeaderEdit}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') commitHeaderEdit();
                          if (e.key === 'Escape') setEditingHeader(null);
                        }}
                        className="w-full bg-white border border-blue-400 rounded px-1 py-0.5 text-xs font-medium outline-none"
                      />
                    ) : (
                      <button
                        onClick={() => startHeaderEdit(colIdx)}
                        className="flex-1 text-left text-xs font-medium uppercase text-gray-600 truncate"
                        disabled={readOnly}
                      >
                        {col.name}
                      </button>
                    )}

                    {!readOnly && editingHeader !== colIdx && (
                      <div className="flex items-center gap-0.5 ml-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setTypeDropdownCol(typeDropdownCol === colIdx ? null : colIdx);
                          }}
                          className="p-0.5 text-gray-400 hover:text-gray-600 rounded"
                          title={`Type: ${col.type}`}
                        >
                          <GripVertical className="w-3 h-3" />
                        </button>
                        <button
                          onClick={() => removeColumn(colIdx)}
                          className="p-0.5 text-gray-400 hover:text-red-500 rounded"
                          title="Remove column"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Type dropdown */}
                  {typeDropdownCol === colIdx && (
                    <div className="absolute top-full left-0 z-20 mt-1 bg-white border border-gray-200 rounded-md shadow-lg py-1 min-w-[100px]">
                      {columnTypes.map((type) => (
                        <button
                          key={type}
                          onClick={(e) => {
                            e.stopPropagation();
                            changeColumnType(colIdx, type);
                          }}
                          className={`w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50 ${
                            col.type === type ? 'text-blue-600 font-medium' : 'text-gray-700'
                          }`}
                        >
                          {type}
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Resize handle */}
                  {!readOnly && (
                    <div
                      onMouseDown={(e) => startResize(colIdx, e)}
                      className="absolute top-0 right-0 w-1.5 h-full cursor-col-resize hover:bg-blue-400 transition-colors"
                    />
                  )}
                </div>
              ))}

              {/* Add column button */}
              {!readOnly && (
                <div className="flex-shrink-0 w-10 flex items-center justify-center">
                  <button
                    onClick={addColumn}
                    className="p-1 text-gray-400 hover:text-blue-500 hover:bg-blue-50 rounded transition-colors"
                    title="Add column"
                  >
                    <Plus className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>

            {/* Data rows */}
            {rows.map((row, rowIdx) => (
              <div
                key={rowIdx}
                className="flex border-b border-gray-200 last:border-b-0 group/row"
              >
                {/* Row number */}
                <div className="flex-shrink-0 w-12 px-2 py-1.5 text-xs text-gray-400 bg-gray-50 border-r border-gray-200 text-center relative">
                  {rowIdx + 1}
                  {!readOnly && (
                    <button
                      onClick={() => removeRow(rowIdx)}
                      className="absolute inset-0 flex items-center justify-center bg-gray-50 text-gray-400 hover:text-red-500 opacity-0 group-hover/row:opacity-100 transition-opacity"
                      title="Remove row"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  )}
                </div>

                {/* Data cells */}
                {columns.map((col, colIdx) => {
                  const isSelected =
                    selectedCell?.row === rowIdx && selectedCell?.col === colIdx;
                  const isEditing =
                    editingCell?.row === rowIdx && editingCell?.col === colIdx;

                  return (
                    <div
                      key={col.id}
                      className={`flex-shrink-0 border-r border-gray-200 ${
                        isSelected ? 'ring-2 ring-blue-500 ring-inset z-10' : ''
                      }`}
                      style={{ width: col.width }}
                      onClick={() => {
                        if (!readOnly) {
                          setSelectedCell({ row: rowIdx, col: colIdx });
                          if (editingCell && !isEditing) {
                            commitEdit();
                          }
                        }
                      }}
                      onDoubleClick={() => startEdit(rowIdx, colIdx)}
                    >
                      {isEditing ? (
                        <input
                          ref={editInputRef}
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          onBlur={commitEdit}
                          className="w-full h-full px-2 py-1.5 text-sm outline-none bg-blue-50"
                        />
                      ) : (
                        <div className="px-2 py-1.5 text-sm truncate min-h-[32px]">
                          {getDisplayValue(rowIdx, colIdx)}
                        </div>
                      )}
                    </div>
                  );
                })}

                {/* Spacer for add-column button */}
                {!readOnly && <div className="flex-shrink-0 w-10" />}
              </div>
            ))}

            {/* Add row button */}
            {!readOnly && (
              <div className="flex border-t border-gray-100">
                <button
                  onClick={addRow}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-400 hover:text-blue-500 hover:bg-blue-50 transition-colors w-full"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add row
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Caption */}
      {readOnly ? (
        caption && (
          <p className="mt-2 text-sm text-gray-500 text-center italic">{caption}</p>
        )
      ) : (
        <input
          value={caption}
          onChange={(e) => onUpdate({ ...content, caption: e.target.value })}
          placeholder="Table caption..."
          className="mt-2 w-full text-sm text-gray-500 text-center italic bg-transparent border-none outline-none placeholder:text-gray-300 focus:placeholder:text-gray-400"
        />
      )}
    </div>
  );
}
