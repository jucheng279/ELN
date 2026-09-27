import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { BookOpen, Plus, FlaskRound, Pencil, Archive } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useExperimentStore } from '@/stores/experimentStore';
import { useNotebookStore } from '@/stores/notebookStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import type { Notebook } from '@/lib/types';
import ExperimentTable from '@/components/experiments/ExperimentTable';
import EmptyState from '@/components/common/EmptyState';
import Button from '@/components/common/Button';
import Dialog from '@/components/common/Dialog';
import Input from '@/components/common/Input';

export default function NotebookPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { currentWorkspace } = useWorkspaceStore();
  const { notebooks, updateNotebook, archiveNotebook } = useNotebookStore();
  const { experiments, loading, fetchExperiments, createExperiment } = useExperimentStore();

  const [notebook, setNotebook] = useState<Notebook | null>(null);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [createLoading, setCreateLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const nb = notebooks.find((n) => n.id === id);
    if (nb) {
      setNotebook(nb);
      setEditName(nb.name);
      setEditDesc(nb.description ?? '');
    } else if (id) {
      supabase
        .from('notebooks')
        .select('*')
        .eq('id', id)
        .maybeSingle()
        .then(({ data }) => {
          if (data) {
            setNotebook(data as Notebook);
            setEditName(data.name);
            setEditDesc(data.description ?? '');
          }
        });
    }
  }, [id, notebooks]);

  useEffect(() => {
    if (currentWorkspace && id) {
      fetchExperiments(currentWorkspace.id, {
        status: null,
        notebook_id: id,
        tag_ids: [],
        search: '',
        created_by: null,
        date_from: null,
        date_to: null,
        sort_by: 'updated_at',
        sort_order: 'desc',
      });
    }
  }, [currentWorkspace, id, fetchExperiments]);

  const handleSave = useCallback(async () => {
    if (!id || !editName.trim()) return;
    try {
      await updateNotebook(id, { name: editName.trim(), description: editDesc.trim() || undefined });
      setEditing(false);
    } catch (err: any) {
      setError(err.message ?? 'Failed to update notebook');
    }
  }, [id, editName, editDesc, updateNotebook]);

  const handleArchive = useCallback(async () => {
    if (!id) return;
    if (!window.confirm('Archive this notebook? Its experiments will still exist.')) return;
    try {
      await archiveNotebook(id);
      navigate('/app');
    } catch (err: any) {
      setError(err.message ?? 'Failed to archive notebook');
    }
  }, [id, archiveNotebook, navigate]);

  const handleCreate = useCallback(async () => {
    if (!currentWorkspace || !id) return;
    setCreateLoading(true);
    try {
      const exp = await createExperiment(currentWorkspace.id, id, newTitle || undefined);
      navigate(`/app/experiments/${exp.id}`);
    } catch (err: any) {
      setError(err.message ?? 'Failed to create experiment');
    } finally {
      setCreateLoading(false);
    }
  }, [currentWorkspace, id, newTitle, createExperiment, navigate]);

  if (!notebook) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-gray-300 border-t-blue-600" />
      </div>
    );
  }

  return (
    <div className="p-6">
      {/* Header */}
      <div className="mb-6 flex items-start justify-between">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50">
            <BookOpen size={20} className="text-blue-600" />
          </div>
          <div>
            {editing ? (
              <div className="space-y-2">
                <Input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  placeholder="Notebook name"
                />
                <Input
                  value={editDesc}
                  onChange={(e) => setEditDesc(e.target.value)}
                  placeholder="Description (optional)"
                />
                <div className="flex gap-2">
                  <Button size="sm" onClick={handleSave}>Save</Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
                </div>
              </div>
            ) : (
              <>
                <h1 className="text-xl font-semibold text-gray-900">{notebook.name}</h1>
                {notebook.description && (
                  <p className="mt-1 text-sm text-gray-500">{notebook.description}</p>
                )}
              </>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {!editing && (
            <>
              <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
                <Pencil size={14} className="mr-1" /> Edit
              </Button>
              <Button size="sm" variant="ghost" onClick={handleArchive}>
                <Archive size={14} className="mr-1" /> Archive
              </Button>
              <Button size="sm" onClick={() => setShowCreate(true)}>
                <Plus size={14} className="mr-1" /> New Experiment
              </Button>
            </>
          )}
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</div>
      )}

      {/* Experiment list */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-gray-300 border-t-blue-600" />
        </div>
      ) : experiments.length === 0 ? (
        <EmptyState
          icon={FlaskRound}
          title="No experiments in this notebook"
          description="Create your first experiment to get started."
          action={
            <Button onClick={() => setShowCreate(true)}>
              <Plus size={16} className="mr-1.5" /> Create experiment
            </Button>
          }
        />
      ) : (
        <ExperimentTable
          experiments={experiments}
          onRowClick={(exp) => navigate(`/app/experiments/${exp.id}`)}
        />
      )}

      {/* Create dialog */}
      <Dialog open={showCreate} onClose={() => setShowCreate(false)} title="New Experiment">
        <div className="space-y-4">
          <Input
            label="Title"
            placeholder="Untitled Experiment"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button onClick={handleCreate} loading={createLoading}>Create</Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
