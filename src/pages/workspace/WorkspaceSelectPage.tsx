import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Building2, Plus, Users } from 'lucide-react';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import Button from '@/components/common/Button';
import Input from '@/components/common/Input';
import Dialog from '@/components/common/Dialog';
import EmptyState from '@/components/common/EmptyState';

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
    } catch (err: any) {
      setError(err.message || 'Failed to create workspace');
    } finally {
      setCreating(false);
    }
  }

  async function handleSelect(id: string) {
    await selectWorkspace(id);
    navigate('/app');
  }

  return (
    <div className="flex min-h-screen flex-col items-center bg-[#f8f9fa] px-4 pt-20">
      <div className="w-full max-w-2xl">
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-gray-900">Workspaces</h1>
            <p className="mt-1 text-sm text-gray-500">
              Select a workspace or create a new one
            </p>
          </div>
          <Button
            icon={<Plus size={16} />}
            size="sm"
            onClick={() => setShowCreate(true)}
          >
            Create workspace
          </Button>
        </div>

        {loading && workspaces.length === 0 ? (
          <div className="py-16 text-center text-sm text-gray-400">Loading…</div>
        ) : workspaces.length === 0 ? (
          <div className="rounded-lg border border-gray-200 bg-white">
            <EmptyState
              icon={Building2}
              title="No workspaces yet"
              description="Create your first workspace to start organizing experiments."
              action={
                <Button
                  icon={<Plus size={16} />}
                  size="sm"
                  onClick={() => setShowCreate(true)}
                >
                  Create workspace
                </Button>
              }
            />
          </div>
        ) : (
          <div className="grid gap-3">
            {workspaces.map((ws) => (
              <button
                key={ws.id}
                onClick={() => handleSelect(ws.id)}
                className="flex items-center gap-4 rounded-lg border border-gray-200 bg-white px-5 py-4 text-left transition-all hover:border-gray-300 hover:shadow-sm"
              >
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-600">
                  <Building2 size={20} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-gray-900">{ws.name}</p>
                  {ws.description && (
                    <p className="mt-0.5 truncate text-xs text-gray-500">
                      {ws.description}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-1.5 text-xs text-gray-400">
                  <Users size={14} />
                  <span>Team</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Create Dialog */}
      <Dialog
        open={showCreate}
        onClose={() => {
          setShowCreate(false);
          setName('');
          setDescription('');
          setError('');
        }}
        title="Create workspace"
        description="A workspace is a shared space for your team's experiments."
        size="sm"
        footer={
          <>
            <Button variant="secondary" size="sm" onClick={() => setShowCreate(false)}>
              Cancel
            </Button>
            <Button size="sm" loading={creating} onClick={handleCreate}>
              Create
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Input
            label="Workspace name"
            placeholder="e.g. Synthetic Biology Lab"
            value={name}
            onChange={(e) => setName(e.target.value)}
            error={error}
            required
            autoFocus
          />
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Description
            </label>
            <textarea
              className="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 transition-colors focus:outline-none focus:ring-2 focus:ring-offset-0 focus:border-blue-500 focus:ring-blue-500/20 resize-none"
              rows={3}
              placeholder="Optional description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
        </div>
      </Dialog>
    </div>
  );
}
