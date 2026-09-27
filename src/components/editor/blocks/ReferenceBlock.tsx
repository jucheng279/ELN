import { useState, useCallback, useRef } from 'react';
import { BookOpen, ExternalLink, Pencil } from 'lucide-react';

interface ReferenceBlockContent {
  doi: string;
  url: string;
  title: string;
  citation: string;
  notes: string;
}

interface ReferenceBlockProps {
  content: ReferenceBlockContent;
  onUpdate: (content: ReferenceBlockContent) => void;
  readOnly: boolean;
}

export default function ReferenceBlock({ content, onUpdate, readOnly }: ReferenceBlockProps) {
  const [isEditing, setIsEditing] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hasContent = !!content.title;

  const handleFieldChange = useCallback(
    (field: keyof ReferenceBlockContent, value: string) => {
      const updated = { ...content, [field]: value };

      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
      debounceRef.current = setTimeout(() => {
        onUpdate(updated);
      }, 400);
    },
    [content, onUpdate]
  );

  const handleEdit = useCallback(() => {
    setIsEditing(true);
  }, []);

  const handleDoneEditing = useCallback(() => {
    setIsEditing(false);
    // Flush any pending debounce
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
    onUpdate(content);
  }, [content, onUpdate]);

  // Display mode
  if (hasContent && !isEditing) {
    return (
      <div className="rounded-lg border border-gray-200 p-4 relative">
        <div className="flex items-start gap-3">
          <BookOpen className="h-4 w-4 text-gray-400 mt-0.5 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="font-medium text-gray-900">{content.title}</p>

            {content.citation && (
              <p className="text-sm text-gray-600 italic mt-1">{content.citation}</p>
            )}

            <div className="flex items-center gap-3 mt-2">
              {content.doi && (
                <a
                  href={`https://doi.org/${content.doi}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 bg-blue-50 rounded px-2 py-0.5"
                >
                  DOI: {content.doi}
                  <ExternalLink className="h-3 w-3" />
                </a>
              )}
              {content.url && (
                <a
                  href={content.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800"
                >
                  Link
                  <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>

            {content.notes && (
              <p className="text-sm text-gray-500 mt-2">{content.notes}</p>
            )}
          </div>

          {!readOnly && (
            <button
              onClick={handleEdit}
              className="p-1 text-gray-400 hover:text-gray-600 rounded hover:bg-gray-100 shrink-0"
            >
              <Pencil className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
    );
  }

  // Form / edit mode
  return (
    <div className="rounded-lg border border-gray-200 p-4">
      <div className="flex items-center gap-2 mb-4">
        <BookOpen className="h-4 w-4 text-gray-400" />
        <span className="text-sm font-medium text-gray-700">Reference</span>
        {isEditing && (
          <button
            onClick={handleDoneEditing}
            className="ml-auto text-xs text-blue-600 hover:text-blue-800"
          >
            Done
          </button>
        )}
      </div>

      <div className="space-y-3">
        <div>
          <label className="block text-xs font-medium text-gray-500 uppercase mb-1">DOI</label>
          <input
            type="text"
            defaultValue={content.doi}
            onChange={(e) => handleFieldChange('doi', e.target.value)}
            placeholder="e.g. 10.1234/example"
            readOnly={readOnly}
            className="text-sm border border-gray-200 rounded-md px-3 py-1.5 w-full focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent read-only:bg-gray-50"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-500 uppercase mb-1">URL</label>
          <input
            type="text"
            defaultValue={content.url}
            onChange={(e) => handleFieldChange('url', e.target.value)}
            placeholder="https://..."
            readOnly={readOnly}
            className="text-sm border border-gray-200 rounded-md px-3 py-1.5 w-full focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent read-only:bg-gray-50"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-500 uppercase mb-1">Title</label>
          <input
            type="text"
            defaultValue={content.title}
            onChange={(e) => handleFieldChange('title', e.target.value)}
            placeholder="Reference title"
            readOnly={readOnly}
            className="text-sm border border-gray-200 rounded-md px-3 py-1.5 w-full focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent read-only:bg-gray-50"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-500 uppercase mb-1">Citation</label>
          <textarea
            defaultValue={content.citation}
            onChange={(e) => handleFieldChange('citation', e.target.value)}
            placeholder="Full citation text..."
            readOnly={readOnly}
            rows={3}
            className="text-sm border border-gray-200 rounded-md px-3 py-1.5 w-full focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none read-only:bg-gray-50"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-500 uppercase mb-1">Notes</label>
          <textarea
            defaultValue={content.notes}
            onChange={(e) => handleFieldChange('notes', e.target.value)}
            placeholder="Additional notes..."
            readOnly={readOnly}
            rows={2}
            className="text-sm border border-gray-200 rounded-md px-3 py-1.5 w-full focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none read-only:bg-gray-50"
          />
        </div>
      </div>
    </div>
  );
}
