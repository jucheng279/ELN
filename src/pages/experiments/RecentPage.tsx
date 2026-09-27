import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Clock } from 'lucide-react';
import { useExperimentStore } from '@/stores/experimentStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import ExperimentTable from '@/components/experiments/ExperimentTable';
import PageHeader from '@/components/eln/PageHeader';
import EmptyState from '@/components/eln/EmptyState';
import type { Experiment, ExperimentFilters } from '@/lib/types';

export default function RecentPage() {
  const navigate = useNavigate();
  const { currentWorkspace } = useWorkspaceStore();
  const {
    experiments,
    loading,
    filters,
    fetchExperiments,
    toggleFavorite,
    archiveExperiment,
    duplicateExperiment,
    setFilters,
  } = useExperimentStore();

  const wsId = currentWorkspace?.id;

  useEffect(() => {
    if (!wsId) return;
    // Fetch sorted by updated_at desc to approximate "recent"
    fetchExperiments(wsId, { ...filters, sort_by: 'updated_at', sort_order: 'desc' });
  }, [wsId, fetchExperiments]);

  const recentExperiments = experiments.filter((e) => !e.is_archived);
  const sortBy = filters.sort_by ?? 'updated_at';
  const sortOrder = filters.sort_order ?? 'desc';

  function handleSort(field: NonNullable<ExperimentFilters['sort_by']>) {
    if (sortBy === field) {
      setFilters({ sort_order: sortOrder === 'asc' ? 'desc' : 'asc' });
    } else {
      setFilters({ sort_by: field, sort_order: 'desc' });
    }
  }

  function handleRowClick(exp: Experiment) {
    navigate(`/app/experiments/${exp.id}`);
  }

  function handleRowAction(action: string, exp: Experiment) {
    switch (action) {
      case 'view':
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

  return (
    <div className="h-full flex flex-col">
      <div className="border-b px-6 py-3">
        <PageHeader
          title="Recent"
          description="Recently modified experiments"
        />
      </div>

      <div className="flex-1 overflow-auto">
        {loading && recentExperiments.length === 0 ? (
          <div className="py-16 text-center text-sm text-muted-foreground">Loading…</div>
        ) : recentExperiments.length === 0 ? (
          <EmptyState
            icon={Clock}
            title="No recent experiments"
            description="Experiments you view or edit will appear here."
          />
        ) : (
          <ExperimentTable
            experiments={recentExperiments}
            sortBy={sortBy}
            sortOrder={sortOrder}
            onSort={handleSort}
            onRowClick={handleRowClick}
            onRowAction={handleRowAction}
            onToggleFavorite={(id) => toggleFavorite(id)}
          />
        )}
      </div>
    </div>
  );
}
