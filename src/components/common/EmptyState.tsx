import { type ReactNode, type ReactElement, isValidElement } from 'react';
import type { LucideIcon } from 'lucide-react';

interface EmptyStateProps {
  icon?: LucideIcon | ReactElement;
  title: string;
  description?: string;
  action?: ReactNode;
}

export default function EmptyState({
  icon,
  title,
  description,
  action,
}: EmptyStateProps) {
  const renderIcon = () => {
    if (!icon) return null;
    if (isValidElement(icon)) {
      return (
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-gray-100 text-gray-400">
          {icon}
        </div>
      );
    }
    const Icon = icon as LucideIcon;
    return (
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-gray-100">
        <Icon size={24} className="text-gray-400" />
      </div>
    );
  };

  return (
    <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
      {renderIcon()}
      <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
      {description && (
        <p className="mt-1 max-w-sm text-sm text-gray-500">{description}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
