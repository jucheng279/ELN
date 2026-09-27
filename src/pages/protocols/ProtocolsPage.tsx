import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, ClipboardList, Search, X } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import Button from '@/components/common/Button';
import Input from '@/components/common/Input';
import Dialog from '@/components/common/Dialog';
import EmptyState from '@/components/common/EmptyState';
import type { Protocol } from '@/lib/types';

type StatusFilter = '' | 'draft' | 'published' | 'archived';

const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: '', label: 'All statuses' },
  { value: 'draft', label: 'Draft' },
  { value: 'published', label: 'Published' },
  { value: 'archived', label: 'Archived' },
];

const statusStyle: Record<string, { bg: string; text: string; label: string }> = {
  draft: { bg: 'bg-gray-100', text: 'text-gray-600', label: 'Draft' },
  published: { bg: 'bg-green-50', text: 'text-green-700', label: 'Published' },
  archived: { bg: 'bg-gray-100', text: 'text-gray-500', label: 'Archived' },
};

export default function ProtocolsPage() {
  const navigate = useNavigate();
  const { currentWorkspace } = useWorkspaceStore();

  const [protocols, setProtocols] = useState<Protocol[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('');
  const [searchInput, setSearchInput] = useState('');

  // Create dialog
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newCategory, setNewCategory] = useState('');
  const [creating, setCreating] = useState(false);

  const wsId = currentWorkspace?.id;

  useEffect(() => {
    if (!wsId) return;
    fetchProtocols();
  }, [wsId, statusFilter]);

  async function fetchProtocols() {
    if (!wsId) return;
    setLoading(true);
    let query = supabase
      .from('protocols')
      .select('*')
      .eq('workspace_id', wsId)
      .order('created_at', { ascending: false });

    if (statusFilter) {
      query = query.eq('status', statusFilter);
    }

    const { data, error } = await query;
    if (error) {
      console.error('Failed to fetch protocols:', error);
    } else {
      setProtocols(data ?? []);
    }
    setLoading(false);
  }

  async function handleCreate() {
    if (!wsId || !newName.trim()) return;
    setCreating(true);
    try {
      const { data: user } = await supabase.auth.getUser();
      const { data, error } = await supabase
        .from('protocols')
        .insert({
          workspace_id: wsId,
          name: newName.trim(),
          description: newDescription.trim() || null,
          category: newCategory.trim() || null,
          current_version: 0,
          status: 'draft',
          created_by: user.user!.id,
        })
        .select()
        .single();

      if (error) throw error;
      setShowCreate(false);
      setNewName('');
      setNewDescription('');
      setNewCategory('');
      navigate(`/app/protocols/${data.id}`);
    } catch (err) {
      console.error('Failed to create protocol:', err);
    } finally {
      setCreating(false);
    }
  }

  const filtered = protocols.filter((p) => {
    if (!searchInput) return true;
    const q = searchInput.toLowerCase();
    return (
      p.name.toLowerCase().includes(q) ||
      (p.description?.toLowerCase().includes(q) ?? false) ||
      (p.category?.toLowerCase().includes(q) ?? false)
    );
  });

  const hasActiveFilters = !!(searchInput || statusFilter);

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-200 px-6 py-3">
        <h1 className="text-base font-semibold text-gray-900">Protocols</h1>
        <Button
          icon={<Plus size={16} />}
          size="sm"
          onClick={() => setShowCreate(true)}
        >
          New Protocol
        </Button>
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-gray-100 px-6 py-2">
        <div className="w-56">
          <input
            type="text"
            placeholder="Search protocols…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="block w-full rounded-md border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500/30"
          />
        </div>

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
          className="rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-sm text-gray-700 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500/30"
        >
          {STATUS_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>

        {hasActiveFilters && (
          <button
            onClick={() => {
              setSearchInput('');
              setStatusFilter('');
            }}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium text-gray-500 hover:bg-gray-100 hover:text-gray-700"
          >
            <X size={13} />
            Clear filters
          </button>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {loading && protocols.length === 0 ? (
          <div className="py-16 text-center text-sm text-gray-400">
            Loading protocols…
          </div>
        ) : filtered.length === 0 && !hasActiveFilters ? (
          <EmptyState
            icon={ClipboardList}
            title="No protocols yet"
            description="Protocols define step-by-step procedures for your experiments. Create your first protocol to get started."
            action={
              <Button
                icon={<Plus size={16} />}
                size="sm"
                onClick={() => setShowCreate(true)}
              >
                New Protocol
              </Button>
            }
          />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={ClipboardList}
            title="No protocols found"
            description="Try adjusting your search or filters."
          />
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="px-6 py-2.5 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                  Name
                </th>
                <th className="px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                  Category
                </th>
                <th className="px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                  Version
                </th>
                <th className="px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                  Status
                </th>
                <th className="px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                  Created
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((proto) => {
                const st = statusStyle[proto.status] ?? statusStyle.draft;
                return (
                  <tr
                    key={proto.id}
                    onClick={() => navigate(`/app/protocols/${proto.id}`)}
                    className="border-b border-gray-50 hover:bg-gray-50 cursor-pointer transition-colors"
                  >
                    <td className="px-6 py-3">
                      <div className="text-sm font-medium text-gray-900">
                        {proto.name}
                      </div>
                      {proto.description && (
                        <div className="text-xs text-gray-500 mt-0.5 line-clamp-1">
                          {proto.description}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">
                      {proto.category || '—'}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">
                      {proto.current_version > 0
                        ? `v${proto.current_version}`
                        : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${st.bg} ${st.text}`}
                      >
                        {st.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-500">
                      {new Date(proto.created_at).toLocaleDateString()}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Create Dialog */}
      <Dialog
        open={showCreate}
        onClose={() => setShowCreate(false)}
        title="New Protocol"
        description="Create a reusable step-by-step protocol."
        size="sm"
        footer={
          <>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setShowCreate(false)}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              loading={creating}
              disabled={!newName.trim()}
              onClick={handleCreate}
            >
              Create
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Input
            label="Name"
            required
            placeholder="e.g., Western Blot Protocol"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
          <Input
            label="Category"
            placeholder="e.g., Biochemistry, Cell Biology"
            value={newCategory}
            onChange={(e) => setNewCategory(e.target.value)}
          />
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              Description
            </label>
            <textarea
              value={newDescription}
              onChange={(e) => setNewDescription(e.target.value)}
              placeholder="Describe this protocol…"
              rows={3}
              className="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            />
          </div>
        </div>
      </Dialog>
    </div>
  );
}
