import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BookOpen } from 'lucide-react';
import { useNotebookStore } from '@/stores/notebookStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import Button from '@/components/common/Button';
import Input from '@/components/common/Input';

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
    <div className="mx-auto max-w-lg p-6">
      <div className="flex items-center gap-3 mb-6">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50">
          <BookOpen size={20} className="text-blue-600" />
        </div>
        <h1 className="text-xl font-semibold text-gray-900">Create Notebook</h1>
      </div>

      {error && (
        <div className="mb-4 rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <Input
          label="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Cell Biology Q4 2026"
          required
          autoFocus
        />
        <Input
          label="Description (optional)"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What will this notebook be used for?"
        />
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={() => navigate(-1 as any)}>Cancel</Button>
          <Button type="submit" loading={loading} disabled={!name.trim()}>
            Create Notebook
          </Button>
        </div>
      </form>
    </div>
  );
}
