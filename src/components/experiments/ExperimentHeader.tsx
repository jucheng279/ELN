import { useState, useRef, useEffect } from 'react';
import { useExperimentStore } from '@/stores/experimentStore';
import StatusBadge from '@/components/common/StatusBadge';
import DropdownMenu from '@/components/common/DropdownMenu';
import type { Experiment, ExperimentStatus } from '@/lib/types';
import { Star, MoreHorizontal, X, Plus, Calendar, FileDown } from 'lucide-react';
import { exportExperimentPdf } from '@/lib/pdfExport';

const ALL_STATUSES: ExperimentStatus[] = [
  'draft',
  'in_progress',
  'completed',
  'in_review',
  'changes_requested',
  'approved',
  'locked',
  'archived',
];

const STATUS_LABELS: Record<ExperimentStatus, string> = {
  draft: 'Draft',
  in_progress: 'In Progress',
  completed: 'Completed',
  in_review: 'In Review',
  changes_requested: 'Changes Requested',
  approved: 'Approved',
  locked: 'Locked',
  archived: 'Archived',
};

interface ExperimentHeaderProps {
  experiment: Experiment;
  readOnly: boolean;
}

export default function ExperimentHeader({ experiment, readOnly }: ExperimentHeaderProps) {
  const {
    updateExperiment,
    updateExperimentStatus,
    toggleFavorite,
    addTag,
    removeTag,
    duplicateExperiment,
    archiveExperiment,
  } = useExperimentStore();

  const [editingTitle, setEditingTitle] = useState(false);
  const [titleValue, setTitleValue] = useState(experiment.title);
  const [showTagInput, setShowTagInput] = useState(false);
  const [tagInputValue, setTagInputValue] = useState('');
  const titleInputRef = useRef<HTMLInputElement>(null);
  const tagInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTitleValue(experiment.title);
  }, [experiment.title]);

  useEffect(() => {
    if (editingTitle && titleInputRef.current) {
      titleInputRef.current.focus();
      titleInputRef.current.select();
    }
  }, [editingTitle]);

  useEffect(() => {
    if (showTagInput && tagInputRef.current) {
      tagInputRef.current.focus();
    }
  }, [showTagInput]);

  const handleTitleSave = () => {
    setEditingTitle(false);
    const trimmed = titleValue.trim();
    if (trimmed && trimmed !== experiment.title) {
      updateExperiment(experiment.id, { title: trimmed });
    } else {
      setTitleValue(experiment.title);
    }
  };

  const handleTitleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleTitleSave();
    } else if (e.key === 'Escape') {
      setTitleValue(experiment.title);
      setEditingTitle(false);
    }
  };

  const handleDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    updateExperiment(experiment.id, { experiment_date: e.target.value });
  };

  const handleAddTag = () => {
    const trimmed = tagInputValue.trim();
    if (trimmed) {
      addTag(experiment.id, trimmed);
      setTagInputValue('');
      setShowTagInput(false);
    }
  };

  const handleTagKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleAddTag();
    } else if (e.key === 'Escape') {
      setTagInputValue('');
      setShowTagInput(false);
    }
  };

  const statusMenuItems = ALL_STATUSES
    .filter((s) => s !== experiment.status)
    .map((status) => ({
      label: STATUS_LABELS[status],
      onClick: () => updateExperimentStatus(experiment.id, status),
    }));

  const moreActionsItems = [
    {
      label: 'Duplicate',
      onClick: () => duplicateExperiment(experiment.id),
    },
    {
      label: 'Export PDF',
      icon: FileDown,
      onClick: async () => {
        const { blocks } = useExperimentStore.getState();
        await exportExperimentPdf(experiment, blocks);
      },
    },
    {
      label: 'Archive',
      onClick: () => archiveExperiment(experiment.id),
    },

  ];

  const formattedDate = experiment.experiment_date
    ? new Date(experiment.experiment_date).toISOString().split('T')[0]
    : '';

  return (
    <div className="border-b border-gray-200 bg-white px-6 py-3">
      {/* Top row */}
      <div className="flex items-center gap-3">
        {/* Experiment ID badge */}
        <span className="shrink-0 rounded bg-gray-100 px-2 py-0.5 text-xs font-mono text-gray-600">
          {experiment.experiment_id}
        </span>

        {/* Editable title */}
        {editingTitle && !readOnly ? (
          <input
            ref={titleInputRef}
            type="text"
            value={titleValue}
            onChange={(e) => setTitleValue(e.target.value)}
            onBlur={handleTitleSave}
            onKeyDown={handleTitleKeyDown}
            className="flex-1 rounded border border-blue-300 px-2 py-0.5 text-xl font-semibold text-gray-900 outline-none ring-2 ring-blue-100"
          />
        ) : (
          <h1
            className={`text-xl font-semibold text-gray-900 truncate ${
              !readOnly ? 'cursor-text hover:bg-gray-50 rounded px-2 py-0.5 -mx-2' : ''
            }`}
            onClick={() => !readOnly && setEditingTitle(true)}
          >
            {experiment.title}
          </h1>
        )}

        {/* Status badge */}
        <StatusBadge status={experiment.status} />

        {/* Spacer */}
        <div className="flex-1" />

        {/* Favorite star */}
        <button
          onClick={() => toggleFavorite(experiment.id)}
          className="rounded p-1.5 hover:bg-gray-100 transition-colors"
          title={experiment.is_favorited ? 'Remove from favorites' : 'Add to favorites'}
        >
          <Star
            className={`h-5 w-5 ${
              experiment.is_favorited
                ? 'fill-yellow-400 text-yellow-400'
                : 'text-gray-400'
            }`}
          />
        </button>

        {/* Status dropdown */}
        {!readOnly && (
          <DropdownMenu
            trigger={
              <button className="rounded border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50 transition-colors">
                Change status
              </button>
            }
            items={statusMenuItems}
            align="right"
          />
        )}

        {/* More actions */}
        <DropdownMenu
          trigger={
            <button className="rounded p-1.5 hover:bg-gray-100 transition-colors">
              <MoreHorizontal className="h-5 w-5 text-gray-500" />
            </button>
          }
          items={moreActionsItems}
          align="right"
        />
      </div>

      {/* Bottom row */}
      <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-gray-500">
        {/* Notebook */}
        {experiment.notebook?.name && (
          <span>
            in <span className="font-medium text-gray-700">{experiment.notebook.name}</span>
          </span>
        )}

        {/* Owner */}
        {experiment.created_by_profile?.display_name && (
          <span>
            by{' '}
            <span className="font-medium text-gray-700">
              {experiment.created_by_profile.display_name}
            </span>
          </span>
        )}

        {/* Date */}
        <span className="flex items-center gap-1">
          <Calendar className="h-3.5 w-3.5" />
          {readOnly ? (
            <span>{formattedDate || 'No date'}</span>
          ) : (
            <input
              type="date"
              value={formattedDate}
              onChange={handleDateChange}
              className="border-none bg-transparent p-0 text-sm text-gray-500 outline-none hover:text-gray-700 cursor-pointer"
            />
          )}
        </span>

        {/* Separator */}
        <span className="text-gray-300">|</span>

        {/* Tags */}
        <div className="flex flex-wrap items-center gap-1.5">
          {experiment.tags?.map((tag) => (
            <span
              key={tag.id}
              className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-700"
            >
              {tag.name}
              {!readOnly && (
                <button
                  onClick={() => removeTag(experiment.id, tag.id)}
                  className="rounded-full p-0.5 hover:bg-blue-100"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </span>
          ))}

          {/* Add tag */}
          {!readOnly && (
            <>
              {showTagInput ? (
                <input
                  ref={tagInputRef}
                  type="text"
                  value={tagInputValue}
                  onChange={(e) => setTagInputValue(e.target.value)}
                  onBlur={() => {
                    if (!tagInputValue.trim()) {
                      setShowTagInput(false);
                    } else {
                      handleAddTag();
                    }
                  }}
                  onKeyDown={handleTagKeyDown}
                  placeholder="Tag name"
                  className="w-24 rounded-full border border-gray-300 px-2 py-0.5 text-xs outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100"
                />
              ) : (
                <button
                  onClick={() => setShowTagInput(true)}
                  className="inline-flex items-center gap-0.5 rounded-full border border-dashed border-gray-300 px-2 py-0.5 text-xs text-gray-400 hover:border-gray-400 hover:text-gray-500 transition-colors"
                >
                  <Plus className="h-3 w-3" />
                  Add tag
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
