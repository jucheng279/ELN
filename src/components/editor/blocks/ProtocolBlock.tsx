import { useState, useCallback } from 'react';
import { ClipboardList, Clock, Thermometer, AlertTriangle, Plus, Check, X } from 'lucide-react';

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
}

const PLACEHOLDER_STEPS: ProtocolStep[] = [
  { step_number: 1, instruction: 'Prepare reagents and materials', duration: '10 min', temperature: null, notes: null, warnings: null },
  { step_number: 2, instruction: 'Set up equipment according to specifications', duration: '5 min', temperature: null, notes: 'Verify calibration before proceeding', warnings: null },
  { step_number: 3, instruction: 'Begin experimental procedure', duration: '30 min', temperature: '37°C', notes: null, warnings: 'Ensure proper PPE is worn' },
];

export default function ProtocolBlock({ content, onUpdate, readOnly }: ProtocolBlockProps) {
  const [protocolNameInput, setProtocolNameInput] = useState('');
  const [activeDeviationIndex, setActiveDeviationIndex] = useState<number | null>(null);
  const [deviationForm, setDeviationForm] = useState({ actual_value: '', reason: '' });

  const handleSetProtocol = useCallback(() => {
    if (!protocolNameInput.trim()) return;
    onUpdate({
      ...content,
      protocol_name: protocolNameInput.trim(),
      version_number: 1,
      steps: PLACEHOLDER_STEPS,
    });
    setProtocolNameInput('');
  }, [protocolNameInput, content, onUpdate]);

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

  // Empty state - no protocol linked
  if (!content.protocol_name) {
    return (
      <div className="rounded-lg border-2 border-dashed border-gray-300 p-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <ClipboardList className="h-8 w-8 text-gray-400" />
          <p className="text-sm text-gray-500">No protocol linked. Search and attach a protocol.</p>
          {!readOnly && (
            <div className="flex items-center gap-2 w-full max-w-sm">
              <input
                type="text"
                value={protocolNameInput}
                onChange={(e) => setProtocolNameInput(e.target.value)}
                placeholder="Enter protocol name..."
                className="flex-1 text-sm border border-gray-200 rounded-md px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSetProtocol();
                }}
              />
              <button
                onClick={handleSetProtocol}
                disabled={!protocolNameInput.trim()}
                className="text-sm px-3 py-1.5 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Set Protocol
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-gray-200">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-100 bg-gray-50 rounded-t-lg">
        <ClipboardList className="h-4 w-4 text-gray-500" />
        <span className="font-semibold text-gray-900">{content.protocol_name}</span>
        <span className="text-xs bg-gray-100 text-gray-600 rounded px-1.5 py-0.5">
          v{content.version_number}
        </span>
      </div>

      {/* Steps list */}
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
                  {/* Step number circle */}
                  <div className="w-7 h-7 rounded-full bg-blue-100 text-blue-700 text-sm font-medium flex items-center justify-center shrink-0 mt-0.5">
                    {step.step_number}
                  </div>

                  <div className="flex-1 min-w-0">
                    {/* Instruction */}
                    <p className="text-sm text-gray-900">{step.instruction}</p>

                    {/* Metadata badges */}
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

                    {/* Warnings */}
                    {step.warnings && (
                      <div className="flex items-center gap-1.5 mt-1.5">
                        <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                        <span className="text-xs text-amber-600">{step.warnings}</span>
                      </div>
                    )}

                    {/* Notes */}
                    {step.notes && (
                      <p className="text-xs text-gray-400 italic mt-1">{step.notes}</p>
                    )}

                    {/* Existing deviation display */}
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

              {/* Deviation form */}
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
    </div>
  );
}
