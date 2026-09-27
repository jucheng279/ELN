import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Archive } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { useExperimentStore } from '@/stores/experimentStore';
import ExperimentTable from '@/components/experiments/ExperimentTable';
import PageHeader from '@/components/eln/PageHeader';
import EmptyState from '@/components/eln/EmptyState';
import type { Experiment } from '@/lib/types';

export default function ArchivedPage() {
  const navigate = useNavigate();
  const { currentWorkspace } = useWorkspaceStore();
  const { restoreExperiment } = useExperimentStore();
  const [archived, setArchived] = useState<Experiment[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!currentWorkspace) return;
    setLoading(true);
    supabase
      .from('experiments')
      .select(
        '*, notebook:notebooks(id, name), created_by_profile:profiles!experiments_created_by_fkey(id, display_name, avatar_url)'
      )
      .eq('workspace_id', currentWorkspace.id)
      .eq('is_archived', true)
      .order('updated_at', { ascending: false })
      .then(({ data, error }) => {
        if (!error && data) setArchived(data as Experiment[]);
        setLoading(false);
      });
  }, [currentWorkspace]);

  async function handleRestore(exp: Experiment) {
    try {
      await restoreExperiment(exp.id);
      setArchived((prev) => prev.filter((e) => e.id !== exp.id));
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to restore');
    }
  }

  function handleRowAction(action: string, exp: Experiment) {
    switch (action) {
      case 'restore':
        handleRestore(exp);
        break;
      case 'view':
        navigate(`/app/experiments/${exp.id}`);
        break;
      case 'edit':
        navigate(`/app/experiments/${exp.id}`);
        break;
    }
  }

  return (
    <div className="h-full flex flex-col">
      <div className="border-b px-6 py-3">
        <PageHeader
          title="Archive"
          description="Archived experiments can be restored at any time"
        />
      </div>

      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="py-16 text-center text-sm text-muted-foreground">Loading…</div>
        ) : archived.length === 0 ? (
          <EmptyState
            icon={Archive}
            title="No archived experiments"
            description="Experiments you archive will appear here."
          />
        ) : (
          <ExperimentTable
            experiments={archived}
            onRowClick={(exp) => navigate(`/app/experiments/${exp.id}`)}
            onRowAction={handleRowAction}
            showArchive
          />
        )}
      </div>
    </div>
  );
}
