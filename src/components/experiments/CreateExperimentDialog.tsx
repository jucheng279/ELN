import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import {
  FileText, LayoutTemplate, ChevronRight, Loader2, Blocks, RefreshCw,
} from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { useUIStore } from '@/stores/uiStore';
import { useExperimentStore } from '@/stores/experimentStore';
import { useNotebookStore } from '@/stores/notebookStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { supabase } from '@/lib/supabase';
import type { Template, TemplateVersion, TemplateBlock, BlockType, Folder } from '@/lib/types';

const blockTypeLabels: Record<BlockType, string> = {
  paragraph: 'Text', heading: 'Heading', list: 'List', checklist: 'Checklist',
  callout: 'Callout', divider: 'Divider', parameters: 'Parameters', table: 'Table',
  image: 'Image', attachment: 'Attachment', code: 'Code', protocol: 'Protocol',
  result: 'Result', reference: 'Reference', related_experiment: 'Related',
};

interface TemplateOption {
  template: Template;
  version: TemplateVersion;
}

export default function CreateExperimentDialog() {
  const navigate = useNavigate();
  const { createExperimentOpen: open, createExperimentDefaults: defaults, closeCreateExperiment: onClose } = useUIStore();
  const { createExperiment } = useExperimentStore();
  const { notebooks } = useNotebookStore();
  const { currentWorkspace } = useWorkspaceStore();

  const [title, setTitle] = useState('');
  const [notebookId, setNotebookId] = useState('');
  const [folderId, setFolderId] = useState('');
  const [folders, setFolders] = useState<Folder[]>([]);
  const [mode, setMode] = useState<'blank' | 'template'>('blank');
  const [templates, setTemplates] = useState<TemplateOption[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<TemplateOption | null>(null);
  const [loading, setLoading] = useState(false);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [templatesError, setTemplatesError] = useState<string | null>(null);

  // Reset state when dialog opens
  useEffect(() => {
    if (open) {
      setTitle('');
      setFolderId('');
      setMode('blank');
      setSelectedTemplate(null);
      setTemplatesError(null);
      setNotebookId(defaults.notebookId || '');
    }
  }, [open, defaults]);

  // Fetch folders when notebook changes
  useEffect(() => {
    if (!notebookId) {
      setFolders([]);
      setFolderId('');
      return;
    }
    (async () => {
      const { data } = await supabase
        .from('folders')
        .select('*')
        .eq('notebook_id', notebookId)
        .order('order_key');
      const newFolders = (data ?? []) as Folder[];
      setFolders(newFolders);
      // Clear folderId if the currently selected folder doesn't belong to the new notebook
      setFolderId((prev) => {
        if (!prev) return '';
        const stillValid = newFolders.some((f) => f.id === prev);
        return stillValid ? prev : '';
      });
    })();
  }, [notebookId]);

  // Fetch published templates when workspace is set
  const fetchTemplates = useCallback(async () => {
    if (!currentWorkspace) return;
    setTemplatesLoading(true);
    setTemplatesError(null);
    try {
      const { data: tvs } = await supabase
        .from('template_versions')
        .select('*, template:templates(*)')
        .eq('status', 'published')
        .eq('template:templates.workspace_id', currentWorkspace.id)
        .order('published_at', { ascending: false });
      
      if (tvs) {
        // Group by template, keep latest published version
        const seen = new Map<string, TemplateOption>();
        for (const tv of tvs as Array<{ template_id: string; template: unknown; id: string; version_number: number; content: unknown; metadata: unknown; status: string; published_at: string; created_by: string; created_at: string }>) {
          if (tv.template && !seen.has(tv.template_id)) {
            seen.set(tv.template_id, {
              template: tv.template as Template,
              version: {
                id: tv.id,
                template_id: tv.template_id,
                version_number: tv.version_number,
                content: tv.content,
                metadata: tv.metadata,
                status: tv.status,
                published_at: tv.published_at,
                created_by: tv.created_by,
                created_at: tv.created_at,
              } as TemplateVersion,
            });
          }
        }
        setTemplates(Array.from(seen.values()));
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load templates';
      setTemplatesError(message);
    } finally {
      setTemplatesLoading(false);
    }
  }, [currentWorkspace]);

  useEffect(() => {
    if (!open || !currentWorkspace) return;
    fetchTemplates();
  }, [open, currentWorkspace, fetchTemplates]);

  const handleCreate = useCallback(async () => {
    if (!notebookId) {
      toast.error('Please select a notebook');
      return;
    }
    if (!currentWorkspace) return;

    setLoading(true);
    try {
      const experiment = await createExperiment(
        currentWorkspace.id,
        notebookId,
        title || 'Untitled Experiment',
        folderId || undefined,
        mode === 'template' && selectedTemplate ? selectedTemplate.version.id : undefined
      );
      onClose();
      navigate(`/app/experiments/${experiment.id}`);
      toast.success('Experiment created');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to create experiment';
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }, [notebookId, currentWorkspace, title, folderId, mode, selectedTemplate, createExperiment, navigate, onClose]);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-[600px] max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Create new experiment</DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-5 py-2">
          {/* Title */}
          <div className="space-y-1.5">
            <Label htmlFor="exp-title">Title</Label>
            <Input
              id="exp-title"
              placeholder="Untitled Experiment"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              autoFocus
            />
          </div>

          {/* Notebook + Folder row */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Notebook <span className="text-destructive">*</span></Label>
              <Select value={notebookId} onValueChange={(v) => setNotebookId(v ?? '')}>
                <SelectTrigger>
                  <SelectValue placeholder="Select notebook" />
                </SelectTrigger>
                <SelectContent>
                  {notebooks.map((nb) => (
                    <SelectItem key={nb.id} value={nb.id}>{nb.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Folder</Label>
              <Select
                value={folderId || '__none__'}
                onValueChange={(v) => setFolderId(!v || v === '__none__' ? '' : v)}
                disabled={folders.length === 0}
              >
                <SelectTrigger>
                  <SelectValue placeholder={folders.length === 0 ? 'No folders' : 'Select folder'} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem key="__none__" value="__none__">No folder</SelectItem>
                  {folders.map((f) => (
                    <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Starting point toggle */}
          <div className="space-y-2">
            <Label>Starting point</Label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => { setMode('blank'); setSelectedTemplate(null); }}
                className={`flex items-center gap-3 rounded-lg border p-3 text-left transition-colors ${
                  mode === 'blank'
                    ? 'border-foreground/30 bg-muted/50 ring-1 ring-foreground/10'
                    : 'border-border hover:border-foreground/20 hover:bg-muted/30'
                }`}
              >
                <FileText className="h-5 w-5 text-muted-foreground shrink-0" />
                <div>
                  <p className="text-sm font-medium">Blank experiment</p>
                  <p className="text-xs text-muted-foreground">Start with an empty editor</p>
                </div>
              </button>
              <button
                type="button"
                onClick={() => setMode('template')}
                className={`flex items-center gap-3 rounded-lg border p-3 text-left transition-colors ${
                  mode === 'template'
                    ? 'border-foreground/30 bg-muted/50 ring-1 ring-foreground/10'
                    : 'border-border hover:border-foreground/20 hover:bg-muted/30'
                }`}
              >
                <LayoutTemplate className="h-5 w-5 text-muted-foreground shrink-0" />
                <div>
                  <p className="text-sm font-medium">From template</p>
                  <p className="text-xs text-muted-foreground">Use a published template</p>
                </div>
              </button>
            </div>
          </div>

          {/* Template selection */}
          {mode === 'template' && (
            <div className="space-y-2">
              {templatesLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : templatesError ? (
                <div className="rounded-lg border border-dashed border-destructive/50 px-4 py-8 text-center">
                  <LayoutTemplate className="mx-auto h-8 w-8 text-destructive/50 mb-2" />
                  <p className="text-sm text-destructive mb-3">Failed to load templates</p>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={fetchTemplates}
                  >
                    <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                    Retry
                  </Button>
                </div>
              ) : templates.length === 0 ? (
                <div className="rounded-lg border border-dashed px-4 py-8 text-center">
                  <LayoutTemplate className="mx-auto h-8 w-8 text-muted-foreground/50 mb-2" />
                  <p className="text-sm text-muted-foreground">No published templates in this workspace</p>
                </div>
              ) : (
                <ScrollArea className="max-h-[240px]">
                  <div className="space-y-2 pr-3">
                    {templates.map((opt) => {
                      const blocks = (opt.version.content || []) as TemplateBlock[];
                      const isSelected = selectedTemplate?.version.id === opt.version.id;
                      return (
                        <button
                          key={opt.version.id}
                          type="button"
                          onClick={() => setSelectedTemplate(opt)}
                          className={`w-full text-left rounded-lg border p-3 transition-colors ${
                            isSelected
                              ? 'border-foreground/30 bg-muted/50 ring-1 ring-foreground/10'
                              : 'border-border hover:border-foreground/20 hover:bg-muted/30'
                          }`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <p className="text-sm font-medium truncate">{opt.template.name}</p>
                                <span className="text-[10px] font-mono text-muted-foreground shrink-0">
                                  v{opt.version.version_number}
                                </span>
                              </div>
                              {opt.template.description && (
                                <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                                  {opt.template.description}
                                </p>
                              )}
                            </div>
                            {opt.template.category && (
                              <Badge variant="outline" className="text-[10px] shrink-0">{opt.template.category}</Badge>
                            )}
                          </div>
                          {blocks.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-2">
                              {blocks.slice(0, 6).map((b, i) => (
                                <span key={i} className="inline-flex items-center gap-1 text-[10px] bg-muted rounded px-1.5 py-0.5 text-muted-foreground">
                                  <Blocks className="h-2.5 w-2.5" />
                                  {b.label || blockTypeLabels[b.type] || b.type}
                                </span>
                              ))}
                              {blocks.length > 6 && (
                                <span className="text-[10px] text-muted-foreground">+{blocks.length - 6} more</span>
                              )}
                            </div>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </ScrollArea>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button
            onClick={handleCreate}
            disabled={loading || !notebookId || (mode === 'template' && !selectedTemplate)}
          >
            {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Create experiment
            <ChevronRight className="ml-1 h-4 w-4" />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
