import type { ExperimentStatus } from '@/lib/types';

export interface StatusConfig {
  label: string;
  badgeClass: string;
  dotClass: string;
  bgClass: string;
  textClass: string;
}

export const statusConfig: Record<ExperimentStatus, StatusConfig> = {
  draft: {
    label: 'Draft',
    badgeClass: 'bg-muted text-muted-foreground border-transparent',
    dotClass: 'bg-muted-foreground',
    bgClass: 'bg-muted/50',
    textClass: 'text-muted-foreground',
  },
  in_progress: {
    label: 'In Progress',
    badgeClass: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950 dark:text-blue-300 dark:border-blue-800',
    dotClass: 'bg-blue-500',
    bgClass: 'bg-blue-50 dark:bg-blue-950/50',
    textClass: 'text-blue-700 dark:text-blue-300',
  },
  completed: {
    label: 'Completed',
    badgeClass: 'bg-green-50 text-green-700 border-green-200 dark:bg-green-950 dark:text-green-300 dark:border-green-800',
    dotClass: 'bg-green-500',
    bgClass: 'bg-green-50 dark:bg-green-950/50',
    textClass: 'text-green-700 dark:text-green-300',
  },
  in_review: {
    label: 'In Review',
    badgeClass: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:border-amber-800',
    dotClass: 'bg-amber-500',
    bgClass: 'bg-amber-50 dark:bg-amber-950/50',
    textClass: 'text-amber-700 dark:text-amber-300',
  },
  changes_requested: {
    label: 'Changes Requested',
    badgeClass: 'bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-950 dark:text-orange-300 dark:border-orange-800',
    dotClass: 'bg-orange-500',
    bgClass: 'bg-orange-50 dark:bg-orange-950/50',
    textClass: 'text-orange-700 dark:text-orange-300',
  },
  approved: {
    label: 'Approved',
    badgeClass: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:border-emerald-800',
    dotClass: 'bg-emerald-500',
    bgClass: 'bg-emerald-50 dark:bg-emerald-950/50',
    textClass: 'text-emerald-700 dark:text-emerald-300',
  },
  locked: {
    label: 'Locked',
    badgeClass: 'bg-muted text-muted-foreground border-transparent',
    dotClass: 'bg-muted-foreground',
    bgClass: 'bg-muted/50',
    textClass: 'text-muted-foreground',
  },
  archived: {
    label: 'Archived',
    badgeClass: 'bg-muted text-muted-foreground/70 border-transparent',
    dotClass: 'bg-muted-foreground/70',
    bgClass: 'bg-muted/30',
    textClass: 'text-muted-foreground/70',
  },
};

export function getStatusConfig(status: ExperimentStatus): StatusConfig {
  return statusConfig[status] ?? statusConfig.draft;
}
