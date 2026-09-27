import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Plus,
  FileText,
  Search,
  X,
  FlaskConical,
  Microscope,
  TestTube,
  Beaker,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import Button from '@/components/common/Button';
import Input from '@/components/common/Input';
import Dialog from '@/components/common/Dialog';
import EmptyState from '@/components/common/EmptyState';
import type { Template } from '@/lib/types';

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

const TEMPLATE_SUGGESTIONS = [
  {
    name: 'Standard Experiment',
    description: 'Basic experiment template with objective, methods, results, and conclusion sections',
    category: 'General',
    icon: FlaskConical,
  },
  {
    name: 'Cell Culture Protocol',
    description: 'Template for cell culture experiments with passage tracking and media conditions',
    category: 'Biology',
    icon: Microscope,
  },
  {
    name: 'Chemical Synthesis',
    description: 'Synthesis procedure template with reagent tables, reaction conditions, and yield calculations',
    category: 'Chemistry',
    icon: TestTube,
  },
  {
    name: 'Assay Development',
    description: 'Template for developing and validating new assays with controls and acceptance criteria',
    category: 'Analytical',
    icon: Beaker,
  },
];

export default function TemplatesPage() {
  const navigate = useNavigate();
  const { currentWorkspace } = useWorkspaceStore();

  const [templates, setTemplates] = useState<Template[]>([]);
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
    fetchTemplates();
  }, [wsId, statusFilter]);

  async function fetchTemplates() {
    if (!wsId) return;
    setLoading(true);
    let query = supabase
      .from('templates')
      .select('*')
      .eq('workspace_id', wsId)
      .order('created_at', { ascending: false });

    if (statusFilter) {
      query = query.eq('status', statusFilter);
    }

    const { data, error } = await query;
    if (error) {
      console.error('Failed to fetch templates:', error);
    } else {
      setTemplates(data ?? []);
    }
    setLoading(false);
  }

  async function handleCreate() {
    if (!wsId || !newName.trim()) return;
    setCreating(true);
    try {
      const { data: user } = await supabase.auth.getUser();
      const { data, error } = await supabase
        .from('templates')
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
      navigate(`/app/templates/${data.id}`);
    } catch (err) {
      console.error('Failed to create template:', err);
    } finally {
      setCreating(false);
    }
  }

  async function handleCreateFromSuggestion(suggestion: (typeof TEMPLATE_SUGGESTIONS)[number]) {
    if (!wsId) return;
    setNewName(suggestion.name);
    setNewDescription(suggestion.description);
    setNewCategory(suggestion.category);
    setShowCreate(true);
  }

  const filtered = templates.filter((t) => {
    if (!searchInput) return true;
    const q = searchInput.toLowerCase();
    return (
      t.name.toLowerCase().includes(q) ||
      (t.description?.toLowerCase().includes(q) ?? false) ||
      (t.category?.toLowerCase().includes(q) ?? false)
    );
  });

  const hasActiveFilters = !!(searchInput || statusFilter);

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-200 px-6 py-3">
        <h1 className="text-base font-semibold text-gray-900">Templates</h1>
        <Button
          icon={<Plus size={16} />}
          size="sm"
          onClick={() => setShowCreate(true)}
        >
          New Template
        </Button>
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-gray-100 px-6 py-2">
        <div className="w-56">
          <input
            type="text"
            placeholder="Search templates…"
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
        {loading && templates.length === 0 ? (
          <div className="py-16 text-center text-sm text-gray-400">
            Loading templates…
          </div>
        ) : filtered.length === 0 && !hasActiveFilters ? (
          <div className="px-6 py-12">
            <EmptyState
              icon={FileText}
              title="No templates yet"
              description="Templates define the structure for your experiments. Create one from scratch or start with a suggestion below."
              action={
                <Button
                  icon={<Plus size={16} />}
                  size="sm"
                  onClick={() => setShowCreate(true)}
                >
                  New Template
                </Button>
              }
            />
            <div className="mt-8 max-w-2xl mx-auto">
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-3 text-center">
                Quick Start Suggestions
              </p>
              <div className="grid grid-cols-2 gap-3">
                {TEMPLATE_SUGGESTIONS.map((s) => {
                  const Icon = s.icon;
                  return (
                    <button
                      key={s.name}
                      onClick={() => handleCreateFromSuggestion(s)}
                      className="flex items-start gap-3 rounded-lg border border-gray-200 p-3 text-left hover:border-blue-300 hover:bg-blue-50/50 transition-colors"
                    >
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-gray-100">
                        <Icon size={16} className="text-gray-500" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-900">
                          {s.name}
                        </p>
                        <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">
                          {s.description}
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={FileText}
            title="No templates found"
            description="Try adjusting your filters."
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
              {filtered.map((tpl) => {
                const st = statusStyle[tpl.status] ?? statusStyle.draft;
                return (
                  <tr
                    key={tpl.id}
                    onClick={() => navigate(`/app/templates/${tpl.id}`)}
                    className="border-b border-gray-50 hover:bg-gray-50 cursor-pointer transition-colors"
                  >
                    <td className="px-6 py-3">
                      <div className="text-sm font-medium text-gray-900">
                        {tpl.name}
                      </div>
                      {tpl.description && (
                        <div className="text-xs text-gray-500 mt-0.5 line-clamp-1">
                          {tpl.description}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">
                      {tpl.category || '—'}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">
                      {tpl.current_version > 0 ? `v${tpl.current_version}` : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${st.bg} ${st.text}`}
                      >
                        {st.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-500">
                      {new Date(tpl.created_at).toLocaleDateString()}
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
        title="New Template"
        description="Create a reusable experiment template."
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
            placeholder="e.g., Standard Experiment"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
          />
          <Input
            label="Category"
            placeholder="e.g., Biology, Chemistry"
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
              placeholder="Describe what this template is for…"
              rows={3}
              className="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            />
          </div>
        </div>
      </Dialog>
    </div>
  );
}
