import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { FlaskRound, Plus } from 'lucide-react';
import { useExperimentStore } from '@/stores/experimentStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { useAuthStore } from '@/stores/authStore';
import ExperimentTable from '@/components/experiments/ExperimentTable';
import EmptyState from '@/components/common/EmptyState';
import Button from '@/components/common/Button';

export default function MyExperimentsPage() {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const { currentWorkspace } = useWorkspaceStore();
  const { experiments, loading, fetchExperiments } = useExperimentStore();

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

  return (
    <div className="p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">My Experiments</h1>
          <p className="mt-1 text-sm text-gray-500">Experiments you created</p>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-gray-300 border-t-blue-600" />
        </div>
      ) : experiments.length === 0 ? (
        <EmptyState
          icon={FlaskRound}
          title="No experiments yet"
          description="Experiments you create will appear here."
          action={
            <Button onClick={() => navigate('/app')}>
              <Plus size={16} className="mr-1.5" />
              Create experiment
            </Button>
          }
        />
      ) : (
        <ExperimentTable
          experiments={experiments}
          onRowClick={(exp) => navigate(`/app/experiments/${exp.id}`)}
        />
      )}
    </div>
  );
}
