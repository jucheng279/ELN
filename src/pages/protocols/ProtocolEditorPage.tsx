import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Plus,
  Trash2,
  GripVertical,
  Save,
  Upload,
  ChevronDown,
  ChevronRight,
  Clock,
  Check,
  AlertTriangle,
  Loader2,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import type { Protocol, ProtocolVersion, ProtocolStep } from '@/lib/types';

interface ParameterEntry {
  name: string;
  value: string;
  unit: string;
}

const versionStatusConfig: Record<string, { className: string }> = {
  draft: { className: 'bg-muted text-muted-foreground border-transparent' },
  published: { className: 'bg-green-50 text-green-700 border-green-200' },
  superseded: { className: 'bg-muted text-muted-foreground/70 border-transparent' },
};

function createEmptyStep(stepNumber: number): ProtocolStep {
  return {
    step_number: stepNumber,
    instruction: '',
    duration: null,
    temperature: null,
    parameters: null,
    notes: null,
    warnings: null,
    substeps: null,
  };
}

export default function ProtocolEditorPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [protocol, setProtocol] = useState<Protocol | null>(null);
  const [versions, setVersions] = useState<ProtocolVersion[]>([]);
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');
  const [steps, setSteps] = useState<ProtocolStep[]>([]);
  const [parameters, setParameters] = useState<ParameterEntry[]>([]);
  const [notes, setNotes] = useState('');
  const [expandedSteps, setExpandedSteps] = useState<Set<number>>(new Set());
  const [activeTab, setActiveTab] = useState('steps');
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  useEffect(() => {
    if (id) fetchProtocol();
  }, [id]);

  async function fetchProtocol() {
    setLoading(true);
    const [protoRes, verRes] = await Promise.all([
      supabase.from('protocols').select('*').eq('id', id).single(),
      supabase
        .from('protocol_versions')
        .select('*')
        .eq('protocol_id', id)
        .order('version_number', { ascending: false }),
    ]);

    if (protoRes.error) {
      console.error('Failed to fetch protocol:', protoRes.error);
      setLoading(false);
      return;
    }

    const proto = protoRes.data as Protocol;
    const vers = (verRes.data ?? []) as ProtocolVersion[];

    setProtocol(proto);
    setVersions(vers);
    setName(proto.name);
    setDescription(proto.description ?? '');
    setCategory(proto.category ?? '');

    const latest = vers[0];
    if (latest) {
      setSelectedVersionId(latest.id);
      loadVersionContent(latest);
    }

    setLoading(false);
  }

  function loadVersionContent(version: ProtocolVersion) {
    setSteps(Array.isArray(version.steps) ? version.steps : []);
    setNotes(version.notes ?? '');

    const params = version.parameters;
    if (params && typeof params === 'object') {
      const entries: ParameterEntry[] = Object.entries(params).map(
        ([key, val]: [string, any]) => ({
          name: key,
          value: String(val?.value ?? val ?? ''),
          unit: String(val?.unit ?? ''),
        }),
      );
      setParameters(entries);
    } else {
      setParameters([]);
    }

    if (Array.isArray(version.steps) && version.steps.length > 0) {
      setExpandedSteps(new Set([0]));
    }
  }

  function handleVersionSelect(versionId: string) {
    const version = versions.find((v) => v.id === versionId);
    if (version) {
      setSelectedVersionId(versionId);
      loadVersionContent(version);
    }
  }

  function addStep() {
    setSteps((prev) => {
      const next = [...prev, createEmptyStep(prev.length + 1)];
      setExpandedSteps((s) => new Set([...s, next.length - 1]));
      return next;
    });
  }

  function removeStep(idx: number) {
    setSteps((prev) =>
      prev
        .filter((_, i) => i !== idx)
        .map((s, i) => ({ ...s, step_number: i + 1 })),
    );
    setExpandedSteps((prev) => {
      const next = new Set<number>();
      prev.forEach((i) => {
        if (i < idx) next.add(i);
        else if (i > idx) next.add(i - 1);
      });
      return next;
    });
  }

  function updateStep(idx: number, patch: Partial<ProtocolStep>) {
    setSteps((prev) =>
      prev.map((s, i) => (i === idx ? { ...s, ...patch } : s)),
    );
  }

  function moveStep(from: number, to: number) {
    setSteps((prev) => {
      const next = [...prev];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return next.map((s, i) => ({ ...s, step_number: i + 1 }));
    });
  }

  function toggleExpand(idx: number) {
    setExpandedSteps((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  }

  function addParameter() {
    setParameters((prev) => [...prev, { name: '', value: '', unit: '' }]);
  }

  function removeParameter(idx: number) {
    setParameters((prev) => prev.filter((_, i) => i !== idx));
  }

  function updateParameter(idx: number, patch: Partial<ParameterEntry>) {
    setParameters((prev) =>
      prev.map((p, i) => (i === idx ? { ...p, ...patch } : p)),
    );
  }

  function serializeParameters(): Record<string, any> | null {
    const valid = parameters.filter((p) => p.name.trim());
    if (valid.length === 0) return null;
    const obj: Record<string, any> = {};
    valid.forEach((p) => {
      obj[p.name.trim()] = { value: p.value, unit: p.unit };
    });
    return obj;
  }

  async function handleSaveDraft() {
    if (!id) return;
    setSaving(true);
    try {
      await supabase
        .from('protocols')
        .update({
          name: name.trim(),
          description: description.trim() || null,
          category: category.trim() || null,
        })
        .eq('id', id);

      const { data: user } = await supabase.auth.getUser();
      const payload = {
        steps,
        parameters: serializeParameters(),
        notes: notes.trim() || null,
      };

      const currentVersion = versions.find((v) => v.id === selectedVersionId);
      if (currentVersion && currentVersion.status === 'draft') {
        await supabase
          .from('protocol_versions')
          .update(payload)
          .eq('id', currentVersion.id);
      } else {
        const nextNum = (versions[0]?.version_number ?? 0) + 1;
        const { data: newVer } = await supabase
          .from('protocol_versions')
          .insert({
            protocol_id: id,
            version_number: nextNum,
            ...payload,
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

      await fetchProtocol();
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
      const { data: user } = await supabase.auth.getUser();
      const payload = {
        steps,
        parameters: serializeParameters(),
        notes: notes.trim() || null,
      };

      await supabase
        .from('protocol_versions')
        .update({ status: 'superseded' })
        .eq('protocol_id', id)
        .eq('status', 'published');

      const nextNum = (versions[0]?.version_number ?? 0) + 1;
      const currentVersion = versions.find((v) => v.id === selectedVersionId);

      if (currentVersion && currentVersion.status === 'draft') {
        await supabase
          .from('protocol_versions')
          .update({
            ...payload,
            status: 'published',
            published_at: new Date().toISOString(),
          })
          .eq('id', currentVersion.id);
      } else {
        await supabase.from('protocol_versions').insert({
          protocol_id: id,
          version_number: nextNum,
          ...payload,
          status: 'published',
          published_at: new Date().toISOString(),
          created_by: user.user!.id,
        });
      }

      await supabase
        .from('protocols')
        .update({
          name: name.trim(),
          description: description.trim() || null,
          category: category.trim() || null,
          current_version:
            currentVersion?.status === 'draft'
              ? currentVersion.version_number
              : nextNum,
          status: 'published',
        })
        .eq('id', id);

      await fetchProtocol();
    } catch (err) {
      console.error('Failed to publish version:', err);
    } finally {
      setPublishing(false);
    }
  }

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
        Loading protocol…
      </div>
    );
  }

  if (!protocol) {
    return (
      <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
        Protocol not found
      </div>
    );
  }

  const selectedVersion = versions.find((v) => v.id === selectedVersionId);
  const protocolStatusCfg = versionStatusConfig[protocol.status] ?? versionStatusConfig.draft;

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-6 py-3">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/app/protocols')}
            className="rounded-lg p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-4.5 w-4.5" />
          </button>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="text-base font-semibold text-foreground bg-transparent border-none outline-none focus:ring-0 p-0"
            placeholder="Protocol name"
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
                <Label htmlFor="proto-category">Category</Label>
                <Input
                  id="proto-category"
                  placeholder="e.g., Biochemistry"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="h-8"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Status</Label>
                <div className="py-1.5">
                  <Badge variant="outline" className={cn('text-[11px] font-medium px-1.5 py-0', protocolStatusCfg.className)}>
                    {protocol.status.charAt(0).toUpperCase() + protocol.status.slice(1)}
                  </Badge>
                </div>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="proto-desc">Description</Label>
              <Textarea
                id="proto-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Describe this protocol…"
                rows={2}
              />
            </div>
          </div>

          {/* Tabs */}
          <Tabs value={activeTab} onValueChange={setActiveTab} className="px-6">
            <TabsList className="mt-3">
              <TabsTrigger value="steps">
                Steps
                {steps.length > 0 && (
                  <span className="ml-1.5 text-xs text-muted-foreground">({steps.length})</span>
                )}
              </TabsTrigger>
              <TabsTrigger value="parameters">
                Parameters
                {parameters.length > 0 && (
                  <span className="ml-1.5 text-xs text-muted-foreground">({parameters.length})</span>
                )}
              </TabsTrigger>
              <TabsTrigger value="notes">Notes</TabsTrigger>
            </TabsList>

            {/* Steps tab */}
            <TabsContent value="steps" className="py-4 space-y-2">
              {steps.length === 0 && (
                <div className="text-center py-8 text-sm text-muted-foreground">
                  No steps defined. Add steps to build your protocol.
                </div>
              )}

              {steps.map((step, idx) => {
                const isExpanded = expandedSteps.has(idx);
                return (
                  <div
                    key={idx}
                    draggable
                    onDragStart={() => setDragIndex(idx)}
                    onDragOver={(e) => {
                      e.preventDefault();
                      if (dragIndex !== null && dragIndex !== idx) {
                        moveStep(dragIndex, idx);
                        setDragIndex(idx);
                      }
                    }}
                    onDragEnd={() => setDragIndex(null)}
                    className="rounded-lg border border-border bg-background overflow-hidden hover:border-border/80 transition-colors"
                  >
                    <div
                      className="flex items-center gap-2 px-3 py-2.5 cursor-pointer select-none"
                      onClick={() => toggleExpand(idx)}
                    >
                      <div
                        className="cursor-grab text-muted-foreground/40 hover:text-muted-foreground"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <GripVertical className="h-4 w-4" />
                      </div>
                      <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-50 text-xs font-semibold text-blue-600">
                        {step.step_number}
                      </div>
                      <span className="flex-1 text-sm text-foreground truncate">
                        {step.instruction || (
                          <span className="text-muted-foreground italic">No instruction</span>
                        )}
                      </span>
                      {step.warnings && (
                        <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 p-0 text-muted-foreground/40 hover:text-destructive hover:bg-destructive/10"
                        onClick={(e) => {
                          e.stopPropagation();
                          removeStep(idx);
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                      {isExpanded ? (
                        <ChevronDown className="h-4 w-4 text-muted-foreground" />
                      ) : (
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      )}
                    </div>

                    {isExpanded && (
                      <div className="border-t border-border/50 px-4 py-3 space-y-3">
                        <div className="space-y-1">
                          <Label className="text-xs text-muted-foreground">
                            Instruction <span className="text-destructive">*</span>
                          </Label>
                          <Textarea
                            value={step.instruction}
                            onChange={(e) => updateStep(idx, { instruction: e.target.value })}
                            placeholder="Describe what to do in this step…"
                            rows={2}
                          />
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                          <div className="space-y-1">
                            <Label className="text-xs text-muted-foreground">Duration</Label>
                            <Input
                              value={step.duration ?? ''}
                              onChange={(e) => updateStep(idx, { duration: e.target.value || null })}
                              placeholder="e.g., 30 min, 2 hours"
                              className="h-8"
                            />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs text-muted-foreground">Temperature</Label>
                            <Input
                              value={step.temperature ?? ''}
                              onChange={(e) => updateStep(idx, { temperature: e.target.value || null })}
                              placeholder="e.g., 37°C, RT"
                              className="h-8"
                            />
                          </div>
                        </div>

                        <div className="space-y-1">
                          <Label className="text-xs text-muted-foreground">Notes</Label>
                          <Input
                            value={step.notes ?? ''}
                            onChange={(e) => updateStep(idx, { notes: e.target.value || null })}
                            placeholder="Additional notes for this step"
                            className="h-8"
                          />
                        </div>

                        <div className="space-y-1">
                          <Label className="text-xs text-muted-foreground">
                            <span className="flex items-center gap-1">
                              <AlertTriangle className="h-3 w-3 text-amber-500" />
                              Warnings
                            </span>
                          </Label>
                          <Input
                            value={step.warnings ?? ''}
                            onChange={(e) => updateStep(idx, { warnings: e.target.value || null })}
                            placeholder="Safety warnings or cautions"
                            className="h-8"
                          />
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}

              <button
                onClick={addStep}
                className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-border py-2.5 text-sm text-muted-foreground hover:border-blue-400 hover:text-blue-600 hover:bg-blue-50/30 transition-colors"
              >
                <Plus className="h-4 w-4" />
                Add Step
              </button>
            </TabsContent>

            {/* Parameters tab */}
            <TabsContent value="parameters" className="py-4 space-y-2">
              {parameters.length === 0 && (
                <div className="text-center py-8 text-sm text-muted-foreground">
                  No protocol-level parameters. Add parameters to define reusable values.
                </div>
              )}

              {parameters.map((param, idx) => (
                <div
                  key={idx}
                  className="flex items-end gap-3 rounded-lg border border-border bg-background p-3"
                >
                  <div className="flex-1 space-y-1">
                    <Label className="text-xs text-muted-foreground">Name</Label>
                    <Input
                      value={param.name}
                      onChange={(e) => updateParameter(idx, { name: e.target.value })}
                      placeholder="e.g., Buffer pH"
                      className="h-8"
                    />
                  </div>
                  <div className="flex-1 space-y-1">
                    <Label className="text-xs text-muted-foreground">Value</Label>
                    <Input
                      value={param.value}
                      onChange={(e) => updateParameter(idx, { value: e.target.value })}
                      placeholder="e.g., 7.4"
                      className="h-8"
                    />
                  </div>
                  <div className="w-28 space-y-1">
                    <Label className="text-xs text-muted-foreground">Unit</Label>
                    <Input
                      value={param.unit}
                      onChange={(e) => updateParameter(idx, { unit: e.target.value })}
                      placeholder="e.g., pH"
                      className="h-8"
                    />
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 w-8 p-0 text-muted-foreground/40 hover:text-destructive hover:bg-destructive/10 mb-0.5"
                    onClick={() => removeParameter(idx)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}

              <button
                onClick={addParameter}
                className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-border py-2.5 text-sm text-muted-foreground hover:border-blue-400 hover:text-blue-600 hover:bg-blue-50/30 transition-colors"
              >
                <Plus className="h-4 w-4" />
                Add Parameter
              </button>
            </TabsContent>

            {/* Notes tab */}
            <TabsContent value="notes" className="py-4">
              <Textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="General notes about this protocol…"
                rows={8}
              />
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
                    {ver.steps && (
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {ver.steps.length} step{ver.steps.length !== 1 ? 's' : ''}
                      </div>
                    )}
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
