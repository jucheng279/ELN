import { useEffect, useCallback, type ReactNode } from 'react';
import { X } from 'lucide-react';

type DialogSize = 'sm' | 'md' | 'lg';

interface DialogProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  size?: DialogSize;
  children: ReactNode;
  footer?: ReactNode;
}

const sizeClasses: Record<DialogSize, string> = {
  sm: 'max-w-md',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
};

export default function Dialog({
  open,
  onClose,
  title,
  description,
  size = 'md',
  children,
  footer,
}: DialogProps) {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    },
    [onClose],
  );

  useEffect(() => {
    if (open) {
      document.addEventListener('keydown', handleKeyDown);
      document.body.style.overflow = 'hidden';
    }
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
    };
  }, [open, handleKeyDown]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 animate-in fade-in duration-150"
        onClick={onClose}
      />

      {/* Panel */}
      <div
        className={[
          'relative z-10 w-full rounded-lg bg-white shadow-xl',
          'animate-in fade-in zoom-in-95 duration-150',
          'mx-4',
          sizeClasses[size],
        ].join(' ')}
      >
        {/* Header */}
        {(title || description) && (
          <div className="border-b border-gray-200 px-6 py-4">
            <div className="flex items-start justify-between">
              <div>
                {title && (
                  <h2 className="text-base font-semibold text-gray-900">
                    {title}
                  </h2>
                )}
                {description && (
                  <p className="mt-1 text-sm text-gray-500">{description}</p>
                )}
              </div>
              <button
                onClick={onClose}
                className="ml-4 rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
              >
                <X size={18} />
              </button>
            </div>
          </div>
        )}

        {/* Body */}
        <div className="px-6 py-4">{children}</div>

        {/* Footer */}
        {footer && (
          <div className="border-t border-gray-200 px-6 py-3 flex items-center justify-end gap-2">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
