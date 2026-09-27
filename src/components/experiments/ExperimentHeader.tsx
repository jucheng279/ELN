import { useState, useRef, useEffect } from 'react';
import { useExperimentStore } from '@/stores/experimentStore';
import ExperimentStatusBadge from '@/components/eln/ExperimentStatusBadge';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from '@/components/ui/tooltip';
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from '@/components/ui/popover';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import type { Experiment } from '@/lib/types';
import {
  Star,
  MoreHorizontal,
  X,
  Plus,
  Calendar,
  FileDown,
  Lock,
  Loader2,
  Check,
  Clock,
  Copy,
  Archive,
  Play,
  CheckCircle,
  RotateCcw,
} from 'lucide-react';
import { exportExperimentPdf } from '@/lib/pdfExport';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface ExperimentHeaderProps {
  experiment: Experiment;
  readOnly: boolean;
  saving?: boolean;
  lastSaved?: Date | null;
}

export default function ExperimentHeader({
  experiment,
  readOnly,
  saving,
  lastSaved,
}: ExperimentHeaderProps) {
  const {
    updateExperiment,
    startExperiment,
    completeExperiment,
    reopenExperiment,
    toggleFavorite,
    addTag,
    removeTag,
    duplicateExperiment,
    archiveExperiment,
  } = useExperimentStore();

  const [editingTitle, setEditingTitle] = useState(false);
  const [titleValue, setTitleValue] = useState(experiment.title);
  const [tagInputValue, setTagInputValue] = useState('');
  const [tagPopoverOpen, setTagPopoverOpen] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const titleInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTitleValue(experiment.title);
  }, [experiment.title]);

  useEffect(() => {
    if (editingTitle && titleInputRef.current) {
      titleInputRef.current.focus();
      titleInputRef.current.select();
    }
  }, [editingTitle]);

  const handleTitleSave = () => {
    setEditingTitle(false);
    const trimmed = titleValue.trim();
    if (trimmed && trimmed !== experiment.title) {
      updateExperiment(experiment.id, { title: trimmed });
    } else {
      setTitleValue(experiment.title);
    }
  };

  const handleTitleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleTitleSave();
    else if (e.key === 'Escape') { setTitleValue(experiment.title); setEditingTitle(false); }
  };

  const handleDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    updateExperiment(experiment.id, { experiment_date: e.target.value });
  };

  const handleAddTag = () => {
    const trimmed = tagInputValue.trim();
    if (trimmed) {
      addTag(experiment.id, trimmed);
      setTagInputValue('');
      setTagPopoverOpen(false);
    }
  };

  const handleTagKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleAddTag();
    else if (e.key === 'Escape') { setTagInputValue(''); setTagPopoverOpen(false); }
  };

  const runAction = async (action: () => Promise<void>, successMsg: string) => {
    setActionLoading(true);
    try {
      await action();
      toast.success(successMsg);
    } catch (err: any) {
      toast.error(err?.message || 'Action failed');
    } finally {
      setActionLoading(false);
    }
  };

  const formattedDate = experiment.experiment_date
    ? new Date(experiment.experiment_date).toISOString().split('T')[0]
    : '';

  return (
    <div className={cn('border-b bg-background px-6 py-3')}>
      {/* Top row */}
      <div className="flex items-center gap-2">
        <span className="shrink-0 rounded-md bg-muted px-2 py-0.5 font-mono text-xs text-muted-foreground">
          {experiment.experiment_id}
        </span>

        {experiment.is_locked && (
          <Lock className="h-4 w-4 shrink-0 text-muted-foreground" />
        )}

        {editingTitle && !readOnly ? (
          <input
            ref={titleInputRef}
            type="text"
            value={titleValue}
            onChange={(e) => setTitleValue(e.target.value)}
            onBlur={handleTitleSave}
            onKeyDown={handleTitleKeyDown}
            className={cn(
              'flex-1 rounded-md border border-ring px-2 py-0.5 text-xl font-semibold text-foreground outline-none ring-2 ring-ring/20'
            )}
          />
        ) : (
          <h1
            className={cn(
              'truncate text-xl font-semibold text-foreground',
              !readOnly && 'cursor-text rounded-md px-2 py-0.5 -mx-2 hover:bg-muted'
            )}
            onClick={() => !readOnly && setEditingTitle(true)}
          >
            {experiment.title}
          </h1>
        )}

        <span className="shrink-0 flex items-center gap-1 text-xs text-muted-foreground">
          {saving ? (
            <><Loader2 className="h-3 w-3 animate-spin" /><span>Saving...</span></>
          ) : lastSaved ? (
            <><Check className="h-3 w-3 text-green-600" /><span>Saved</span></>
          ) : lastSaved === null ? (
            <><Clock className="h-3 w-3 text-amber-500" /><span className="text-amber-600">Unsaved</span></>
          ) : null}
        </span>

        <ExperimentStatusBadge status={experiment.status} />

        <div className="flex-1" />

        {/* Lifecycle action button */}
        {experiment.status === 'draft' && !readOnly && (
          <Button size="xs" disabled={actionLoading} onClick={() => runAction(() => startExperiment(experiment.id), 'Experiment started')}>
            <Play className="h-3.5 w-3.5" /> Start
          </Button>
        )}
        {experiment.status === 'in_progress' && !readOnly && (
          <Button size="xs" disabled={actionLoading} onClick={() => runAction(() => completeExperiment(experiment.id), 'Experiment completed')}>
            <CheckCircle className="h-3.5 w-3.5" /> Complete
          </Button>
        )}
        {(experiment.status === 'completed' || experiment.status === 'changes_requested') && !readOnly && (
          <Button variant="outline" size="xs" disabled={actionLoading} onClick={() => runAction(() => reopenExperiment(experiment.id), 'Experiment reopened')}>
            <RotateCcw className="h-3.5 w-3.5" /> Reopen
          </Button>
        )}

        {/* Favorite */}
        <Tooltip>
          <TooltipTrigger
            render={
              <Button variant="ghost" size="icon-sm" onClick={() => toggleFavorite(experiment.id)} />
            }
          >
            <Star className={cn('h-4 w-4', experiment.is_favorited ? 'fill-yellow-400 text-yellow-400' : 'text-muted-foreground')} />
          </TooltipTrigger>
          <TooltipContent>
            {experiment.is_favorited ? 'Remove from favorites' : 'Add to favorites'}
          </TooltipContent>
        </Tooltip>

        {/* More actions */}
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" />}>
            <MoreHorizontal className="h-4 w-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => duplicateExperiment(experiment.id)}>
              <Copy className="h-4 w-4" /> Duplicate
            </DropdownMenuItem>
            <DropdownMenuItem onClick={async () => {
              const { blocks } = useExperimentStore.getState();
              await exportExperimentPdf(experiment, blocks);
            }}>
              <FileDown className="h-4 w-4" /> Export PDF
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={() => archiveExperiment(experiment.id)}>
              <Archive className="h-4 w-4" /> Archive
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Bottom row */}
      <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        {experiment.notebook?.name && (
          <span>in <span className="font-medium text-foreground">{experiment.notebook.name}</span></span>
        )}
        {experiment.created_by_profile?.display_name && (
          <span>by <span className="font-medium text-foreground">{experiment.created_by_profile.display_name}</span></span>
        )}
        <span className="flex items-center gap-1">
          <Calendar className="h-3.5 w-3.5" />
          {readOnly ? (
            <span>{formattedDate || 'No date'}</span>
          ) : (
            <input
              type="date"
              value={formattedDate}
              onChange={handleDateChange}
              className={cn('border-none bg-transparent p-0 text-sm text-muted-foreground outline-none hover:text-foreground cursor-pointer')}
            />
          )}
        </span>

        <Separator orientation="vertical" className="h-4" />

        <div className="flex flex-wrap items-center gap-1.5">
          {experiment.tags?.map((tag) => (
            <Badge key={tag.id} variant="secondary" className="gap-1 text-xs font-normal">
              {tag.name}
              {!readOnly && (
                <button onClick={() => removeTag(experiment.id, tag.id)} className="rounded-full p-0.5 hover:bg-foreground/10">
                  <X className="h-3 w-3" />
                </button>
              )}
            </Badge>
          ))}

          {!readOnly && (
            <Popover open={tagPopoverOpen} onOpenChange={setTagPopoverOpen}>
              <PopoverTrigger render={<Button variant="ghost" size="xs" className="gap-0.5 text-muted-foreground" />}>
                <Plus className="h-3 w-3" /> Add tag
              </PopoverTrigger>
              <PopoverContent className="w-48 p-2" align="start">
                <Input
                  value={tagInputValue}
                  onChange={(e) => setTagInputValue(e.target.value)}
                  onKeyDown={handleTagKeyDown}
                  placeholder="Tag name"
                  className="h-7 text-xs"
                  autoFocus
                />
                <Button size="xs" className="mt-1.5 w-full" disabled={!tagInputValue.trim()} onClick={handleAddTag}>
                  Add
                </Button>
              </PopoverContent>
            </Popover>
          )}
        </div>
      </div>
    </div>
  );
}
