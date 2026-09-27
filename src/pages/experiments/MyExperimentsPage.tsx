import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { FlaskRound, Plus } from 'lucide-react';
import { useExperimentStore } from '@/stores/experimentStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { useAuthStore } from '@/stores/authStore';
import ExperimentTable from '@/components/experiments/ExperimentTable';
import PageHeader from '@/components/eln/PageHeader';
import EmptyState from '@/components/eln/EmptyState';
import { Button } from '@/components/ui/button';

export default function MyExperimentsPage() {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const { currentWorkspace } = useWorkspaceStore();
  const { experiments, loading, fetchExperiments, toggleFavorite, archiveExperiment, duplicateExperiment } =
    useExperimentStore();

  useEffect(() => {
    if (currentWorkspace && user) {
      fetchExperiments(currentWorkspace.id, {
        status: null,
        notebook_id: null,
        tag_ids: [],
        search: '',
        created_by: user.id,
        date_from: null,
        date_to: null,
        sort_by: 'updated_at',
        sort_order: 'desc',
      });
    }
  }, [currentWorkspace, user, fetchExperiments]);

  const myExperiments = experiments.filter((e) => !e.is_archived);

  function handleRowClick(exp: { id: string }) {
    navigate(`/app/experiments/${exp.id}`);
  }

  function handleRowAction(action: string, exp: { id: string }) {
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
          title="My Experiments"
          description="Experiments you created"
        />
      </div>

      <div className="flex-1 overflow-auto">
        {loading && myExperiments.length === 0 ? (
          <div className="py-16 text-center text-sm text-muted-foreground">Loading…</div>
        ) : myExperiments.length === 0 ? (
          <EmptyState
            icon={FlaskRound}
            title="No experiments yet"
            description="Experiments you create will appear here."
            action={
              <Button size="sm" onClick={() => navigate('/app')}>
                <Plus size={15} />
                Create experiment
              </Button>
            }
          />
        ) : (
          <ExperimentTable
            experiments={myExperiments}
            onRowClick={handleRowClick}
            onRowAction={handleRowAction}
            onToggleFavorite={(id) => toggleFavorite(id)}
          />
        )}
      </div>
    </div>
  );
}
