import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Plus,
  Trash2,
  GripVertical,
  Save,
  Upload,
  Clock,
  Check,
  Loader2,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import type { Template, TemplateVersion, BlockType } from '@/lib/types';

interface BlockDefinition {
  id: string;
  type: BlockType;
  label: string;
  defaultContent: unknown;
}

const BLOCK_TYPES: { value: BlockType; label: string }[] = [
  { value: 'heading', label: 'Heading' },
  { value: 'paragraph', label: 'Paragraph' },
  { value: 'list', label: 'List' },
  { value: 'checklist', label: 'Checklist' },
  { value: 'callout', label: 'Callout' },
  { value: 'divider', label: 'Divider' },
  { value: 'parameters', label: 'Parameters' },
  { value: 'table', label: 'Table' },
  { value: 'image', label: 'Image' },
  { value: 'attachment', label: 'Attachment' },
  { value: 'protocol', label: 'Protocol' },
  { value: 'result', label: 'Result' },
  { value: 'reference', label: 'Reference' },
  { value: 'code', label: 'Code' },
];

const versionStatusConfig: Record<string, { className: string }> = {
  draft: { className: 'bg-muted text-muted-foreground border-transparent' },
  published: { className: 'bg-green-50 text-green-700 border-green-200' },
  superseded: { className: 'bg-muted text-muted-foreground/70 border-transparent' },
};

function generateId() {
  return crypto.randomUUID();
}

export default function TemplateEditorPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [template, setTemplate] = useState<Template | null>(null);
  const [versions, setVersions] = useState<TemplateVersion[]>([]);
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);

  // Editable fields
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');
  const [blocks, setBlocks] = useState<BlockDefinition[]>([]);
  const [activeTab, setActiveTab] = useState('blocks');
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  useEffect(() => {
    if (id) fetchTemplate();
  }, [id]);

  async function fetchTemplate() {
    setLoading(true);
    const [tplRes, verRes] = await Promise.all([
      supabase.from('templates').select('*').eq('id', id).single(),
      supabase
        .from('template_versions')
        .select('*')
        .eq('template_id', id)
        .order('version_number', { ascending: false }),
    ]);

    if (tplRes.error) {
      console.error('Failed to fetch template:', tplRes.error);
      setLoading(false);
      return;
    }

    const tpl = tplRes.data as Template;
    const vers = (verRes.data ?? []) as TemplateVersion[];

    setTemplate(tpl);
    setVersions(vers);
    setName(tpl.name);
    setDescription(tpl.description ?? '');
    setCategory(tpl.category ?? '');

    // Load latest version content
    const latest = vers[0];
    if (latest) {
      setSelectedVersionId(latest.id);
      loadVersionContent(latest);
    }

    setLoading(false);
  }

  function loadVersionContent(version: TemplateVersion) {
    const content = version.content;
    if (Array.isArray(content)) {
      setBlocks(
        content.map((b) => ({
          id: b.id || generateId(),
          type: b.type || 'paragraph',
          label: b.label || '',
          defaultContent: b.defaultContent ?? null,
        })),
      );
    } else {
      setBlocks([]);
    }
  }

  function handleVersionSelect(versionId: string) {
    const version = versions.find((v) => v.id === versionId);
    if (version) {
      setSelectedVersionId(versionId);
      loadVersionContent(version);
    }
  }

  function addBlock() {
    setBlocks((prev) => [
      ...prev,
      {
        id: generateId(),
        type: 'paragraph',
        label: '',
        defaultContent: null,
      },
    ]);
  }

  function removeBlock(idx: number) {
    setBlocks((prev) => prev.filter((_, i) => i !== idx));
  }

  function updateBlock(idx: number, patch: Partial<BlockDefinition>) {
    setBlocks((prev) =>
      prev.map((b, i) => (i === idx ? { ...b, ...patch } : b)),
    );
  }

  function moveBlock(from: number, to: number) {
    setBlocks((prev) => {
      const next = [...prev];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return next;
    });
  }

  function serializeBlocks() {
    return blocks.map((b) => ({
      id: b.id,
      type: b.type,
      label: b.label,
      defaultContent: b.defaultContent,
    }));
  }

  async function handleSaveDraft() {
    if (!id) return;
    setSaving(true);
    try {
      // Update template metadata
      await supabase
        .from('templates')
        .update({
          name: name.trim(),
          description: description.trim() || null,
          category: category.trim() || null,
        })
        .eq('id', id);

      const { data: user } = await supabase.auth.getUser();
      const content = serializeBlocks();

      // Check if current selected version is a draft — update it
      const currentVersion = versions.find((v) => v.id === selectedVersionId);
      if (currentVersion && currentVersion.status === 'draft') {
        await supabase
          .from('template_versions')
          .update({ content })
          .eq('id', currentVersion.id);
      } else {
        // Create a new draft version
        const nextNum = (versions[0]?.version_number ?? 0) + 1;
        const { data: newVer } = await supabase
          .from('template_versions')
          .insert({
            template_id: id,
            version_number: nextNum,
            content,
            status: 'draft',
            created_by: user.user!.id,
          })
          .select()
          .single();

        if (newVer) {
          setVersions((prev) => [newVer, ...prev]);
          setSelectedVersionId(newVer.id);
        }
      }

      await fetchTemplate();
    } catch (err) {
      console.error('Failed to save draft:', err);
    } finally {
      setSaving(false);
    }
  }

  async function handlePublish() {
    if (!id) return;
    setPublishing(true);
    try {
      const content = serializeBlocks();
      const currentVersion = versions.find((v) => v.id === selectedVersionId);

      let versionIdToPublish = selectedVersionId;

      if (currentVersion && currentVersion.status === 'draft') {
        // Save latest content to the draft version first
        await supabase
          .from('template_versions')
          .update({ content })
          .eq('id', currentVersion.id);
      } else {
        // Create a new draft version, then publish it
        const { data: user } = await supabase.auth.getUser();
        const nextNum = (versions[0]?.version_number ?? 0) + 1;
        const { data: newVer, error: insertErr } = await supabase
          .from('template_versions')
          .insert({
            template_id: id,
            version_number: nextNum,
            content,
            status: 'draft',
            created_by: user.user!.id,
          })
          .select('id')
          .single();
        if (insertErr) throw insertErr;
        versionIdToPublish = newVer.id;
      }

      // Update template name/description before publish
      await supabase
        .from('templates')
        .update({
          name: name.trim(),
          description: description.trim() || null,
          category: category.trim() || null,
        })
        .eq('id', id);

      // Use the server-side RPC for atomic publish
      const { error: pubErr } = await supabase.rpc('publish_template_version', {
        p_template_id: id,
        p_version_id: versionIdToPublish,
      });
      if (pubErr) throw pubErr;

      await fetchTemplate();
    } catch (err) {
      console.error('Failed to publish version:', err);
    } finally {
      setPublishing(false);
    }
  }

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
        Loading template…
      </div>
    );
  }

  if (!template) {
    return (
      <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
        Template not found
      </div>
    );
  }

  const templateStatusCfg = versionStatusConfig[template.status] ?? versionStatusConfig.draft;

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-6 py-3">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/app/templates')}
            className="rounded-lg p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-4.5 w-4.5" />
          </button>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="text-base font-semibold text-foreground bg-transparent border-none outline-none focus:ring-0 p-0"
            placeholder="Template name"
          />
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-8"
            disabled={saving}
            onClick={handleSaveDraft}
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Save className="h-3.5 w-3.5 mr-1.5" />}
            Save Draft
          </Button>
          <Button
            size="sm"
            className="h-8"
            disabled={publishing}
            onClick={handlePublish}
          >
            {publishing ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Upload className="h-3.5 w-3.5 mr-1.5" />}
            Publish Version
          </Button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 flex overflow-hidden">
        {/* Main editor */}
        <div className="flex-1 overflow-auto">
          {/* Meta fields */}
          <div className="px-6 py-4 border-b border-border/50 space-y-3">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="tpl-category">Category</Label>
                <Input
                  id="tpl-category"
                  placeholder="e.g., Biology"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="h-8"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Status</Label>
                <div className="py-1.5">
                  <Badge variant="outline" className={cn('text-[11px] font-medium px-1.5 py-0', templateStatusCfg.className)}>
                    {template.status.charAt(0).toUpperCase() + template.status.slice(1)}
                  </Badge>
                </div>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="tpl-desc">Description</Label>
              <Textarea
                id="tpl-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Describe what this template is for…"
                rows={2}
              />
            </div>
          </div>

          {/* Tabs */}
          <Tabs value={activeTab} onValueChange={setActiveTab} className="px-6">
            <TabsList className="mt-3">
              <TabsTrigger value="blocks">
                Block Definitions
                {blocks.length > 0 && (
                  <span className="ml-1.5 text-xs text-muted-foreground">({blocks.length})</span>
                )}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="blocks" className="py-4 space-y-2">
              {blocks.length === 0 && (
                <div className="text-center py-8 text-sm text-muted-foreground">
                  No blocks defined. Add blocks to define your template structure.
                </div>
              )}

              {blocks.map((block, idx) => (
                <div
                  key={block.id}
                  draggable
                  onDragStart={() => setDragIndex(idx)}
                  onDragOver={(e) => {
                    e.preventDefault();
                    if (dragIndex !== null && dragIndex !== idx) {
                      moveBlock(dragIndex, idx);
                      setDragIndex(idx);
                    }
                  }}
                  onDragEnd={() => setDragIndex(null)}
                  className="flex items-start gap-2 rounded-lg border border-border bg-background p-3 hover:border-border/80 transition-colors"
                >
                  <div className="cursor-grab pt-1 text-muted-foreground/40 hover:text-muted-foreground">
                    <GripVertical className="h-4 w-4" />
                  </div>

                  <div className="flex-1 grid grid-cols-3 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Type</Label>
                      <Select
                        value={block.type}
                        onValueChange={(val) => updateBlock(idx, { type: val as BlockType })}
                      >
                        <SelectTrigger className="h-8">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {BLOCK_TYPES.map((bt) => (
                            <SelectItem key={bt.value} value={bt.value}>
                              {bt.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Label</Label>
                      <Input
                        value={block.label}
                        onChange={(e) => updateBlock(idx, { label: e.target.value })}
                        placeholder="Section label"
                        className="h-8"
                      />
                    </div>

                    <div className="space-y-1">
                      <Label className="text-xs text-muted-foreground">Default Content</Label>
                      <Input
                        value={
                          typeof block.defaultContent === 'string'
                            ? block.defaultContent
                            : block.defaultContent
                              ? JSON.stringify(block.defaultContent)
                              : ''
                        }
                        onChange={(e) =>
                          updateBlock(idx, { defaultContent: e.target.value || null })
                        }
                        placeholder="Optional default"
                        className="h-8"
                      />
                    </div>
                  </div>

                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0 text-muted-foreground/40 hover:text-destructive hover:bg-destructive/10 mt-4"
                    onClick={() => removeBlock(idx)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}

              <button
                onClick={addBlock}
                className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-border py-2.5 text-sm text-muted-foreground hover:border-blue-400 hover:text-blue-600 hover:bg-blue-50/30 transition-colors"
              >
                <Plus className="h-4 w-4" />
                Add Block
              </button>
            </TabsContent>
          </Tabs>
        </div>

        {/* Version sidebar */}
        <div className="w-64 shrink-0 border-l border-border bg-muted/30 overflow-auto">
          <div className="px-4 py-3 border-b border-border">
            <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Versions
            </h3>
          </div>
          <div className="p-2 space-y-1">
            {versions.length === 0 && (
              <p className="px-2 py-4 text-xs text-muted-foreground text-center">
                No versions yet. Save a draft to create v1.
              </p>
            )}
            {versions.map((ver) => {
              const isSelected = ver.id === selectedVersionId;
              const st = versionStatusConfig[ver.status] ?? versionStatusConfig.draft;
              return (
                <button
                  key={ver.id}
                  onClick={() => handleVersionSelect(ver.id)}
                  className={cn(
                    'w-full flex items-center gap-2 rounded-lg px-3 py-2 text-left transition-colors',
                    isSelected
                      ? 'bg-blue-50 text-blue-700'
                      : 'text-foreground hover:bg-muted',
                  )}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm font-medium">
                        v{ver.version_number}
                      </span>
                      <Badge variant="outline" className={cn('text-[10px] font-medium px-1 py-0', st.className)}>
                        {ver.status}
                      </Badge>
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                      <Clock className="h-2.5 w-2.5" />
                      {new Date(ver.created_at).toLocaleDateString()}
                    </div>
                  </div>
                  {ver.status === 'published' && (
                    <Check className="h-3.5 w-3.5 text-green-600 shrink-0" />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
