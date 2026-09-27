import { useState, useRef, useEffect, type ReactNode, type ReactElement } from 'react';
import type { LucideIcon } from 'lucide-react';

export interface DropdownMenuItem {
  label: string;
  icon?: LucideIcon;
  onClick: () => void;
  variant?: 'default' | 'danger';
}

interface DropdownMenuProps {
  trigger: ReactElement;
  items: DropdownMenuItem[];
  align?: 'left' | 'right';
}

export default function DropdownMenu({
  trigger,
  items,
  align = 'right',
}: DropdownMenuProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    if (open) {
      document.addEventListener('keydown', handleKeyDown);
    }
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open]);

  return (
    <div ref={ref} className="relative inline-flex">
      <div
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            e.stopPropagation();
            setOpen((v) => !v);
          }
        }}
      >
        {trigger}
      </div>

      {open && (
        <div
          className={[
            'absolute top-full mt-1 z-50 min-w-[180px] rounded-lg border border-gray-200 bg-white py-1 shadow-lg',
            align === 'right' ? 'right-0' : 'left-0',
          ].join(' ')}
        >
          {items.map((item, i) => {
            const Icon = item.icon;
            const isDanger = item.variant === 'danger';
            return (
              <button
                key={i}
                onClick={(e) => {
                  e.stopPropagation();
                  item.onClick();
                  setOpen(false);
                }}
                className={[
                  'flex w-full items-center gap-2 px-3 py-1.5 text-sm transition-colors text-left',
                  isDanger
                    ? 'text-red-600 hover:bg-red-50'
                    : 'text-gray-700 hover:bg-gray-50',
                ].join(' ')}
              >
                {Icon && <Icon size={15} className="shrink-0" />}
                {item.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
