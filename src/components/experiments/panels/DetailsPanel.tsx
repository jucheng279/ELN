import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { Tag as TagIcon } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useExperimentStore } from '@/stores/experimentStore';
import ExperimentStatusBadge from '@/components/eln/ExperimentStatusBadge';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import type { ExperimentContributor, ExperimentProtocol } from '@/lib/types';

function DetailRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-2 py-1.5">
      <span className="shrink-0 text-xs text-muted-foreground">{label}</span>
      <span className="text-right text-xs text-foreground">{children}</span>
    </div>
  );
}

export default function DetailsPanel() {
  const { currentExperiment } = useExperimentStore();
  const [contributors, setContributors] = useState<ExperimentContributor[]>([]);
  const [protocols, setProtocols] = useState<ExperimentProtocol[]>([]);

  useEffect(() => {
    if (!currentExperiment) return;

    supabase
      .from('experiment_contributors')
      .select('*, profile:profiles(*)')
      .eq('experiment_id', currentExperiment.id)
      .then(({ data }) =>
        setContributors((data ?? []) as ExperimentContributor[]),
      );

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
      <div className="p-4 text-center text-sm text-muted-foreground">
        No experiment selected
      </div>
    );
  }

  const exp = currentExperiment;

  return (
    <div className="space-y-3 p-3">
      {/* Metadata */}
      <div className="divide-y divide-border rounded-lg bg-muted/50 px-3 py-1">
        <DetailRow label="Notebook">{exp.notebook?.name ?? '—'}</DetailRow>
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
          <ExperimentStatusBadge status={exp.status} />
        </DetailRow>
      </div>

      {/* Contributors */}
      {contributors.length > 0 && (
        <>
          <Separator />
          <div className="px-1">
            <p className="mb-1.5 text-xs font-medium text-muted-foreground">
              Contributors
            </p>
            <div className="space-y-1">
              {contributors.map((c) => (
                <div
                  key={c.id}
                  className="flex items-center justify-between text-xs"
                >
                  <span className="text-foreground">
                    {c.profile?.display_name ?? '—'}
                  </span>
                  <span className="capitalize text-muted-foreground">
                    {c.role}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {/* Protocols */}
      {protocols.length > 0 && (
        <>
          <Separator />
          <div className="px-1">
            <p className="mb-1.5 text-xs font-medium text-muted-foreground">
              Protocols
            </p>
            <div className="space-y-1">
              {protocols.map((p) => (
                <div key={p.id} className="text-xs text-foreground">
                  {p.protocol?.name ?? 'Unknown protocol'}
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {/* Template provenance */}
      {exp.template_id && (
        <>
          <Separator />
          <div className="px-1">
            <p className="mb-0.5 text-xs font-medium text-muted-foreground">
              Template
            </p>
            <p className="text-xs text-foreground">Created from template</p>
          </div>
        </>
      )}

      {/* Tags */}
      {exp.tags && exp.tags.length > 0 && (
        <>
          <Separator />
          <div className="px-1">
            <p className="mb-1.5 text-xs font-medium text-muted-foreground">
              Tags
            </p>
            <div className="flex flex-wrap gap-1">
              {exp.tags.map((tag) => (
                <Badge
                  key={tag.id}
                  variant="outline"
                  className="gap-1 text-xs font-normal"
                >
                  <TagIcon className="h-2.5 w-2.5 text-muted-foreground" />
                  {tag.name}
                </Badge>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
