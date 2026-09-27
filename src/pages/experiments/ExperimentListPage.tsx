import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, SlidersHorizontal, X, FlaskConical } from 'lucide-react';
import { useExperimentStore } from '@/stores/experimentStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { useNotebookStore } from '@/stores/notebookStore';
import ExperimentTable from '@/components/experiments/ExperimentTable';
import Button from '@/components/common/Button';
import Input from '@/components/common/Input';
import Dialog from '@/components/common/Dialog';
import EmptyState from '@/components/common/EmptyState';
import type { Experiment, ExperimentFilters, ExperimentStatus } from '@/lib/types';

const PAGE_SIZE = 50;

const STATUS_OPTIONS: { value: ExperimentStatus | ''; label: string }[] = [
  { value: '', label: 'All statuses' },
  { value: 'draft', label: 'Draft' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'completed', label: 'Completed' },
  { value: 'in_review', label: 'In Review' },
  { value: 'changes_requested', label: 'Changes Requested' },
  { value: 'approved', label: 'Approved' },
  { value: 'locked', label: 'Locked' },
];

export default function ExperimentListPage() {
  const navigate = useNavigate();
  const { currentWorkspace } = useWorkspaceStore();
  const { notebooks } = useNotebookStore();
  const {
    experiments,
    loading,
    filters,
    fetchExperiments,
    createExperiment,
    archiveExperiment,
    duplicateExperiment,
    toggleFavorite,
    setFilters,
    clearFilters,
  } = useExperimentStore();

  const [showCreate, setShowCreate] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newNotebookId, setNewNotebookId] = useState('');
  const [creating, setCreating] = useState(false);

  // Local filter state (debounced search)
  const [searchInput, setSearchInput] = useState(filters.search ?? '');
  const [statusFilter, setStatusFilter] = useState<ExperimentStatus | ''>(filters.status ?? '');
  const [notebookFilter, setNotebookFilter] = useState(filters.notebook_id ?? '');
  const [dateFrom, setDateFrom] = useState(filters.date_from ?? '');
  const [dateTo, setDateTo] = useState(filters.date_to ?? '');

  const sortBy = filters.sort_by ?? 'created_at';
  const sortOrder = filters.sort_order ?? 'desc';

  const wsId = currentWorkspace?.id;

  // Fetch experiments when workspace or filters change
  useEffect(() => {
    if (!wsId) return;
    fetchExperiments(wsId, filters);
  }, [wsId, filters, fetchExperiments]);

  // Debounce search input
  useEffect(() => {
    const t = setTimeout(() => {
      setFilters({ search: searchInput || undefined });
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput, setFilters]);

  function applyFilterChange(patch: Partial<ExperimentFilters>) {
    setFilters(patch);
  }

  function handleStatusChange(val: string) {
    setStatusFilter(val as ExperimentStatus | '');
    applyFilterChange({ status: val ? (val as ExperimentStatus) : null });
  }

  function handleNotebookChange(val: string) {
    setNotebookFilter(val);
    applyFilterChange({ notebook_id: val || null });
  }

  function handleDateFromChange(val: string) {
    setDateFrom(val);
    applyFilterChange({ date_from: val || null });
  }

  function handleDateToChange(val: string) {
    setDateTo(val);
    applyFilterChange({ date_to: val || null });
  }

  function handleClearFilters() {
    setSearchInput('');
    setStatusFilter('');
    setNotebookFilter('');
    setDateFrom('');
    setDateTo('');
    clearFilters();
  }

  const hasActiveFilters = !!(
    searchInput || statusFilter || notebookFilter || dateFrom || dateTo
  );

  function handleSort(field: NonNullable<ExperimentFilters['sort_by']>) {
    if (sortBy === field) {
      applyFilterChange({ sort_order: sortOrder === 'asc' ? 'desc' : 'asc' });
    } else {
      applyFilterChange({ sort_by: field, sort_order: 'desc' });
    }
  }

  function handleRowClick(exp: Experiment) {
    navigate(`/app/experiments/${exp.id}`);
  }

  function handleRowAction(action: string, exp: Experiment) {
    switch (action) {
      case 'view':
        navigate(`/app/experiments/${exp.id}`);
        break;
      case 'edit':
        navigate(`/app/experiments/${exp.id}/edit`);
        break;
      case 'duplicate':
        duplicateExperiment(exp.id);
        break;
      case 'archive':
        archiveExperiment(exp.id);
        break;
    }
  }

  async function handleCreate() {
    if (!wsId || !newNotebookId) return;
    setCreating(true);
    try {
      const exp = await createExperiment(wsId, newNotebookId, newTitle.trim() || undefined);
      setShowCreate(false);
      setNewTitle('');
      setNewNotebookId('');
      navigate(`/app/experiments/${exp.id}`);
    } catch (err) {
      console.error('Failed to create experiment:', err);
    } finally {
      setCreating(false);
    }
  }

  // Filter out archived
  const visibleExperiments = experiments.filter((e) => !e.is_archived);

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-200 px-6 py-3">
        <h1 className="text-base font-semibold text-gray-900">Experiments</h1>
        <Button
          icon={<Plus size={16} />}
          size="sm"
          onClick={() => {
            setNewNotebookId(notebooks[0]?.id ?? '');
            setShowCreate(true);
          }}
        >
          New Experiment
        </Button>
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-gray-100 px-6 py-2">
        <div className="w-56">
          <input
            type="text"
            placeholder="Search experiments…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="block w-full rounded-md border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500/30"
          />
        </div>

        <select
          value={statusFilter}
          onChange={(e) => handleStatusChange(e.target.value)}
          className="rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-sm text-gray-700 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500/30"
        >
          {STATUS_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>

        <select
          value={notebookFilter}
          onChange={(e) => handleNotebookChange(e.target.value)}
          className="rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-sm text-gray-700 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500/30"
        >
          <option value="">All notebooks</option>
          {notebooks.map((nb) => (
            <option key={nb.id} value={nb.id}>
              {nb.name}
            </option>
          ))}
        </select>

        <input
          type="date"
          value={dateFrom}
          onChange={(e) => handleDateFromChange(e.target.value)}
          className="rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-sm text-gray-700 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500/30"
          placeholder="From"
        />
        <input
          type="date"
          value={dateTo}
          onChange={(e) => handleDateToChange(e.target.value)}
          className="rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-sm text-gray-700 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500/30"
          placeholder="To"
        />

        {hasActiveFilters && (
          <button
            onClick={handleClearFilters}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium text-gray-500 hover:bg-gray-100 hover:text-gray-700"
          >
            <X size={13} />
            Clear filters
          </button>
        )}
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {loading && visibleExperiments.length === 0 ? (
          <div className="py-16 text-center text-sm text-gray-400">Loading experiments…</div>
        ) : visibleExperiments.length === 0 ? (
          <EmptyState
            icon={FlaskConical}
            title="No experiments found"
            description={
              hasActiveFilters
                ? 'Try adjusting your filters.'
                : 'Create your first experiment to get started.'
            }
            action={
              !hasActiveFilters ? (
                <Button
                  icon={<Plus size={16} />}
                  size="sm"
                  onClick={() => {
                    setNewNotebookId(notebooks[0]?.id ?? '');
                    setShowCreate(true);
                  }}
                >
                  New Experiment
                </Button>
              ) : undefined
            }
          />
        ) : (
          <ExperimentTable
            experiments={visibleExperiments}
            sortBy={sortBy}
            sortOrder={sortOrder}
            onSort={handleSort}
            onRowClick={handleRowClick}
            onRowAction={handleRowAction}
            onToggleFavorite={(id) => toggleFavorite(id)}
          />
        )}
      </div>

      {/* Create Dialog */}
      <Dialog
        open={showCreate}
        onClose={() => setShowCreate(false)}
        title="New Experiment"
        description="Select a notebook and optionally provide a title."
        size="sm"
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setShowCreate(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              loading={creating}
              disabled={!newNotebookId}
              onClick={handleCreate}
            >
              Create
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Notebook <span className="text-red-500">*</span>
            </label>
            <select
              value={newNotebookId}
              onChange={(e) => setNewNotebookId(e.target.value)}
              className="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            >
              <option value="">Select notebook…</option>
              {notebooks.map((nb) => (
                <option key={nb.id} value={nb.id}>
                  {nb.name}
                </option>
              ))}
            </select>
          </div>
          <Input
            label="Title"
            placeholder="Untitled Experiment"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
          />
        </div>
      </Dialog>
    </div>
  );
}
