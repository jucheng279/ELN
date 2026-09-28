import { Lock } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { ExperimentStatus } from '@/lib/types';
import { getStatusConfig } from '@/lib/statusConfig';

interface ExperimentStatusBadgeProps {
  status: ExperimentStatus;
  className?: string;
}

export default function ExperimentStatusBadge({ status, className }: ExperimentStatusBadgeProps) {
  const config = getStatusConfig(status);

  return (
    <Badge variant="outline" className={cn('gap-1 font-medium text-[11px] px-1.5 py-0', config.badgeClass, className)}>
      {status === 'locked' && <Lock className="h-3 w-3" />}
      {config.label}
    </Badge>
  );
}
