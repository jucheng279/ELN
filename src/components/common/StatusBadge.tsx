import type { ExperimentStatus } from '@/lib/types';

const statusConfig: Record<
  ExperimentStatus,
  { label: string; bg: string; text: string }
> = {
  draft: {
    label: 'Draft',
    bg: 'bg-gray-100',
    text: 'text-gray-600',
  },
  in_progress: {
    label: 'In Progress',
    bg: 'bg-blue-50',
    text: 'text-blue-700',
  },
  completed: {
    label: 'Completed',
    bg: 'bg-green-50',
    text: 'text-green-700',
  },
  in_review: {
    label: 'In Review',
    bg: 'bg-amber-50',
    text: 'text-amber-700',
  },
  changes_requested: {
    label: 'Changes Requested',
    bg: 'bg-orange-50',
    text: 'text-orange-700',
  },
  approved: {
    label: 'Approved',
    bg: 'bg-emerald-50',
    text: 'text-emerald-700',
  },
  locked: {
    label: 'Locked',
    bg: 'bg-slate-100',
    text: 'text-slate-600',
  },
  archived: {
    label: 'Archived',
    bg: 'bg-gray-100',
    text: 'text-gray-500',
  },
};

interface StatusBadgeProps {
  status: ExperimentStatus;
  className?: string;
}

export default function StatusBadge({ status, className = '' }: StatusBadgeProps) {
  const config = statusConfig[status] ?? statusConfig.draft;

  return (
    <span
      className={[
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
        config.bg,
        config.text,
        className,
      ].join(' ')}
    >
      {config.label}
    </span>
  );
}
