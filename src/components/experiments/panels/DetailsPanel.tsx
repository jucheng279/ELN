import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { Tag as TagIcon } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useExperimentStore } from '@/stores/experimentStore';
import StatusBadge from '@/components/common/StatusBadge';
import type { ExperimentContributor, ExperimentProtocol } from '@/lib/types';

// ── Helpers ──────────────────────────────────────

function DetailRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-2 py-1.5">
      <span className="shrink-0 text-xs text-gray-500">{label}</span>
      <span className="text-right text-xs text-gray-900">{children}</span>
    </div>
  );
}

// ── Component ────────────────────────────────────

export default function DetailsPanel() {
  const { currentExperiment } = useExperimentStore();
  const [contributors, setContributors] = useState<ExperimentContributor[]>([]);
  const [protocols, setProtocols] = useState<ExperimentProtocol[]>([]);

  useEffect(() => {
    if (!currentExperiment) return;

    // Fetch contributors
    supabase
      .from('experiment_contributors')
      .select('*, profile:profiles(*)')
      .eq('experiment_id', currentExperiment.id)
      .then(({ data }) =>
        setContributors((data ?? []) as ExperimentContributor[]),
      );

    // Fetch protocols used in this experiment
    supabase
      .from('experiment_protocols')
      .select('*, protocol:protocols(id, name)')
      .eq('experiment_id', currentExperiment.id)
      .then(({ data }) =>
        setProtocols((data ?? []) as ExperimentProtocol[]),
      );
  }, [currentExperiment?.id]);

  if (!currentExperiment) {
    return (
      <div className="p-4 text-center text-sm text-gray-400">
        No experiment selected
      </div>
    );
  }

  const exp = currentExperiment;

  return (
    <div className="space-y-3 p-3">
      {/* Metadata section */}
      <div className="divide-y divide-gray-100 rounded-md bg-gray-50 px-3 py-1">
        <DetailRow label="Notebook">
          {exp.notebook?.name ?? '—'}
        </DetailRow>
        {exp.folder_id && (
          <DetailRow label="Folder">{exp.folder_id}</DetailRow>
        )}
        <DetailRow label="Owner">
          {exp.created_by_profile?.display_name ?? '—'}
        </DetailRow>
        <DetailRow label="Experiment date">
          {format(new Date(exp.experiment_date), 'MMM d, yyyy')}
        </DetailRow>
        <DetailRow label="Created">
          {format(new Date(exp.created_at), 'MMM d, yyyy')}
        </DetailRow>
        <DetailRow label="Last modified">
          {format(new Date(exp.updated_at), 'MMM d, yyyy, h:mm a')}
        </DetailRow>
        <DetailRow label="Revision">{exp.current_revision}</DetailRow>
        <DetailRow label="Status">
          <StatusBadge status={exp.status} />
        </DetailRow>
      </div>

      {/* Contributors */}
      {contributors.length > 0 && (
        <div className="rounded-md bg-gray-50 px-3 py-2">
          <p className="mb-1.5 text-xs font-medium text-gray-500">
            Contributors
          </p>
          <div className="space-y-1">
            {contributors.map((c) => (
              <div
                key={c.id}
                className="flex items-center justify-between text-xs"
              >
                <span className="text-gray-900">
                  {c.profile?.display_name ?? '—'}
                </span>
                <span className="capitalize text-gray-400">{c.role}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Protocols */}
      {protocols.length > 0 && (
        <div className="rounded-md bg-gray-50 px-3 py-2">
          <p className="mb-1.5 text-xs font-medium text-gray-500">
            Protocols
          </p>
          <div className="space-y-1">
            {protocols.map((p) => (
              <div key={p.id} className="text-xs text-gray-900">
                {p.protocol?.name ?? 'Unknown protocol'}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Template provenance */}
      {exp.template_id && (
        <div className="rounded-md bg-gray-50 px-3 py-2">
          <p className="mb-0.5 text-xs font-medium text-gray-500">
            Template
          </p>
          <p className="text-xs text-gray-900">
            Created from template
          </p>
        </div>
      )}

      {/* Tags */}
      {exp.tags && exp.tags.length > 0 && (
        <div className="rounded-md bg-gray-50 px-3 py-2">
          <p className="mb-1.5 text-xs font-medium text-gray-500">Tags</p>
          <div className="flex flex-wrap gap-1">
            {exp.tags.map((tag) => (
              <span
                key={tag.id}
                className="inline-flex items-center gap-1 rounded-full bg-white px-2 py-0.5 text-xs text-gray-700 ring-1 ring-inset ring-gray-200"
              >
                <TagIcon size={10} className="text-gray-400" />
                {tag.name}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
