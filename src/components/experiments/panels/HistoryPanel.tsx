import { useState, useEffect, useCallback } from 'react';
import { formatDistanceToNow, format } from 'date-fns';
import {
  History,
  GitBranch,
  Plus,
  PenLine,
  Shield,
  Eye,
  Loader2,
  Calendar,
  Tag,
  ChevronDown,
  RotateCcw,
  Hash,
  Paperclip,
  FlaskConical,
} from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/lib/supabase';
import { useExperimentStore } from '@/stores/experimentStore';
import { useExperimentCapabilities } from '@/hooks/useExperimentCapabilities';
import type { ExperimentRevision, AuditEvent, BlockType, BlockContent } from '@/lib/types';
import ReadonlyBlockRenderer, { type ProvenanceContext } from '@/components/editor/ReadonlyBlockRenderer';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from '@/components/ui/collapsible';
import EmptyState from '@/components/eln/EmptyState';
import { cn } from '@/lib/utils';

const PAGE_SIZE = 20;

const CHANGE_TYPE_CONFIG: Record<
  string,
  { icon: typeof PenLine; label: string; className: string }
> = {
  created: {
    icon: Plus,
    label: 'Created',
    className: 'text-green-600 bg-green-50',
  },
  edit: {
    icon: PenLine,
    label: 'Edited',
    className: 'text-blue-600 bg-blue-50',
  },
  status_change: {
    icon: GitBranch,
    label: 'Status changed',
    className: 'text-amber-600 bg-amber-50',
  },
  approval: {
    icon: Shield,
    label: 'Approved',
    className: 'text-emerald-600 bg-emerald-50',
  },
  signature: {
    icon: Shield,
    label: 'Signed',
    className: 'text-sky-600 bg-sky-50',
  },
  checkpoint: {
    icon: History,
    label: 'Checkpoint',
    className: 'text-muted-foreground bg-muted',
  },
};

const STATUS_STYLES: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-700',
  in_progress: 'bg-blue-100 text-blue-700',
  completed: 'bg-green-100 text-green-700',
  in_review: 'bg-amber-100 text-amber-700',
  changes_requested: 'bg-orange-100 text-orange-700',
  approved: 'bg-emerald-100 text-emerald-700',
  locked: 'bg-red-100 text-red-700',
  archived: 'bg-gray-100 text-gray-500',
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function SnapshotViewer({ snapshot }: { snapshot: any }) {
  if (!snapshot) {
    return <p className="text-sm text-muted-foreground">No snapshot data available.</p>;
  }

  const {
    experiment_id,
    title,
    status,
    experiment_date,
    blocks = [],
    tags = [],
    protocols = [],
    attachments = [],
    attachment_provenance = [],
    protocol_provenance = [],
  } = snapshot;

  const isV2 = attachment_provenance.length > 0 || protocol_provenance.length > 0;

  const provenanceContext: ProvenanceContext | undefined = isV2
    ? {
        attachmentProvenance: attachment_provenance,
        protocolProvenance: protocol_provenance,
      }
    : undefined;

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        {title && (
          <h2 className="text-xl font-semibold text-foreground">{title}</h2>
        )}

        <div className="flex flex-wrap items-center gap-2 text-sm">
          {experiment_id && (
            <Badge variant="outline" className="font-mono text-xs">
              {experiment_id}
            </Badge>
          )}
          {status && (
            <Badge
              variant="secondary"
              className={cn('text-xs', STATUS_STYLES[status])}
            >
              {status.replace(/_/g, ' ')}
            </Badge>
          )}
          {experiment_date && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Calendar className="h-3 w-3" />
              {format(new Date(experiment_date), 'MMM d, yyyy')}
            </span>
          )}
          {isV2 && (
            <Badge variant="outline" className="text-[10px] font-mono border-green-300 text-green-700">
              Provenance V2
            </Badge>
          )}
        </div>

        {tags.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <Tag className="h-3 w-3 text-muted-foreground" />
            {tags.map((tag: Record<string, unknown> | string, i: number) => {
              const name = typeof tag === 'string' ? tag : String(tag?.name ?? tag?.id ?? '');
              return (
                <Badge key={i} variant="secondary" className="text-[10px]">
                  {name}
                </Badge>
              );
            })}
          </div>
        )}
      </div>

      <Separator />

      {blocks.length > 0 && (
        <div className="space-y-3">
          {blocks
            .sort((a: Record<string, unknown>, b: Record<string, unknown>) => {
              if (a.order_key && b.order_key) return (a.order_key as string).localeCompare(b.order_key as string);
              return 0;
            })
            .map((block: Record<string, unknown>, i: number) => (
              <ReadonlyBlockRenderer
                key={(block.id as string) ?? i}
                type={block.type as BlockType}
                content={(block.content ?? {}) as BlockContent}
                provenanceContext={
                  provenanceContext
                    ? { ...provenanceContext, blockId: block.id as string }
                    : undefined
                }
              />
            ))}
        </div>
      )}

      {blocks.length === 0 && (
        <p className="text-sm italic text-muted-foreground">No content blocks in this snapshot.</p>
      )}

      {protocols.length > 0 && (
        <>
          <Separator />
          <div className="space-y-2">
            <h3 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
              <FlaskConical className="h-3.5 w-3.5" />
              Protocols
            </h3>
            {protocols.map((p: Record<string, unknown>, i: number) => (
              <div key={i} className="rounded-lg border bg-muted/30 p-3 text-sm">
                <div className="font-medium">{(p.name as string) ?? ((p.protocol as Record<string, unknown>)?.name as string) ?? `Protocol ${i + 1}`}</div>
                {p.version_number != null && (
                  <div className="text-xs text-muted-foreground">Version {String(p.version_number)}</div>
                )}
              </div>
            ))}
          </div>
        </>
      )}

      {attachments.length > 0 && (
        <>
          <Separator />
          <div className="space-y-2">
            <h3 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
              <Paperclip className="h-3.5 w-3.5" />
              Attachments
            </h3>
            {attachments.map((a: Record<string, unknown>, i: number) => (
              <div key={i} className="flex items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2 text-sm">
                <Paperclip className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate">{(a.display_name as string) ?? (a.original_filename as string) ?? 'File'}</span>
                {a.file_size != null && (
                  <span className="shrink-0 text-xs text-muted-foreground">({((a.file_size as number) / 1024).toFixed(1)} KB)</span>
                )}
                {a.checksum && (
                  <span className="shrink-0 text-[10px] font-mono text-muted-foreground" title={`SHA-256: ${a.checksum}`}>
                    #{String(a.checksum).slice(0, 6)}
                  </span>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ─── Main component ─────────────────────────────────────────────────

export default function HistoryPanel() {
  const { currentExperiment, createRevision, fetchExperiment } = useExperimentStore();
  const caps = useExperimentCapabilities(currentExperiment);

  const [revisions, setRevisions] = useState<ExperimentRevision[]>([]);
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [loadingRevisions, setLoadingRevisions] = useState(true);
  const [, setLoadingAudit] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [creating, setCreating] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [viewingRevision, setViewingRevision] =
    useState<ExperimentRevision | null>(null);

  const fetchRevisions = useCallback(
    async (offset = 0) => {
      if (!currentExperiment) return;
      setLoadingRevisions(true);
      try {
        const { data, error } = await supabase
          .from('experiment_revisions')
          .select(
            '*, profile:profiles!experiment_revisions_created_by_fkey(id, display_name)',
          )
          .eq('experiment_id', currentExperiment.id)
          .order('created_at', { ascending: false })
          .range(offset, offset + PAGE_SIZE - 1);

        if (error) throw error;

        const fetched = (data ?? []) as ExperimentRevision[];
        if (offset === 0) {
          setRevisions(fetched);
        } else {
          setRevisions((prev) => [...prev, ...fetched]);
        }
        setHasMore(fetched.length === PAGE_SIZE);
      } catch {
        toast.error('Failed to load revisions');
      } finally {
        setLoadingRevisions(false);
      }
    },
    [currentExperiment?.id],
  );

  const fetchAuditEvents = useCallback(async () => {
    if (!currentExperiment) return;
    setLoadingAudit(true);
    try {
      const { data, error } = await supabase
        .from('audit_events')
        .select(
          '*, actor:profiles!audit_events_actor_id_fkey(id, display_name)',
        )
        .eq('object_type', 'experiment')
        .eq('object_id', currentExperiment.id)
        .order('created_at', { ascending: false })
        .limit(20);

      if (error) throw error;
      setAuditEvents((data ?? []) as AuditEvent[]);
    } catch {
      toast.error('Failed to load revisions');
    } finally {
      setLoadingAudit(false);
    }
  }, [currentExperiment?.id]);

  useEffect(() => {
    fetchRevisions();
    fetchAuditEvents();
  }, [fetchRevisions, fetchAuditEvents]);

  const handleCreateCheckpoint = async () => {
    if (!currentExperiment) return;
    setCreating(true);
    try {
      await createRevision(
        currentExperiment.id,
        'Manual checkpoint',
      );
      await fetchRevisions();
      toast.success('Checkpoint created');
    } catch {
      toast.error('Failed to create checkpoint');
    } finally {
      setCreating(false);
    }
  };

  const handleRestore = async () => {
    if (!currentExperiment || !viewingRevision) return;
    setRestoring(true);
    try {
      const { error } = await supabase.rpc('restore_experiment_revision', {
        p_experiment_id: currentExperiment.id,
        p_revision_id: viewingRevision.id,
      });
      if (error) throw error;

      await fetchExperiment(currentExperiment.id);
      await fetchRevisions();
      setViewingRevision(null);
      toast.success('Revision restored');
    } catch {
      toast.error('Failed to restore revision');
    } finally {
      setRestoring(false);
    }
  };

  const getChangeConfig = (changeType: string) =>
    CHANGE_TYPE_CONFIG[changeType] ?? CHANGE_TYPE_CONFIG.edit;

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="border-b p-3">
        <Button
          variant="outline"
          size="sm"
          className="w-full"
          disabled={!caps.canRestoreRevision || creating}
          onClick={handleCreateCheckpoint}
        >
          {creating ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Plus className="h-3.5 w-3.5" />
          )}
          Create checkpoint
        </Button>
      </div>

      <ScrollArea className="flex-1">
        {/* Revisions */}
        <div className="p-3">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Revisions
          </h3>

          {loadingRevisions && revisions.length === 0 && (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="space-y-1.5 rounded-lg p-2">
                  <Skeleton className="h-3 w-20" />
                  <Skeleton className="h-3 w-full" />
                </div>
              ))}
            </div>
          )}

          {!loadingRevisions && revisions.length === 0 && (
            <EmptyState
              icon={History}
              title="No revisions"
              description="Create a checkpoint to save the current state."
              className="py-6"
            />
          )}

          <div className="space-y-1">
            {revisions.map((rev) => {
              const config = getChangeConfig(rev.change_type);
              const Icon = config.icon;

              return (
                <button
                  key={rev.id}
                  onClick={() => setViewingRevision(rev)}
                  className={cn(
                    'group flex w-full items-start gap-2.5 rounded-lg p-2 text-left',
                    'transition-colors hover:bg-muted'
                  )}
                >
                  <div
                    className={cn(
                      'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded',
                      config.className
                    )}
                  >
                    <Icon className="h-3 w-3" />
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="rounded-md bg-muted px-1 py-0.5 font-mono text-[10px] text-muted-foreground">
                        v{rev.revision_number}
                      </span>
                      <span className="text-xs font-medium text-foreground">
                        {config.label}
                      </span>
                    </div>
                    {rev.change_summary && (
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        {rev.change_summary}
                      </p>
                    )}
                    <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-muted-foreground/70">
                      <span>
                        {rev.profile?.display_name ?? 'Unknown'}
                      </span>
                      <span>·</span>
                      <span>
                        {formatDistanceToNow(new Date(rev.created_at), {
                          addSuffix: true,
                        })}
                      </span>
                    </div>
                  </div>

                  <Eye className="mt-1 h-3 w-3 shrink-0 text-muted-foreground/40 opacity-0 group-hover:opacity-100" />
                </button>
              );
            })}
          </div>

          {hasMore && (
            <Button
              variant="ghost"
              size="sm"
              className="mt-2 w-full text-xs"
              onClick={() => fetchRevisions(revisions.length)}
            >
              Load more
            </Button>
          )}
        </div>

        {/* Audit events */}
        {auditEvents.length > 0 && (
          <>
            <Separator />
            <div className="p-3">
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Audit log
              </h3>
              <div className="space-y-1.5">
                {auditEvents.map((event) => (
                  <div
                    key={event.id}
                    className="rounded-lg bg-muted/50 px-2.5 py-1.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-medium text-foreground">
                        {event.event_type.replace(/_/g, ' ')}
                      </span>
                      {event.revision_number !== null && (
                        <Badge
                          variant="secondary"
                          className="font-mono text-[10px]"
                        >
                          v{event.revision_number}
                        </Badge>
                      )}
                    </div>
                    <div className="mt-0.5 text-[10px] text-muted-foreground">
                      {event.actor?.display_name ?? 'System'} ·{' '}
                      {formatDistanceToNow(new Date(event.created_at), {
                        addSuffix: true,
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </ScrollArea>

      {/* Snapshot viewer dialog */}
      <Dialog
        open={!!viewingRevision}
        onOpenChange={(open) => {
          if (!open) setViewingRevision(null);
        }}
      >
        {viewingRevision && (
          <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-4xl">
            <DialogHeader>
              <div className="flex items-center gap-3">
                <DialogTitle>
                  Revision v{viewingRevision.revision_number}
                </DialogTitle>
                <Badge
                  variant="secondary"
                  className={cn(
                    'text-[10px]',
                    getChangeConfig(viewingRevision.change_type).className,
                  )}
                >
                  {getChangeConfig(viewingRevision.change_type).label}
                </Badge>
              </div>
              <div className="flex items-center gap-3 text-sm text-muted-foreground">
                <span>{viewingRevision.profile?.display_name ?? 'Unknown'}</span>
                <span>·</span>
                <span>
                  {format(
                    new Date(viewingRevision.created_at),
                    'MMM d, yyyy h:mm a',
                  )}
                </span>
              </div>
              {viewingRevision.change_summary && (
                <p className="text-sm text-foreground">
                  {viewingRevision.change_summary}
                </p>
              )}
            </DialogHeader>

            <ScrollArea className="min-h-0 flex-1 rounded-lg border bg-background p-5">
              <SnapshotViewer snapshot={viewingRevision.snapshot} />
            </ScrollArea>

            {/* Integrity details (collapsible) */}
            <Collapsible>
              <CollapsibleTrigger className="flex w-full items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground">
                <ChevronDown className="h-3 w-3 transition-transform [[data-open]>&]:rotate-180" />
                <Shield className="h-3 w-3" />
                Integrity details
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="mt-2 rounded-lg bg-muted/50 p-3 text-xs">
                  <div className="flex items-center gap-2">
                    <Hash className="h-3 w-3 text-muted-foreground" />
                    <span className="font-medium text-muted-foreground">Content hash:</span>
                    <code className="break-all font-mono text-foreground/80">
                      {viewingRevision.content_hash}
                    </code>
                  </div>
                </div>
              </CollapsibleContent>
            </Collapsible>

            <DialogFooter>
              <Button
                variant="outline"
                size="sm"
                disabled={!caps.canRestoreRevision || restoring}
                onClick={handleRestore}
              >
                {restoring ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RotateCcw className="h-3.5 w-3.5" />
                )}
                Restore as new revision
              </Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
    </div>
  );
}
