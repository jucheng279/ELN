import { useState, useCallback, useEffect } from 'react';
import { ClipboardList, Clock, Thermometer, AlertTriangle, Check, X, Search, Loader2, Shield } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import type { ProtocolBlockContent, ProtocolStep, ProtocolDevBlockEntry, ExperimentProtocolSnapshot } from '@/lib/types';

interface ProtocolBlockProps {
  content: ProtocolBlockContent;
  onUpdate: (content: ProtocolBlockContent) => void;
  readOnly: boolean;
  workspaceId?: string;
  experimentId?: string;
}

interface ProtocolSearchResult {
  id: string;
  name: string;
  description: string | null;
  current_version: number;
}

export default function ProtocolBlock({ content, onUpdate, readOnly, workspaceId, experimentId }: ProtocolBlockProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<ProtocolSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [loading, setLoading] = useState(false);
  const [activeDeviationIndex, setActiveDeviationIndex] = useState<number | null>(null);
  const [deviationForm, setDeviationForm] = useState({ actual_value: '', reason: '' });
  const [relationalDeviations, setRelationalDeviations] = useState<ProtocolDevBlockEntry[]>([]);
  const [snapshotSteps, setSnapshotSteps] = useState<ProtocolStep[]>([]);

  useEffect(() => {
    if (content.experiment_protocol_id) {
      void loadRelationalData(content.experiment_protocol_id);
    } else {
      setRelationalDeviations([]);
      setSnapshotSteps(content.steps ?? []);
    }
  }, [content.experiment_protocol_id]);

  async function loadRelationalData(epId: string) {
    const { data: ep } = await supabase
      .from('experiment_protocols')
      .select('snapshot')
      .eq('id', epId)
      .maybeSingle();

    if (ep?.snapshot) {
      const snap = ep.snapshot as ExperimentProtocolSnapshot;
      setSnapshotSteps(snap.steps ?? []);
    }

    const { data: devs } = await supabase
      .from('protocol_deviations')
      .select('*')
      .eq('experiment_protocol_id', epId)
      .order('step_index', { ascending: true });

    if (devs) {
      setRelationalDeviations(devs.map((d) => ({
        step_index: d.step_index,
        original_value: d.original_value,
        actual_value: d.actual_value,
        reason: d.reason,
      })));
    }
  }

  const steps = content.experiment_protocol_id ? snapshotSteps : (content.steps ?? []);
  const deviations = content.experiment_protocol_id ? relationalDeviations : (content.deviations ?? []);

  useEffect(() => {
    if (!searchQuery.trim() || !workspaceId) {
      setSearchResults([]);
      return;
    }
    const timeout = setTimeout(async () => {
      setSearching(true);
      try {
        const { data } = await supabase
          .from('protocols')
          .select('id, name, description, current_version')
          .eq('workspace_id', workspaceId)
          .eq('status', 'published')
          .ilike('name', `%${searchQuery}%`)
          .limit(10);
        setSearchResults((data ?? []) as ProtocolSearchResult[]);
      } catch {
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => clearTimeout(timeout);
  }, [searchQuery, workspaceId]);

  const handleSelectProtocol = useCallback(
    async (protocol: ProtocolSearchResult) => {
      if (!experimentId) return;
      setLoading(true);
      try {
        const { data: version } = await supabase
          .from('protocol_versions')
          .select('*')
          .eq('protocol_id', protocol.id)
          .eq('status', 'published')
          .order('version_number', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (!version) {
          console.error('No published version found');
          return;
        }

        const { data: result, error } = await supabase.rpc('attach_protocol_to_experiment', {
          p_experiment_id: experimentId,
          p_protocol_version_id: version.id,
        });

        if (error) throw error;

        const res = result as {
          experiment_protocol_id: string;
          protocol_id: string;
          protocol_version_id: string;
          snapshot: ExperimentProtocolSnapshot;
        };

        onUpdate({
          ...content,
          protocol_id: res.protocol_id,
          protocol_version_id: res.protocol_version_id,
          experiment_protocol_id: res.experiment_protocol_id,
          protocol_name: res.snapshot.protocol_name,
          version_number: res.snapshot.version_number,
          steps: res.snapshot.steps,
          deviations: [],
        });
        setShowSearch(false);
        setSearchQuery('');
      } catch (err) {
        console.error('Failed to attach protocol:', err);
      } finally {
        setLoading(false);
      }
    },
    [content, onUpdate, experimentId]
  );

  const getDeviationForStep = useCallback(
    (stepIndex: number): ProtocolDevBlockEntry | undefined => {
      return deviations.find((d) => d.step_index === stepIndex);
    },
    [deviations]
  );

  const handleStepClick = useCallback(
    (stepIndex: number) => {
      if (readOnly) return;
      if (activeDeviationIndex === stepIndex) {
        setActiveDeviationIndex(null);
        setDeviationForm({ actual_value: '', reason: '' });
        return;
      }
      const existing = getDeviationForStep(stepIndex);
      setActiveDeviationIndex(stepIndex);
      setDeviationForm({
        actual_value: existing?.actual_value ?? '',
        reason: existing?.reason ?? '',
      });
    },
    [readOnly, activeDeviationIndex, getDeviationForStep]
  );

  const handleSaveDeviation = useCallback(async () => {
    if (activeDeviationIndex === null) return;
    const step = steps[activeDeviationIndex];
    if (!step) return;

    if (content.experiment_protocol_id) {
      const { error } = await supabase.rpc('upsert_protocol_deviation', {
        p_experiment_protocol_id: content.experiment_protocol_id,
        p_step_index: activeDeviationIndex,
        p_actual_value: deviationForm.actual_value,
        p_reason: deviationForm.reason,
      });
      if (error) {
        console.error('Failed to save deviation:', error);
        return;
      }
      await loadRelationalData(content.experiment_protocol_id);
    } else {
      const existingDeviations = content.deviations ?? [];
      const filtered = existingDeviations.filter((d) => d.step_index !== activeDeviationIndex);
      const newDeviation: ProtocolDevBlockEntry = {
        step_index: activeDeviationIndex,
        original_value: step.instruction,
        actual_value: deviationForm.actual_value,
        reason: deviationForm.reason,
      };
      onUpdate({
        ...content,
        deviations: [...filtered, newDeviation],
      });
    }

    setActiveDeviationIndex(null);
    setDeviationForm({ actual_value: '', reason: '' });
  }, [activeDeviationIndex, content, steps, deviationForm, onUpdate]);

  const handleCancelDeviation = useCallback(() => {
    setActiveDeviationIndex(null);
    setDeviationForm({ actual_value: '', reason: '' });
  }, []);

  const handleRemoveProtocol = useCallback(() => {
    onUpdate({
      ...content,
      protocol_id: null,
      protocol_version_id: null,
      experiment_protocol_id: null,
      protocol_name: '',
      version_number: 0,
      steps: [],
      deviations: [],
    });
  }, [content, onUpdate]);

  if (!content.protocol_name) {
    return (
      <div className="rounded-lg border-2 border-dashed border-gray-300 p-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <ClipboardList className="h-8 w-8 text-gray-400" />
          <p className="text-sm text-gray-500">No protocol linked. Search and attach a protocol.</p>
          {!readOnly && (
            <div className="w-full max-w-sm">
              {showSearch ? (
                <div className="relative">
                  <div className="flex items-center gap-2 border border-gray-200 rounded-md px-3 py-1.5">
                    <Search className="h-4 w-4 text-gray-400 shrink-0" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Search protocols..."
                      className="flex-1 text-sm bg-transparent outline-none"
                      autoFocus
                    />
                    {searching && <Loader2 className="h-4 w-4 text-gray-400 animate-spin" />}
                    <button
                      onClick={() => { setShowSearch(false); setSearchQuery(''); }}
                      className="text-gray-400 hover:text-gray-600"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                  {searchResults.length > 0 && (
                    <div className="absolute z-20 mt-1 w-full rounded-md border border-gray-200 bg-white shadow-lg max-h-48 overflow-y-auto">
                      {searchResults.map((p) => (
                        <button
                          key={p.id}
                          onClick={() => handleSelectProtocol(p)}
                          disabled={loading}
                          className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 border-b border-gray-50 last:border-0"
                        >
                          <span className="font-medium text-gray-900">{p.name}</span>
                          <span className="text-xs text-gray-500 ml-2">v{p.current_version}</span>
                          {p.description && (
                            <p className="text-xs text-gray-400 truncate">{p.description}</p>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                  {searchQuery && !searching && searchResults.length === 0 && (
                    <div className="absolute z-20 mt-1 w-full rounded-md border border-gray-200 bg-white shadow-lg p-3">
                      <p className="text-xs text-gray-400 text-center">No protocols found</p>
                    </div>
                  )}
                </div>
              ) : (
                <button
                  onClick={() => setShowSearch(true)}
                  className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 bg-blue-600 text-white rounded-md hover:bg-blue-700"
                >
                  <Search className="h-3.5 w-3.5" />
                  Search Protocols
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-gray-200">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-100 bg-gray-50 rounded-t-lg">
        <ClipboardList className="h-4 w-4 text-gray-500" />
        <span className="font-semibold text-gray-900">{content.protocol_name}</span>
        <span className="text-xs bg-gray-100 text-gray-600 rounded px-1.5 py-0.5">
          v{content.version_number}
        </span>
        {content.experiment_protocol_id && (
          <span className="inline-flex items-center gap-0.5 text-[10px] font-mono text-gray-400" title="Relational protocol instance">
            <Shield className="h-2.5 w-2.5" />
            pinned
          </span>
        )}
        {!readOnly && (
          <button
            onClick={handleRemoveProtocol}
            className="ml-auto text-xs text-gray-400 hover:text-red-500"
          >
            Remove
          </button>
        )}
      </div>

      {steps.length === 0 ? (
        <div className="px-4 py-6 text-center">
          <p className="text-sm text-gray-400">This protocol has no steps defined yet.</p>
        </div>
      ) : (
        <div className="divide-y divide-gray-100">
          {steps.map((step, index) => {
            const deviation = getDeviationForStep(index);
            const isDeviationFormOpen = activeDeviationIndex === index;
            const hasDeviation = !!deviation;

            return (
              <div key={index}>
                <div
                  className={`px-4 py-3 ${
                    hasDeviation ? 'bg-amber-50 border-l-4 border-amber-400' : ''
                  } ${!readOnly ? 'cursor-pointer hover:bg-gray-50' : ''}`}
                  onClick={() => handleStepClick(index)}
                >
                  <div className="flex items-start gap-3">
                    <div className="w-7 h-7 rounded-full bg-blue-100 text-blue-700 text-sm font-medium flex items-center justify-center shrink-0 mt-0.5">
                      {step.step_number}
                    </div>

                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-gray-900">{step.instruction}</p>

                      {(step.duration || step.temperature) && (
                        <div className="flex items-center gap-3 mt-1.5">
                          {step.duration && (
                            <span className="inline-flex items-center gap-1 text-xs text-gray-500">
                              <Clock className="h-3 w-3" />
                              {step.duration}
                            </span>
                          )}
                          {step.temperature && (
                            <span className="inline-flex items-center gap-1 text-xs text-gray-500">
                              <Thermometer className="h-3 w-3" />
                              {step.temperature}
                            </span>
                          )}
                        </div>
                      )}

                      {step.warnings && (
                        <div className="flex items-center gap-1.5 mt-1.5">
                          <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                          <span className="text-xs text-amber-600">{step.warnings}</span>
                        </div>
                      )}

                      {step.notes && (
                        <p className="text-xs text-gray-400 italic mt-1">{step.notes}</p>
                      )}

                      {hasDeviation && !isDeviationFormOpen && (
                        <div className="mt-2 pl-3 border-l-2 border-amber-300">
                          <p className="text-xs font-medium text-amber-700">
                            Deviation: <span className="font-normal">{deviation.actual_value}</span>
                          </p>
                          <p className="text-xs text-amber-600 mt-0.5">
                            Reason: <span className="font-normal">{deviation.reason}</span>
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {isDeviationFormOpen && !readOnly && (
                  <div className="px-4 py-3 bg-amber-50/50 border-t border-amber-100">
                    <div className="ml-10 space-y-3">
                      <div>
                        <label className="block text-xs font-medium text-gray-500 mb-1">Original</label>
                        <textarea
                          value={step.instruction}
                          readOnly
                          rows={2}
                          className="w-full text-sm border border-gray-200 rounded-md px-3 py-1.5 bg-gray-50 text-gray-500 resize-none"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-500 mb-1">Actual</label>
                        <textarea
                          value={deviationForm.actual_value}
                          onChange={(e) =>
                            setDeviationForm((prev) => ({ ...prev, actual_value: e.target.value }))
                          }
                          rows={2}
                          placeholder="What actually happened..."
                          className="w-full text-sm border border-gray-200 rounded-md px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent resize-none"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-500 mb-1">Reason</label>
                        <textarea
                          value={deviationForm.reason}
                          onChange={(e) =>
                            setDeviationForm((prev) => ({ ...prev, reason: e.target.value }))
                          }
                          rows={2}
                          placeholder="Why the deviation occurred..."
                          className="w-full text-sm border border-gray-200 rounded-md px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent resize-none"
                        />
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleSaveDeviation();
                          }}
                          className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 bg-amber-600 text-white rounded-md hover:bg-amber-700"
                        >
                          <Check className="h-3.5 w-3.5" />
                          Save
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleCancelDeviation();
                          }}
                          className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 bg-white text-gray-700 border border-gray-200 rounded-md hover:bg-gray-50"
                        >
                          <X className="h-3.5 w-3.5" />
                          Cancel
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
