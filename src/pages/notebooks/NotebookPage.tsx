import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { BookOpen, Plus, FlaskRound, Pencil, Archive, Loader2 } from 'lucide-react';

import { supabase } from '@/lib/supabase';
import { useExperimentStore } from '@/stores/experimentStore';
import { useNotebookStore } from '@/stores/notebookStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import type { Notebook } from '@/lib/types';
import ExperimentTable from '@/components/experiments/ExperimentTable';
import EmptyState from '@/components/eln/EmptyState';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from '@/components/ui/alert-dialog';
import { cn } from '@/lib/utils';

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
  const [showArchiveConfirm, setShowArchiveConfirm] = useState(false);

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
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to update notebook');
    }
  }, [id, editName, editDesc, updateNotebook]);

  const handleArchive = useCallback(async () => {
    if (!id) return;
    try {
      await archiveNotebook(id);
      navigate('/app');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to archive notebook');
    }
  }, [id, archiveNotebook, navigate]);

  const handleCreate = useCallback(async () => {
    if (!currentWorkspace || !id) return;
    setCreateLoading(true);
    try {
      const exp = await createExperiment(currentWorkspace.id, id, newTitle || undefined);
      navigate(`/app/experiments/${exp.id}`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create experiment');
    } finally {
      setCreateLoading(false);
    }
  }, [currentWorkspace, id, newTitle, createExperiment, navigate]);

  if (!notebook) {
    return (
      <div className={cn('flex items-center justify-center py-16')}>
        <Loader2 className={cn('h-5 w-5 animate-spin text-muted-foreground')} />
      </div>
    );
  }

  return (
    <div className={cn('p-6')}>
      {/* Header */}
      <div className={cn('mb-6 flex items-start justify-between')}>
        <div className={cn('flex items-start gap-3')}>
          <div className={cn('flex h-10 w-10 items-center justify-center rounded-lg bg-muted')}>
            <BookOpen className={cn('h-5 w-5 text-muted-foreground')} />
          </div>
          <div>
            {editing ? (
              <div className={cn('space-y-2')}>
                <div>
                  <Label htmlFor="edit-name">Name</Label>
                  <Input
                    id="edit-name"
                    className={cn('mt-1 h-8')}
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    placeholder="Notebook name"
                  />
                </div>
                <div>
                  <Label htmlFor="edit-desc">Description</Label>
                  <Input
                    id="edit-desc"
                    className={cn('mt-1 h-8')}
                    value={editDesc}
                    onChange={(e) => setEditDesc(e.target.value)}
                    placeholder="Description (optional)"
                  />
                </div>
                <div className={cn('flex gap-2')}>
                  <Button size="sm" onClick={handleSave}>Save</Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
                </div>
              </div>
            ) : (
              <>
                <h1 className={cn('text-lg font-semibold text-foreground')}>{notebook.name}</h1>
                {notebook.description && (
                  <p className={cn('mt-0.5 text-sm text-muted-foreground')}>{notebook.description}</p>
                )}
              </>
            )}
          </div>
        </div>

        <div className={cn('flex items-center gap-2')}>
          {!editing && (
            <>
              <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
                <Pencil className={cn('mr-1 h-3.5 w-3.5')} /> Edit
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setShowArchiveConfirm(true)}>
                <Archive className={cn('mr-1 h-3.5 w-3.5')} /> Archive
              </Button>
              <Button size="sm" onClick={() => setShowCreate(true)}>
                <Plus className={cn('mr-1 h-3.5 w-3.5')} /> New Experiment
              </Button>
            </>
          )}
        </div>
      </div>

      {error && (
        <div className={cn('mb-4 rounded-lg bg-destructive/10 p-3 text-sm text-destructive')}>{error}</div>
      )}

      {/* Experiment list */}
      {loading ? (
        <div className={cn('flex items-center justify-center py-16')}>
          <Loader2 className={cn('h-5 w-5 animate-spin text-muted-foreground')} />
        </div>
      ) : experiments.length === 0 ? (
        <EmptyState
          icon={FlaskRound}
          title="No experiments in this notebook"
          description="Create your first experiment to get started."
          action={
            <Button size="sm" onClick={() => setShowCreate(true)}>
              <Plus className={cn('mr-1.5 h-4 w-4')} /> Create experiment
            </Button>
          }
        />
      ) : (
        <ExperimentTable
          experiments={experiments}
          onRowClick={(exp) => navigate(`/app/experiments/${exp.id}`)}
        />
      )}

      {/* Create experiment dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New Experiment</DialogTitle>
          </DialogHeader>
          <div className={cn('space-y-3')}>
            <div>
              <Label htmlFor="new-exp-title">Title</Label>
              <Input
                id="new-exp-title"
                className={cn('mt-1 h-8')}
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
            <Button size="sm" disabled={createLoading} onClick={handleCreate}>
              {createLoading && <Loader2 className={cn('mr-1.5 h-3.5 w-3.5 animate-spin')} />}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Archive confirmation */}
      <AlertDialog open={showArchiveConfirm} onOpenChange={setShowArchiveConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive notebook</AlertDialogTitle>
            <AlertDialogDescription>
              Archive this notebook? Its experiments will still exist.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                setShowArchiveConfirm(false);
                handleArchive();
              }}
            >
              Archive
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
