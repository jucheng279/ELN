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
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useExperimentStore } from '@/stores/experimentStore';
import type { ExperimentRevision, AuditEvent } from '@/lib/types';
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

export default function HistoryPanel() {
  const { currentExperiment, createRevision } = useExperimentStore();

  const [revisions, setRevisions] = useState<ExperimentRevision[]>([]);
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [loadingRevisions, setLoadingRevisions] = useState(true);
  const [loadingAudit, setLoadingAudit] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [creating, setCreating] = useState(false);
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
      } catch (err) {
        console.error('Failed to fetch revisions:', err);
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
    } catch (err) {
      console.error('Failed to fetch audit events:', err);
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
        'checkpoint',
      );
      await fetchRevisions();
    } catch (err) {
      console.error('Failed to create checkpoint:', err);
    } finally {
      setCreating(false);
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
          disabled={currentExperiment?.is_locked || creating}
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
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>
                Revision v{viewingRevision.revision_number}
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div className="flex items-center gap-3 text-sm text-muted-foreground">
                <span>
                  {viewingRevision.profile?.display_name ?? 'Unknown'}
                </span>
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
              <ScrollArea className="max-h-96 rounded-lg bg-muted p-3">
                <pre className="whitespace-pre-wrap text-xs text-foreground/80">
                  {JSON.stringify(viewingRevision.snapshot, null, 2)}
                </pre>
              </ScrollArea>
              <p className="text-xs text-muted-foreground">
                Hash: {viewingRevision.content_hash}
              </p>
            </div>
            <DialogFooter showCloseButton />
          </DialogContent>
        )}
      </Dialog>
    </div>
  );
}
