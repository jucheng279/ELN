import { Lock } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { ExperimentStatus } from '@/lib/types';

const statusConfig: Record<ExperimentStatus, { label: string; className: string }> = {
  draft: { label: 'Draft', className: 'bg-muted text-muted-foreground border-transparent' },
  in_progress: { label: 'In Progress', className: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950 dark:text-blue-300 dark:border-blue-800' },
  completed: { label: 'Completed', className: 'bg-green-50 text-green-700 border-green-200 dark:bg-green-950 dark:text-green-300 dark:border-green-800' },
  in_review: { label: 'In Review', className: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-800' },
  changes_requested: { label: 'Changes Requested', className: 'bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-950 dark:text-orange-300 dark:border-orange-800' },
  approved: { label: 'Approved', className: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-800' },
  locked: { label: 'Locked', className: 'bg-muted text-muted-foreground border-transparent' },
  archived: { label: 'Archived', className: 'bg-muted text-muted-foreground/70 border-transparent' },
};

interface ExperimentStatusBadgeProps {
  status: ExperimentStatus;
  className?: string;
}

export default function ExperimentStatusBadge({ status, className }: ExperimentStatusBadgeProps) {
  const config = statusConfig[status] ?? statusConfig.draft;

  return (
    <Badge variant="outline" className={cn('gap-1 font-medium text-[11px] px-1.5 py-0', config.className, className)}>
      {status === 'locked' && <Lock className="h-3 w-3" />}
      {config.label}
    </Badge>
  );
}
