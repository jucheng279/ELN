import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, X, FlaskConical, Search } from 'lucide-react';
import { useExperimentStore } from '@/stores/experimentStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { useNotebookStore } from '@/stores/notebookStore';
import ExperimentTable from '@/components/experiments/ExperimentTable';
import PageHeader from '@/components/eln/PageHeader';
import EmptyState from '@/components/eln/EmptyState';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
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
        navigate(`/app/experiments/${exp.id}`);
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

  function openCreateDialog() {
    setNewNotebookId(notebooks[0]?.id ?? '');
    setShowCreate(true);
  }

  // Filter out archived
  const visibleExperiments = experiments.filter((e) => !e.is_archived);

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="border-b px-6 py-3">
        <PageHeader
          title="Experiments"
          actions={
            <Button size="sm" onClick={openCreateDialog}>
              <Plus size={15} />
              New Experiment
            </Button>
          }
        />
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2 border-b px-6 py-2">
        <div className="relative w-56">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search experiments…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="h-8 pl-8 text-sm"
          />
        </div>

        <Select value={statusFilter} onValueChange={(v) => v !== null && handleStatusChange(v)}>
          <SelectTrigger className="w-[150px]">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={notebookFilter} onValueChange={(v) => v !== null && handleNotebookChange(v)}>
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="All notebooks" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">All notebooks</SelectItem>
            {notebooks.map((nb) => (
              <SelectItem key={nb.id} value={nb.id}>
                {nb.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Input
          type="date"
          value={dateFrom}
          onChange={(e) => handleDateFromChange(e.target.value)}
          className="h-8 w-[140px] text-sm"
          placeholder="From"
        />
        <Input
          type="date"
          value={dateTo}
          onChange={(e) => handleDateToChange(e.target.value)}
          className="h-8 w-[140px] text-sm"
          placeholder="To"
        />

        {hasActiveFilters && (
          <Button variant="ghost" size="sm" onClick={handleClearFilters}>
            <X size={13} />
            Clear filters
          </Button>
        )}
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {loading && visibleExperiments.length === 0 ? (
          <div className="py-16 text-center text-sm text-muted-foreground">Loading experiments…</div>
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
                <Button size="sm" onClick={openCreateDialog}>
                  <Plus size={15} />
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
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New Experiment</DialogTitle>
            <DialogDescription>
              Select a notebook and optionally provide a title.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>
                Notebook <span className="text-destructive">*</span>
              </Label>
              <Select value={newNotebookId} onValueChange={(v) => v !== null && setNewNotebookId(v)}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select notebook…" />
                </SelectTrigger>
                <SelectContent>
                  {notebooks.map((nb) => (
                    <SelectItem key={nb.id} value={nb.id}>
                      {nb.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Title</Label>
              <Input
                placeholder="Untitled Experiment"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setShowCreate(false)}>
              Cancel
            </Button>
            <Button size="sm" disabled={!newNotebookId || creating} onClick={handleCreate}>
              {creating ? 'Creating…' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
