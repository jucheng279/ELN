import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, ClipboardList, X, Loader2 } from 'lucide-react';
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
import type { Protocol } from '@/lib/types';

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
      <div className="flex items-center justify-between border-b border-border px-6 py-3">
        <h1 className="text-base font-semibold text-foreground">Protocols</h1>
        <Button size="sm" className="h-8" onClick={() => setShowCreate(true)}>
          <Plus className="h-4 w-4 mr-1.5" />
          New Protocol
        </Button>
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border/50 px-6 py-2">
        <div className="w-56">
          <Input
            type="text"
            placeholder="Search protocols…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="h-8"
          />
        </div>

        <Select
          value={statusFilter}
          onValueChange={(val: string | null) => { if (val !== null) setStatusFilter((val === '__all' ? '' : val) as StatusFilter); }}
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
        {loading && protocols.length === 0 ? (
          <div className="py-16 text-center text-sm text-muted-foreground">
            Loading protocols…
          </div>
        ) : filtered.length === 0 && !hasActiveFilters ? (
          <EmptyState
            icon={ClipboardList}
            title="No protocols yet"
            description="Protocols define step-by-step procedures for your experiments. Create your first protocol to get started."
            action={
              <Button size="sm" className="h-8" onClick={() => setShowCreate(true)}>
                <Plus className="h-4 w-4 mr-1.5" />
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
              {filtered.map((proto) => {
                const st = statusConfig[proto.status] ?? statusConfig.draft;
                return (
                  <tr
                    key={proto.id}
                    onClick={() => navigate(`/app/protocols/${proto.id}`)}
                    className="border-b border-border/30 hover:bg-muted/50 cursor-pointer transition-colors"
                  >
                    <td className="px-6 py-3">
                      <div className="text-sm font-medium text-foreground">
                        {proto.name}
                      </div>
                      {proto.description && (
                        <div className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
                          {proto.description}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-muted-foreground">
                      {proto.category || '—'}
                    </td>
                    <td className="px-4 py-3 text-sm text-muted-foreground">
                      {proto.current_version > 0
                        ? `v${proto.current_version}`
                        : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant="outline" className={cn('text-[11px] font-medium px-1.5 py-0', st.className)}>
                        {st.label}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-sm text-muted-foreground">
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
      <Dialog open={showCreate} onOpenChange={(open) => !open && setShowCreate(false)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New Protocol</DialogTitle>
            <DialogDescription>Create a reusable step-by-step protocol.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="proto-name">
                Name <span className="text-destructive">*</span>
              </Label>
              <Input
                id="proto-name"
                placeholder="e.g., Western Blot Protocol"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="h-8"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="proto-category">Category</Label>
              <Input
                id="proto-category"
                placeholder="e.g., Biochemistry, Cell Biology"
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value)}
                className="h-8"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="proto-desc">Description</Label>
              <Textarea
                id="proto-desc"
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                placeholder="Describe this protocol…"
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
