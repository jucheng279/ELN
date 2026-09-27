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
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import Button from '@/components/common/Button';
import Input from '@/components/common/Input';
import Tabs from '@/components/common/Tabs';
import type { Protocol, ProtocolVersion, ProtocolStep } from '@/lib/types';

interface ParameterEntry {
  name: string;
  value: string;
  unit: string;
}

const versionStatusStyle: Record<string, { bg: string; text: string }> = {
  draft: { bg: 'bg-gray-100', text: 'text-gray-600' },
  published: { bg: 'bg-green-50', text: 'text-green-700' },
  superseded: { bg: 'bg-gray-100', text: 'text-gray-500' },
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

  // Editable fields
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

    // Convert parameters record to array
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

    // Expand first step by default
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

  // Step management
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

  // Parameter management
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
      <div className="h-full flex items-center justify-center text-sm text-gray-400">
        Loading protocol…
      </div>
    );
  }

  if (!protocol) {
    return (
      <div className="h-full flex items-center justify-center text-sm text-gray-400">
        Protocol not found
      </div>
    );
  }

  const selectedVersion = versions.find((v) => v.id === selectedVersionId);

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-200 px-6 py-3">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/app/protocols')}
            className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
          >
            <ArrowLeft size={18} />
          </button>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="text-base font-semibold text-gray-900 bg-transparent border-none outline-none focus:ring-0 p-0"
            placeholder="Protocol name"
          />
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            icon={<Save size={14} />}
            loading={saving}
            onClick={handleSaveDraft}
          >
            Save Draft
          </Button>
          <Button
            size="sm"
            icon={<Upload size={14} />}
            loading={publishing}
            onClick={handlePublish}
          >
            Publish Version
          </Button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 flex overflow-hidden">
        {/* Main editor */}
        <div className="flex-1 overflow-auto">
          {/* Meta fields */}
          <div className="px-6 py-4 border-b border-gray-100 space-y-3">
            <div className="grid grid-cols-2 gap-4">
              <Input
                label="Category"
                placeholder="e.g., Biochemistry"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              />
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  Status
                </label>
                <div className="py-2">
                  <span
                    className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                      (versionStatusStyle[protocol.status] ?? versionStatusStyle.draft).bg
                    } ${(versionStatusStyle[protocol.status] ?? versionStatusStyle.draft).text}`}
                  >
                    {protocol.status.charAt(0).toUpperCase() +
                      protocol.status.slice(1)}
                  </span>
                </div>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Description
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Describe this protocol…"
                rows={2}
                className="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              />
            </div>
          </div>

          {/* Tabs */}
          <div className="px-6">
            <Tabs
              tabs={[
                { id: 'steps', label: 'Steps', count: steps.length },
                { id: 'parameters', label: 'Parameters', count: parameters.length },
                { id: 'notes', label: 'Notes' },
              ]}
              activeTab={activeTab}
              onChange={setActiveTab}
            />
          </div>

          {/* Tab content */}
          <div className="px-6 py-4">
            {activeTab === 'steps' && (
              <div className="space-y-2">
                {steps.length === 0 && (
                  <div className="text-center py-8 text-sm text-gray-400">
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
                      className="rounded-lg border border-gray-200 bg-white overflow-hidden hover:border-gray-300 transition-colors"
                    >
                      {/* Step header */}
                      <div
                        className="flex items-center gap-2 px-3 py-2.5 cursor-pointer select-none"
                        onClick={() => toggleExpand(idx)}
                      >
                        <div
                          className="cursor-grab text-gray-300 hover:text-gray-500"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <GripVertical size={16} />
                        </div>
                        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-50 text-xs font-semibold text-blue-600">
                          {step.step_number}
                        </div>
                        <span className="flex-1 text-sm text-gray-900 truncate">
                          {step.instruction || (
                            <span className="text-gray-400 italic">
                              No instruction
                            </span>
                          )}
                        </span>
                        {step.warnings && (
                          <AlertTriangle
                            size={14}
                            className="text-amber-500 shrink-0"
                          />
                        )}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            removeStep(idx);
                          }}
                          className="rounded-md p-1 text-gray-300 hover:bg-red-50 hover:text-red-500 transition-colors"
                        >
                          <Trash2 size={14} />
                        </button>
                        {isExpanded ? (
                          <ChevronDown size={16} className="text-gray-400" />
                        ) : (
                          <ChevronRight size={16} className="text-gray-400" />
                        )}
                      </div>

                      {/* Step body (expanded) */}
                      {isExpanded && (
                        <div className="border-t border-gray-100 px-4 py-3 space-y-3">
                          <div>
                            <label className="block text-xs font-medium text-gray-500 mb-1">
                              Instruction <span className="text-red-400">*</span>
                            </label>
                            <textarea
                              value={step.instruction}
                              onChange={(e) =>
                                updateStep(idx, {
                                  instruction: e.target.value,
                                })
                              }
                              placeholder="Describe what to do in this step…"
                              rows={2}
                              className="block w-full rounded-md border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500/30"
                            />
                          </div>

                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <label className="block text-xs font-medium text-gray-500 mb-1">
                                Duration
                              </label>
                              <input
                                type="text"
                                value={step.duration ?? ''}
                                onChange={(e) =>
                                  updateStep(idx, {
                                    duration: e.target.value || null,
                                  })
                                }
                                placeholder="e.g., 30 min, 2 hours"
                                className="block w-full rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500/30"
                              />
                            </div>
                            <div>
                              <label className="block text-xs font-medium text-gray-500 mb-1">
                                Temperature
                              </label>
                              <input
                                type="text"
                                value={step.temperature ?? ''}
                                onChange={(e) =>
                                  updateStep(idx, {
                                    temperature: e.target.value || null,
                                  })
                                }
                                placeholder="e.g., 37°C, RT"
                                className="block w-full rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500/30"
                              />
                            </div>
                          </div>

                          <div>
                            <label className="block text-xs font-medium text-gray-500 mb-1">
                              Notes
                            </label>
                            <input
                              type="text"
                              value={step.notes ?? ''}
                              onChange={(e) =>
                                updateStep(idx, {
                                  notes: e.target.value || null,
                                })
                              }
                              placeholder="Additional notes for this step"
                              className="block w-full rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500/30"
                            />
                          </div>

                          <div>
                            <label className="block text-xs font-medium text-gray-500 mb-1">
                              <span className="flex items-center gap-1">
                                <AlertTriangle size={11} className="text-amber-500" />
                                Warnings
                              </span>
                            </label>
                            <input
                              type="text"
                              value={step.warnings ?? ''}
                              onChange={(e) =>
                                updateStep(idx, {
                                  warnings: e.target.value || null,
                                })
                              }
                              placeholder="Safety warnings or cautions"
                              className="block w-full rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500/30"
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}

                <button
                  onClick={addStep}
                  className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-gray-300 py-2.5 text-sm text-gray-500 hover:border-blue-400 hover:text-blue-600 hover:bg-blue-50/30 transition-colors"
                >
                  <Plus size={15} />
                  Add Step
                </button>
              </div>
            )}

            {activeTab === 'parameters' && (
              <div className="space-y-2">
                {parameters.length === 0 && (
                  <div className="text-center py-8 text-sm text-gray-400">
                    No protocol-level parameters. Add parameters to define
                    reusable values.
                  </div>
                )}

                {parameters.map((param, idx) => (
                  <div
                    key={idx}
                    className="flex items-end gap-3 rounded-lg border border-gray-200 bg-white p-3"
                  >
                    <div className="flex-1">
                      <label className="block text-xs font-medium text-gray-500 mb-1">
                        Name
                      </label>
                      <input
                        type="text"
                        value={param.name}
                        onChange={(e) =>
                          updateParameter(idx, { name: e.target.value })
                        }
                        placeholder="e.g., Buffer pH"
                        className="block w-full rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500/30"
                      />
                    </div>
                    <div className="flex-1">
                      <label className="block text-xs font-medium text-gray-500 mb-1">
                        Value
                      </label>
                      <input
                        type="text"
                        value={param.value}
                        onChange={(e) =>
                          updateParameter(idx, { value: e.target.value })
                        }
                        placeholder="e.g., 7.4"
                        className="block w-full rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500/30"
                      />
                    </div>
                    <div className="w-28">
                      <label className="block text-xs font-medium text-gray-500 mb-1">
                        Unit
                      </label>
                      <input
                        type="text"
                        value={param.unit}
                        onChange={(e) =>
                          updateParameter(idx, { unit: e.target.value })
                        }
                        placeholder="e.g., pH"
                        className="block w-full rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500/30"
                      />
                    </div>
                    <button
                      onClick={() => removeParameter(idx)}
                      className="rounded-md p-1.5 text-gray-300 hover:bg-red-50 hover:text-red-500 transition-colors mb-0.5"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                ))}

                <button
                  onClick={addParameter}
                  className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-gray-300 py-2.5 text-sm text-gray-500 hover:border-blue-400 hover:text-blue-600 hover:bg-blue-50/30 transition-colors"
                >
                  <Plus size={15} />
                  Add Parameter
                </button>
              </div>
            )}

            {activeTab === 'notes' && (
              <div>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="General notes about this protocol…"
                  rows={8}
                  className="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                />
              </div>
            )}
          </div>
        </div>

        {/* Version sidebar */}
        <div className="w-64 shrink-0 border-l border-gray-200 bg-gray-50/50 overflow-auto">
          <div className="px-4 py-3 border-b border-gray-200">
            <h3 className="text-xs font-medium uppercase tracking-wide text-gray-500">
              Versions
            </h3>
          </div>
          <div className="p-2 space-y-1">
            {versions.length === 0 && (
              <p className="px-2 py-4 text-xs text-gray-400 text-center">
                No versions yet. Save a draft to create v1.
              </p>
            )}
            {versions.map((ver) => {
              const isSelected = ver.id === selectedVersionId;
              const st =
                versionStatusStyle[ver.status] ?? versionStatusStyle.draft;
              return (
                <button
                  key={ver.id}
                  onClick={() => handleVersionSelect(ver.id)}
                  className={[
                    'w-full flex items-center gap-2 rounded-md px-3 py-2 text-left transition-colors',
                    isSelected
                      ? 'bg-blue-50 text-blue-700'
                      : 'text-gray-700 hover:bg-gray-100',
                  ].join(' ')}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm font-medium">
                        v{ver.version_number}
                      </span>
                      <span
                        className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium ${st.bg} ${st.text}`}
                      >
                        {ver.status}
                      </span>
                    </div>
                    <div className="text-xs text-gray-400 mt-0.5 flex items-center gap-1">
                      <Clock size={10} />
                      {new Date(ver.created_at).toLocaleDateString()}
                    </div>
                    {ver.steps && (
                      <div className="text-xs text-gray-400 mt-0.5">
                        {ver.steps.length} step{ver.steps.length !== 1 ? 's' : ''}
                      </div>
                    )}
                  </div>
                  {ver.status === 'published' && (
                    <Check size={14} className="text-green-600 shrink-0" />
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
