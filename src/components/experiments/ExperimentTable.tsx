import { useState } from 'react';
import { format } from 'date-fns';
import {
  Star,
  MoreHorizontal,
  Eye,
  Pencil,
  Copy,
  Archive,
  ArchiveRestore,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
} from 'lucide-react';
import StatusBadge from '@/components/common/StatusBadge';
import DropdownMenu from '@/components/common/DropdownMenu';
import type { DropdownMenuItem } from '@/components/common/DropdownMenu';
import type { Experiment, ExperimentFilters } from '@/lib/types';

type SortField = NonNullable<ExperimentFilters['sort_by']>;
type SortOrder = NonNullable<ExperimentFilters['sort_order']>;

interface ExperimentTableProps {
  experiments: Experiment[];
  sortBy?: SortField;
  sortOrder?: SortOrder;
  onSort?: (field: SortField) => void;
  onRowClick?: (experiment: Experiment) => void;
  onRowAction?: (action: string, experiment: Experiment) => void;
  onToggleFavorite?: (experimentId: string) => void;
  showArchive?: boolean;
}

const columns: { key: SortField | 'experiment_id' | 'notebook' | 'status' | 'owner'; label: string; className: string; sortable: boolean; sortField?: SortField }[] = [
  { key: 'experiment_id', label: 'ID', className: 'w-32', sortable: true, sortField: 'experiment_number' },
  { key: 'title', label: 'Title', className: 'min-w-[200px] flex-1', sortable: true, sortField: 'title' },
  { key: 'notebook', label: 'Notebook', className: 'w-40', sortable: false },
  { key: 'status', label: 'Status', className: 'w-32', sortable: false },
  { key: 'owner', label: 'Owner', className: 'w-36', sortable: false },
  { key: 'created_at', label: 'Date', className: 'w-28', sortable: true, sortField: 'created_at' },
  { key: 'updated_at', label: 'Modified', className: 'w-32', sortable: true, sortField: 'updated_at' },
];

function SortIcon({ field, sortBy, sortOrder }: { field: SortField; sortBy?: SortField; sortOrder?: SortOrder }) {
  if (sortBy !== field) return <ArrowUpDown size={13} className="text-gray-300" />;
  return sortOrder === 'asc'
    ? <ArrowUp size={13} className="text-blue-600" />
    : <ArrowDown size={13} className="text-blue-600" />;
}

export default function ExperimentTable({
  experiments,
  sortBy,
  sortOrder,
  onSort,
  onRowClick,
  onRowAction,
  onToggleFavorite,
  showArchive = false,
}: ExperimentTableProps) {
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  function buildMenuItems(exp: Experiment): DropdownMenuItem[] {
    const items: DropdownMenuItem[] = [
      { label: 'View', icon: Eye, onClick: () => onRowAction?.('view', exp) },
      { label: 'Edit', icon: Pencil, onClick: () => onRowAction?.('edit', exp) },
      { label: 'Duplicate', icon: Copy, onClick: () => onRowAction?.('duplicate', exp) },
    ];
    if (showArchive) {
      items.push({
        label: 'Restore',
        icon: ArchiveRestore,
        onClick: () => onRowAction?.('restore', exp),
      });
    } else {
      items.push({
        label: 'Archive',
        icon: Archive,
        onClick: () => onRowAction?.('archive', exp),
        variant: 'danger',
      });
    }
    return items;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200 bg-gray-50">
            {/* Favorite column */}
            <th className="w-10 px-2 py-2" />
            {columns.map((col) => (
              <th
                key={col.key}
                className={[
                  'px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-gray-500',
                  col.className,
                  col.sortable ? 'cursor-pointer select-none hover:text-gray-700' : '',
                ].join(' ')}
                onClick={() => {
                  if (col.sortable && col.sortField && onSort) {
                    onSort(col.sortField);
                  }
                }}
              >
                <span className="inline-flex items-center gap-1">
                  {col.label}
                  {col.sortable && col.sortField && (
                    <SortIcon field={col.sortField} sortBy={sortBy} sortOrder={sortOrder} />
                  )}
                </span>
              </th>
            ))}
            {/* Actions column */}
            <th className="w-10 px-2 py-2" />
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {experiments.map((exp) => (
            <tr
              key={exp.id}
              className="h-10 cursor-pointer transition-colors hover:bg-gray-50"
              onClick={() => onRowClick?.(exp)}
            >
              {/* Favorite star */}
              <td className="px-2 text-center">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleFavorite?.(exp.id);
                  }}
                  className="rounded p-0.5 hover:bg-gray-100"
                >
                  <Star
                    size={15}
                    className={exp.is_favorited ? 'fill-amber-400 text-amber-400' : 'text-gray-300 hover:text-gray-400'}
                  />
                </button>
              </td>

              {/* ID */}
              <td className="px-3 py-1.5 text-gray-500 font-mono text-xs">
                {exp.experiment_id}
              </td>

              {/* Title */}
              <td className="px-3 py-1.5 font-medium text-gray-900 truncate max-w-[300px]">
                <div className="flex items-center gap-2">
                  <span className="truncate">{exp.title}</span>
                  {exp.tags && exp.tags.length > 0 && (
                    <span className="flex gap-1 shrink-0">
                      {exp.tags.slice(0, 2).map((tag) => (
                        <span
                          key={tag.id}
                          className="inline-block rounded px-1.5 py-0.5 text-[10px] font-medium bg-gray-100 text-gray-600"
                        >
                          {tag.name}
                        </span>
                      ))}
                      {exp.tags.length > 2 && (
                        <span className="text-[10px] text-gray-400">+{exp.tags.length - 2}</span>
                      )}
                    </span>
                  )}
                </div>
              </td>

              {/* Notebook */}
              <td className="px-3 py-1.5 text-gray-500 truncate max-w-[160px]">
                {exp.notebook?.name ?? '—'}
              </td>

              {/* Status */}
              <td className="px-3 py-1.5">
                <StatusBadge status={exp.status} />
              </td>

              {/* Owner */}
              <td className="px-3 py-1.5 text-gray-500 truncate max-w-[144px]">
                {exp.created_by_profile?.display_name ?? '—'}
              </td>

              {/* Date */}
              <td className="px-3 py-1.5 text-gray-500 whitespace-nowrap">
                {format(new Date(exp.experiment_date || exp.created_at), 'MMM d, yyyy')}
              </td>

              {/* Modified */}
              <td className="px-3 py-1.5 text-gray-500 whitespace-nowrap">
                {format(new Date(exp.updated_at), 'MMM d, yyyy')}
              </td>

              {/* Actions */}
              <td className="px-2 text-center">
                <DropdownMenu
                  trigger={
                    <button className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600">
                      <MoreHorizontal size={15} />
                    </button>
                  }
                  items={buildMenuItems(exp)}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
