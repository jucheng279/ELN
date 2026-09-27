import { useState, useCallback } from 'react';
import { FlaskConical, ExternalLink, X, Search, Link } from 'lucide-react';
import StatusBadge from '@/components/common/StatusBadge';
import type { ExperimentStatus } from '@/lib/types';

interface RelatedExperimentBlockContent {
  experiment_id: string | null;
  experiment_display_id: string;
  title: string;
  status: string;
}

interface RelatedExperimentBlockProps {
  content: RelatedExperimentBlockContent;
  onUpdate: (content: RelatedExperimentBlockContent) => void;
  readOnly: boolean;
}

export default function RelatedExperimentBlock({
  content,
  onUpdate,
  readOnly,
}: RelatedExperimentBlockProps) {
  const [displayIdInput, setDisplayIdInput] = useState('');
  const [titleInput, setTitleInput] = useState('');

  const isLinked = !!content.experiment_id || !!content.title;

  const handleLinkExperiment = useCallback(() => {
    if (!displayIdInput.trim() || !titleInput.trim()) return;
    onUpdate({
      experiment_id: crypto.randomUUID(),
      experiment_display_id: displayIdInput.trim(),
      title: titleInput.trim(),
      status: 'draft',
    });
    setDisplayIdInput('');
    setTitleInput('');
  }, [displayIdInput, titleInput, onUpdate]);

  const handleUnlink = useCallback(() => {
    onUpdate({
      experiment_id: null,
      experiment_display_id: '',
      title: '',
      status: '',
    });
  }, [onUpdate]);

  // Empty state - no experiment linked
  if (!isLinked) {
    return (
      <div className="rounded-lg border-2 border-dashed border-gray-300 p-5">
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="flex items-center gap-2 text-gray-400">
            <FlaskConical className="h-5 w-5" />
            <Search className="h-4 w-4" />
          </div>
          <p className="text-sm text-gray-500">Search for an experiment...</p>
          {!readOnly && (
            <div className="w-full max-w-sm space-y-2">
              <input
                type="text"
                value={displayIdInput}
                onChange={(e) => setDisplayIdInput(e.target.value)}
                placeholder="Experiment ID (e.g. EXP-001)"
                className="w-full text-sm border border-gray-200 rounded-md px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
              <input
                type="text"
                value={titleInput}
                onChange={(e) => setTitleInput(e.target.value)}
                placeholder="Experiment title"
                className="w-full text-sm border border-gray-200 rounded-md px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleLinkExperiment();
                }}
              />
              <button
                onClick={handleLinkExperiment}
                disabled={!displayIdInput.trim() || !titleInput.trim()}
                className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Link className="h-3.5 w-3.5" />
                Link Experiment
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Linked state
  return (
    <div className="rounded-lg border border-gray-200 p-3 flex items-center gap-3">
      <div className="shrink-0 text-gray-400">
        <FlaskConical className="h-5 w-5" />
      </div>

      <span className="font-mono text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded shrink-0">
        {content.experiment_display_id}
      </span>

      <span className="font-medium text-gray-900 truncate">{content.title}</span>

      {content.status && (
        <div className="shrink-0">
          <StatusBadge status={content.status as ExperimentStatus} />
        </div>
      )}

      <div className="ml-auto flex items-center gap-1 shrink-0">
        <button
          className="p-1 text-gray-400 hover:text-blue-600 rounded hover:bg-gray-100"
          title="Open experiment"
        >
          <ExternalLink className="h-4 w-4" />
        </button>

        {!readOnly && (
          <button
            onClick={handleUnlink}
            className="p-1 text-gray-400 hover:text-red-600 rounded hover:bg-gray-100"
            title="Unlink experiment"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}
