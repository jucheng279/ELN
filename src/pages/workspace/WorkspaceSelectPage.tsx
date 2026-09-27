import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Building2, Plus, Users, Loader2 } from 'lucide-react';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import EmptyState from '@/components/eln/EmptyState';
import { cn } from '@/lib/utils';

export default function WorkspaceSelectPage() {
  const navigate = useNavigate();
  const { workspaces, loading, fetchWorkspaces, createWorkspace, selectWorkspace } =
    useWorkspaceStore();

  const [showCreate, setShowCreate] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchWorkspaces();
  }, [fetchWorkspaces]);

  async function handleCreate() {
    if (!name.trim()) {
      setError('Workspace name is required');
      return;
    }
    setCreating(true);
    setError('');
    try {
      const ws = await createWorkspace(name.trim(), description.trim() || undefined);
      await selectWorkspace(ws.id);
      setShowCreate(false);
      navigate('/app');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create workspace');
    } finally {
      setCreating(false);
    }
  }

  async function handleSelect(id: string) {
    await selectWorkspace(id);
    navigate('/app');
  }

  function handleCloseCreate(open: boolean) {
    if (!open) {
      setShowCreate(false);
      setName('');
      setDescription('');
      setError('');
    }
  }

  return (
    <div className={cn('flex min-h-screen flex-col items-center bg-muted/40 px-4 pt-20')}>
      <div className={cn('w-full max-w-2xl')}>
        <div className={cn('mb-6 flex items-center justify-between')}>
          <div>
            <h1 className={cn('text-lg font-semibold text-foreground')}>Workspaces</h1>
            <p className={cn('mt-0.5 text-sm text-muted-foreground')}>
              Select a workspace or create a new one
            </p>
          </div>
          <Button size="sm" onClick={() => setShowCreate(true)}>
            <Plus className={cn('mr-1 h-3.5 w-3.5')} />
            Create workspace
          </Button>
        </div>

        {loading && workspaces.length === 0 ? (
          <div className={cn('flex items-center justify-center py-16')}>
            <Loader2 className={cn('h-5 w-5 animate-spin text-muted-foreground')} />
          </div>
        ) : workspaces.length === 0 ? (
          <div className={cn('rounded-lg border border-border bg-background')}>
            <EmptyState
              icon={Building2}
              title="No workspaces yet"
              description="Create your first workspace to start organizing experiments."
              action={
                <Button size="sm" onClick={() => setShowCreate(true)}>
                  <Plus className={cn('mr-1 h-3.5 w-3.5')} />
                  Create workspace
                </Button>
              }
            />
          </div>
        ) : (
          <div className={cn('space-y-1.5')}>
            {workspaces.map((ws) => (
              <button
                key={ws.id}
                onClick={() => handleSelect(ws.id)}
                className={cn(
                  'flex w-full items-center gap-3 rounded-lg border border-border bg-background px-3 py-2.5 text-left transition-colors hover:bg-muted/50'
                )}
              >
                <Avatar size="sm">
                  <AvatarFallback>{ws.name.charAt(0).toUpperCase()}</AvatarFallback>
                </Avatar>
                <div className={cn('min-w-0 flex-1')}>
                  <p className={cn('text-sm font-medium text-foreground')}>{ws.name}</p>
                  {ws.description && (
                    <p className={cn('truncate text-xs text-muted-foreground')}>
                      {ws.description}
                    </p>
                  )}
                </div>
                <div className={cn('flex items-center gap-1 text-xs text-muted-foreground')}>
                  <Users className={cn('h-3.5 w-3.5')} />
                  <span>Team</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Create Dialog */}
      <Dialog open={showCreate} onOpenChange={handleCloseCreate}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create workspace</DialogTitle>
            <DialogDescription>
              A workspace is a shared space for your team's experiments.
            </DialogDescription>
          </DialogHeader>
          <div className={cn('space-y-3')}>
            <div>
              <Label htmlFor="ws-name">Workspace name</Label>
              <Input
                id="ws-name"
                className={cn('mt-1 h-8')}
                placeholder="e.g. Synthetic Biology Lab"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                autoFocus
              />
              {error && (
                <p className={cn('mt-1 text-sm text-destructive')}>{error}</p>
              )}
            </div>
            <div>
              <Label htmlFor="ws-desc">Description</Label>
              <Textarea
                id="ws-desc"
                className={cn('mt-1 min-h-[72px] resize-none')}
                rows={3}
                placeholder="Optional description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => handleCloseCreate(false)}>
              Cancel
            </Button>
            <Button size="sm" disabled={creating} onClick={handleCreate}>
              {creating && <Loader2 className={cn('mr-1.5 h-3.5 w-3.5 animate-spin')} />}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
