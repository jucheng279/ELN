import { useState, useCallback, useEffect } from 'react';
import { ClipboardList, Clock, Thermometer, AlertTriangle, Check, X, Search, Loader2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';

interface ProtocolStep {
  step_number: number;
  instruction: string;
  duration: string | null;
  temperature: string | null;
  notes: string | null;
  warnings: string | null;
}

interface Deviation {
  step_index: number;
  original_value: string;
  actual_value: string;
  reason: string;
}

interface ProtocolBlockContent {
  protocol_id: string | null;
  protocol_version_id: string | null;
  protocol_name: string;
  version_number: number;
  steps: ProtocolStep[];
  deviations: Deviation[];
}

interface ProtocolBlockProps {
  content: ProtocolBlockContent;
  onUpdate: (content: ProtocolBlockContent) => void;
  readOnly: boolean;
  workspaceId?: string;
}

interface ProtocolSearchResult {
  id: string;
  name: string;
  description: string | null;
  current_version: number;
}

export default function ProtocolBlock({ content, onUpdate, readOnly, workspaceId }: ProtocolBlockProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<ProtocolSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [loading, setLoading] = useState(false);
  const [activeDeviationIndex, setActiveDeviationIndex] = useState<number | null>(null);
  const [deviationForm, setDeviationForm] = useState({ actual_value: '', reason: '' });

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
      setLoading(true);
      try {
        const { data: version } = await supabase
          .from('protocol_versions')
          .select('*')
          .eq('protocol_id', protocol.id)
          .eq('version_number', protocol.current_version)
          .maybeSingle();

        const steps: ProtocolStep[] = version?.steps ?? [];

        onUpdate({
          ...content,
          protocol_id: protocol.id,
          protocol_version_id: version?.id ?? null,
          protocol_name: protocol.name,
          version_number: version?.version_number ?? protocol.current_version,
          steps,
          deviations: [],
        });
        setShowSearch(false);
        setSearchQuery('');
      } catch (err) {
        console.error('Failed to load protocol:', err);
      } finally {
        setLoading(false);
      }
    },
    [content, onUpdate]
  );

  const getDeviationForStep = useCallback(
    (stepIndex: number): Deviation | undefined => {
      return content.deviations?.find((d) => d.step_index === stepIndex);
    },
    [content.deviations]
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

  const handleSaveDeviation = useCallback(() => {
    if (activeDeviationIndex === null) return;
    const step = content.steps[activeDeviationIndex];
    if (!step) return;

    const existingDeviations = content.deviations ?? [];
    const filtered = existingDeviations.filter((d) => d.step_index !== activeDeviationIndex);
    const newDeviation: Deviation = {
      step_index: activeDeviationIndex,
      original_value: step.instruction,
      actual_value: deviationForm.actual_value,
      reason: deviationForm.reason,
    };

    onUpdate({
      ...content,
      deviations: [...filtered, newDeviation],
    });
    setActiveDeviationIndex(null);
    setDeviationForm({ actual_value: '', reason: '' });
  }, [activeDeviationIndex, content, deviationForm, onUpdate]);

  const handleCancelDeviation = useCallback(() => {
    setActiveDeviationIndex(null);
    setDeviationForm({ actual_value: '', reason: '' });
  }, []);

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
        {!readOnly && (
          <button
            onClick={() => onUpdate({ ...content, protocol_id: null, protocol_version_id: null, protocol_name: '', version_number: 0, steps: [], deviations: [] })}
            className="ml-auto text-xs text-gray-400 hover:text-red-500"
          >
            Remove
          </button>
        )}
      </div>

      {content.steps.length === 0 ? (
        <div className="px-4 py-6 text-center">
          <p className="text-sm text-gray-400">This protocol has no steps defined yet.</p>
        </div>
      ) : (
        <div className="divide-y divide-gray-100">
          {content.steps.map((step, index) => {
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
