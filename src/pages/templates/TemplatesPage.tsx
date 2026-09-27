import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Plus,
  FileText,
  X,
  FlaskConical,
  Microscope,
  TestTube,
  Beaker,
  Loader2,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import EmptyState from '@/components/eln/EmptyState';
import { cn } from '@/lib/utils';
import type { Template } from '@/lib/types';

type StatusFilter = '' | 'draft' | 'published' | 'archived';

const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: '', label: 'All statuses' },
  { value: 'draft', label: 'Draft' },
  { value: 'published', label: 'Published' },
  { value: 'archived', label: 'Archived' },
];

const statusConfig: Record<string, { className: string; label: string }> = {
  draft: { className: 'bg-muted text-muted-foreground border-transparent', label: 'Draft' },
  published: { className: 'bg-green-50 text-green-700 border-green-200', label: 'Published' },
  archived: { className: 'bg-muted text-muted-foreground/70 border-transparent', label: 'Archived' },
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
      <div className="flex items-center justify-between border-b border-border px-6 py-3">
        <h1 className="text-base font-semibold text-foreground">Templates</h1>
        <Button size="sm" className="h-8" onClick={() => setShowCreate(true)}>
          <Plus className="h-4 w-4 mr-1.5" />
          New Template
        </Button>
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border/50 px-6 py-2">
        <div className="w-56">
          <Input
            type="text"
            placeholder="Search templates…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="h-8"
          />
        </div>

        <Select
          value={statusFilter}
          onValueChange={(val) => setStatusFilter(val as StatusFilter)}
        >
          <SelectTrigger className="h-8 w-auto min-w-[140px]">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map((opt) => (
              <SelectItem key={opt.value || '__all'} value={opt.value || '__all'}>
                {opt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {hasActiveFilters && (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 text-xs text-muted-foreground"
            onClick={() => {
              setSearchInput('');
              setStatusFilter('');
            }}
          >
            <X className="h-3.5 w-3.5 mr-1" />
            Clear filters
          </Button>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {loading && templates.length === 0 ? (
          <div className="py-16 text-center text-sm text-muted-foreground">
            Loading templates…
          </div>
        ) : filtered.length === 0 && !hasActiveFilters ? (
          <div className="px-6 py-12">
            <EmptyState
              icon={FileText}
              title="No templates yet"
              description="Templates define the structure for your experiments. Create one from scratch or start with a suggestion below."
              action={
                <Button size="sm" className="h-8" onClick={() => setShowCreate(true)}>
                  <Plus className="h-4 w-4 mr-1.5" />
                  New Template
                </Button>
              }
            />
            <div className="mt-8 max-w-2xl mx-auto">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-3 text-center">
                Quick Start Suggestions
              </p>
              <div className="grid grid-cols-2 gap-3">
                {TEMPLATE_SUGGESTIONS.map((s) => {
                  const Icon = s.icon;
                  return (
                    <button
                      key={s.name}
                      onClick={() => handleCreateFromSuggestion(s)}
                      className="flex items-start gap-3 rounded-lg border border-border p-3 text-left hover:border-blue-300 hover:bg-blue-50/50 transition-colors"
                    >
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted">
                        <Icon className="h-4 w-4 text-muted-foreground" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-foreground">
                          {s.name}
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
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
              <tr className="border-b border-border/50">
                <th className="px-6 py-2.5 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Name
                </th>
                <th className="px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Category
                </th>
                <th className="px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Version
                </th>
                <th className="px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Status
                </th>
                <th className="px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Created
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((tpl) => {
                const st = statusConfig[tpl.status] ?? statusConfig.draft;
                return (
                  <tr
                    key={tpl.id}
                    onClick={() => navigate(`/app/templates/${tpl.id}`)}
                    className="border-b border-border/30 hover:bg-muted/50 cursor-pointer transition-colors"
                  >
                    <td className="px-6 py-3">
                      <div className="text-sm font-medium text-foreground">
                        {tpl.name}
                      </div>
                      {tpl.description && (
                        <div className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
                          {tpl.description}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-muted-foreground">
                      {tpl.category || '—'}
                    </td>
                    <td className="px-4 py-3 text-sm text-muted-foreground">
                      {tpl.current_version > 0 ? `v${tpl.current_version}` : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant="outline" className={cn('text-[11px] font-medium px-1.5 py-0', st.className)}>
                        {st.label}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-sm text-muted-foreground">
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
      <Dialog open={showCreate} onOpenChange={(open) => !open && setShowCreate(false)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New Template</DialogTitle>
            <DialogDescription>Create a reusable experiment template.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="tpl-name">
                Name <span className="text-destructive">*</span>
              </Label>
              <Input
                id="tpl-name"
                placeholder="e.g., Standard Experiment"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="h-8"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tpl-category">Category</Label>
              <Input
                id="tpl-category"
                placeholder="e.g., Biology, Chemistry"
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value)}
                className="h-8"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tpl-desc">Description</Label>
              <Textarea
                id="tpl-desc"
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                placeholder="Describe what this template is for…"
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              className="h-8"
              onClick={() => setShowCreate(false)}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              className="h-8"
              disabled={!newName.trim() || creating}
              onClick={handleCreate}
            >
              {creating && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
