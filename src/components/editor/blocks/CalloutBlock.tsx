import { useState, useRef, useEffect, useCallback } from 'react';
import { Info, AlertTriangle, Lightbulb, AlertOctagon, LucideIcon } from 'lucide-react';
import type { CalloutContent, CalloutType } from '@/lib/types';

interface CalloutBlockProps {
  content: CalloutContent;
  onUpdate: (content: CalloutContent) => void;
  readOnly: boolean;
}

interface CalloutConfig {
  bg: string;
  border: string;
  icon: LucideIcon;
  text: string;
}

const calloutTypes: Record<CalloutType, CalloutConfig> = {
  note: {
    bg: 'bg-blue-50',
    border: 'border-blue-200',
    icon: Info,
    text: 'text-blue-800',
  },
  warning: {
    bg: 'bg-amber-50',
    border: 'border-amber-200',
    icon: AlertTriangle,
    text: 'text-amber-800',
  },
  tip: {
    bg: 'bg-green-50',
    border: 'border-green-200',
    icon: Lightbulb,
    text: 'text-green-800',
  },
  danger: {
    bg: 'bg-red-50',
    border: 'border-red-200',
    icon: AlertOctagon,
    text: 'text-red-800',
  },
};

export default function CalloutBlock({
  content,
  onUpdate,
  readOnly,
}: CalloutBlockProps) {
  const [isHovered, setIsHovered] = useState(false);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const contentEditableRef = useRef<HTMLDivElement>(null);

  const type: CalloutType = content?.type || 'note';
  const html: string = content?.html || '';
  const config = calloutTypes[type];
  const IconComponent = config.icon;

  const handleTypeChange = useCallback(
    (newType: CalloutType) => {
      onUpdate({ type: newType, html });
    },
    [html, onUpdate]
  );

  const handleInput = useCallback(() => {
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
    }

    debounceTimer.current = setTimeout(() => {
      const newHtml = contentEditableRef.current?.innerHTML || '';
      onUpdate({ type, html: newHtml });
    }, 500);
  }, [type, onUpdate]);

  useEffect(() => {
    if (
      contentEditableRef.current &&
      document.activeElement !== contentEditableRef.current
    ) {
      const currentHtml = contentEditableRef.current.innerHTML;
      if (currentHtml !== html) {
        contentEditableRef.current.innerHTML = html;
      }
    }
  }, [html]);

  useEffect(() => {
    return () => {
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
      }
    };
  }, []);

  return (
    <div
      className={`relative rounded-lg border-l-4 p-4 ${config.bg} ${config.border}`}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {!readOnly && isHovered && (
        <div className="absolute -top-3 right-2 flex items-center gap-0.5 rounded-md border border-gray-200 bg-white px-1 py-0.5 shadow-sm">
          {(Object.keys(calloutTypes) as CalloutType[]).map((t) => {
            const TypeIcon = calloutTypes[t].icon;
            return (
              <button
                key={t}
                type="button"
                onClick={() => handleTypeChange(t)}
                className={`rounded p-1 transition-colors ${
                  type === t
                    ? 'bg-gray-200 text-gray-900'
                    : 'text-gray-500 hover:bg-gray-100'
                }`}
                title={t.charAt(0).toUpperCase() + t.slice(1)}
              >
                <TypeIcon className="h-3.5 w-3.5" />
              </button>
            );
          })}
        </div>
      )}

      <div className="flex gap-3">
        <div className="mt-0.5 flex-shrink-0">
          <IconComponent className={`h-5 w-5 ${config.text}`} />
        </div>
        <div
          ref={contentEditableRef}
          contentEditable={!readOnly}
          suppressContentEditableWarning
          onInput={handleInput}
          className={`min-h-[1.5rem] flex-1 text-sm leading-relaxed outline-none ${config.text}`}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      </div>
    </div>
  );
}
