import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BookOpen, Loader2 } from 'lucide-react';
import { useNotebookStore } from '@/stores/notebookStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

export default function CreateNotebookPage() {
  const navigate = useNavigate();
  const { currentWorkspace } = useWorkspaceStore();
  const { createNotebook } = useNotebookStore();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!currentWorkspace || !name.trim()) return;

    setLoading(true);
    setError('');
    try {
      const nb = await createNotebook(currentWorkspace.id, name.trim(), description.trim() || undefined);
      navigate(`/app/notebooks/${nb.id}`);
    } catch (err: any) {
      setError(err.message ?? 'Failed to create notebook');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={cn('mx-auto max-w-lg p-6')}>
      <div className={cn('mb-6 flex items-center gap-3')}>
        <div className={cn('flex h-10 w-10 items-center justify-center rounded-lg bg-muted')}>
          <BookOpen className={cn('h-5 w-5 text-muted-foreground')} />
        </div>
        <h1 className={cn('text-lg font-semibold text-foreground')}>Create Notebook</h1>
      </div>

      {error && (
        <div className={cn('mb-4 rounded-lg bg-destructive/10 p-3 text-sm text-destructive')}>{error}</div>
      )}

      <form onSubmit={handleSubmit} className={cn('space-y-4')}>
        <div>
          <Label htmlFor="nb-name">Name</Label>
          <Input
            id="nb-name"
            className={cn('mt-1 h-8')}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Cell Biology Q4 2026"
            required
            autoFocus
          />
        </div>
        <div>
          <Label htmlFor="nb-desc">Description (optional)</Label>
          <Input
            id="nb-desc"
            className={cn('mt-1 h-8')}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What will this notebook be used for?"
          />
        </div>
        <div className={cn('flex justify-end gap-2 pt-2')}>
          <Button variant="ghost" size="sm" onClick={() => navigate(-1 as any)} type="button">
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={!name.trim() || loading}>
            {loading && <Loader2 className={cn('mr-1.5 h-3.5 w-3.5 animate-spin')} />}
            Create Notebook
          </Button>
        </div>
      </form>
    </div>
  );
}
