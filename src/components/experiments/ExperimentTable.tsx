import { format } from 'date-fns';
import {
  Star,
  MoreHorizontal,
  ArrowRight,
  Copy,
  Archive,
  ArchiveRestore,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
} from 'lucide-react';
import ExperimentStatusBadge from '@/components/eln/ExperimentStatusBadge';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from '@/components/ui/tooltip';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
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

const columns: {
  key: SortField | 'experiment_id' | 'notebook' | 'status' | 'owner';
  label: string;
  className: string;
  sortable: boolean;
  sortField?: SortField;
}[] = [
  { key: 'experiment_id', label: 'ID', className: 'w-32', sortable: true, sortField: 'experiment_number' },
  { key: 'title', label: 'Title', className: 'min-w-[200px] flex-1', sortable: true, sortField: 'title' },
  { key: 'notebook', label: 'Notebook', className: 'w-40', sortable: false },
  { key: 'status', label: 'Status', className: 'w-32', sortable: false },
  { key: 'owner', label: 'Owner', className: 'w-36', sortable: false },
  { key: 'created_at', label: 'Date', className: 'w-28', sortable: true, sortField: 'created_at' },
  { key: 'updated_at', label: 'Modified', className: 'w-32', sortable: true, sortField: 'updated_at' },
];

function SortIcon({ field, sortBy, sortOrder }: { field: SortField; sortBy?: SortField; sortOrder?: SortOrder }) {
  if (sortBy !== field) return <ArrowUpDown size={13} className="text-muted-foreground/40" />;
  return sortOrder === 'asc'
    ? <ArrowUp size={13} className="text-foreground" />
    : <ArrowDown size={13} className="text-foreground" />;
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
  return (
    <TooltipProvider>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50">
              {/* Favorite column */}
              <th className="w-10 px-2 py-2" />
              {columns.map((col) => (
                <th
                  key={col.key}
                  className={cn(
                    'px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground',
                    col.className,
                    col.sortable && 'cursor-pointer select-none hover:text-foreground',
                  )}
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
          <tbody className="divide-y divide-border/50">
            {experiments.map((exp) => (
              <tr
                key={exp.id}
                className="h-10 cursor-pointer transition-colors hover:bg-muted/50"
                onClick={() => onRowClick?.(exp)}
              >
                {/* Favorite star */}
                <td className="px-2 text-center">
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          onClick={(e) => {
                            e.stopPropagation();
                            onToggleFavorite?.(exp.id);
                          }}
                        />
                      }
                    >
                      <Star
                        size={14}
                        className={cn(
                          exp.is_favorited
                            ? 'fill-amber-400 text-amber-400'
                            : 'text-muted-foreground/40 hover:text-muted-foreground',
                        )}
                      />
                    </TooltipTrigger>
                    <TooltipContent side="right">
                      {exp.is_favorited ? 'Remove from favorites' : 'Add to favorites'}
                    </TooltipContent>
                  </Tooltip>
                </td>

                {/* ID */}
                <td className="px-3 py-1.5 font-mono text-xs text-muted-foreground">
                  {exp.experiment_id}
                </td>

                {/* Title */}
                <td className="px-3 py-1.5 truncate max-w-[300px]">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium text-foreground">{exp.title}</span>
                    {exp.tags && exp.tags.length > 0 && (
                      <span className="flex gap-1 shrink-0">
                        {exp.tags.slice(0, 2).map((tag) => (
                          <span
                            key={tag.id}
                            className="inline-block rounded px-1.5 py-0.5 text-[10px] font-medium bg-muted text-muted-foreground"
                          >
                            {tag.name}
                          </span>
                        ))}
                        {exp.tags.length > 2 && (
                          <span className="text-[10px] text-muted-foreground">+{exp.tags.length - 2}</span>
                        )}
                      </span>
                    )}
                  </div>
                </td>

                {/* Notebook */}
                <td className="px-3 py-1.5 text-muted-foreground truncate max-w-[160px]">
                  {exp.notebook?.name ?? '—'}
                </td>

                {/* Status */}
                <td className="px-3 py-1.5">
                  <ExperimentStatusBadge status={exp.status} />
                </td>

                {/* Owner */}
                <td className="px-3 py-1.5 text-muted-foreground truncate max-w-[144px]">
                  {exp.created_by_profile?.display_name ?? '—'}
                </td>

                {/* Date */}
                <td className="px-3 py-1.5 text-muted-foreground whitespace-nowrap">
                  {format(new Date(exp.experiment_date || exp.created_at), 'MMM d, yyyy')}
                </td>

                {/* Modified */}
                <td className="px-3 py-1.5 text-muted-foreground whitespace-nowrap">
                  {format(new Date(exp.updated_at), 'MMM d, yyyy')}
                </td>

                {/* Actions */}
                <td className="px-2 text-center">
                  <DropdownMenu>
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <DropdownMenuTrigger
                            render={
                              <Button
                                variant="ghost"
                                size="icon-xs"
                                onClick={(e) => e.stopPropagation()}
                              />
                            }
                          >
                            <MoreHorizontal size={15} className="text-muted-foreground" />
                          </DropdownMenuTrigger>
                        }
                      />
                      <TooltipContent>Actions</TooltipContent>
                    </Tooltip>
                    <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                      <DropdownMenuItem onClick={() => onRowAction?.('view', exp)}>
                        <ArrowRight size={14} />
                        Open
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => onRowAction?.('duplicate', exp)}>
                        <Copy size={14} />
                        Duplicate
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      {showArchive ? (
                        <DropdownMenuItem onClick={() => onRowAction?.('restore', exp)}>
                          <ArchiveRestore size={14} />
                          Restore
                        </DropdownMenuItem>
                      ) : (
                        <DropdownMenuItem
                          variant="destructive"
                          onClick={() => onRowAction?.('archive', exp)}
                        >
                          <Archive size={14} />
                          Archive
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </TooltipProvider>
  );
}
