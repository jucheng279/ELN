import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Star } from 'lucide-react';
import { useExperimentStore } from '@/stores/experimentStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import ExperimentTable from '@/components/experiments/ExperimentTable';
import PageHeader from '@/components/eln/PageHeader';
import EmptyState from '@/components/eln/EmptyState';
import type { Experiment, ExperimentFilters } from '@/lib/types';

export default function FavoritesPage() {
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

  const sortBy = filters.sort_by ?? 'updated_at';
  const sortOrder = filters.sort_order ?? 'desc';
  const wsId = currentWorkspace?.id;

  useEffect(() => {
    if (!wsId) return;
    fetchExperiments(wsId, filters);
  }, [wsId, filters, fetchExperiments]);

  const favorited = experiments.filter((e) => e.is_favorited && !e.is_archived);

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
          title="Favorites"
          description="Experiments you've starred for quick access"
        />
      </div>

      <div className="flex-1 overflow-auto">
        {loading && favorited.length === 0 ? (
          <div className="py-16 text-center text-sm text-muted-foreground">Loading…</div>
        ) : favorited.length === 0 ? (
          <EmptyState
            icon={Star}
            title="No favorites"
            description="Star experiments to add them here."
          />
        ) : (
          <ExperimentTable
            experiments={favorited}
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
