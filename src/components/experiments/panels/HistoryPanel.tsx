import { useState, useEffect, useCallback } from 'react';
import { formatDistanceToNow, format } from 'date-fns';
import {
  History,
  GitBranch,
  Plus,
  ChevronDown,
  FileText,
  Shield,
  PenLine,
  Eye,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useExperimentStore } from '@/stores/experimentStore';
import type { ExperimentRevision, AuditEvent } from '@/lib/types';
import Button from '@/components/common/Button';
import Dialog from '@/components/common/Dialog';
import EmptyState from '@/components/common/EmptyState';

// ── Constants ────────────────────────────────────

const PAGE_SIZE = 20;

const CHANGE_TYPE_CONFIG: Record<string, { icon: typeof PenLine; label: string; color: string }> = {
  created: { icon: Plus, label: 'Created', color: 'text-green-600 bg-green-50' },
  edit: { icon: PenLine, label: 'Edited', color: 'text-blue-600 bg-blue-50' },
  status_change: { icon: GitBranch, label: 'Status changed', color: 'text-amber-600 bg-amber-50' },
  approval: { icon: Shield, label: 'Approved', color: 'text-emerald-600 bg-emerald-50' },
  signature: { icon: Shield, label: 'Signed', color: 'text-purple-600 bg-purple-50' },
  checkpoint: { icon: History, label: 'Checkpoint', color: 'text-gray-600 bg-gray-100' },
};

// ── Component ────────────────────────────────────

export default function HistoryPanel() {
  const { currentExperiment, createRevision } = useExperimentStore();

  const [revisions, setRevisions] = useState<ExperimentRevision[]>([]);
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [loadingRevisions, setLoadingRevisions] = useState(true);
  const [loadingAudit, setLoadingAudit] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [creating, setCreating] = useState(false);

  // Snapshot viewer
  const [viewingRevision, setViewingRevision] = useState<ExperimentRevision | null>(null);

  const fetchRevisions = useCallback(
    async (offset = 0) => {
      if (!currentExperiment) return;
      setLoadingRevisions(true);
      try {
        const { data, error } = await supabase
          .from('experiment_revisions')
          .select('*, profile:profiles!experiment_revisions_created_by_fkey(id, display_name)')
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
        .select('*, actor:profiles!audit_events_actor_id_fkey(id, display_name)')
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
      await createRevision(currentExperiment.id, 'Manual checkpoint', 'checkpoint');
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
      <div className="border-b border-gray-200 p-3">
        <Button
          variant="secondary"
          size="sm"
          fullWidth
          loading={creating}
          icon={<Plus size={14} />}
          onClick={handleCreateCheckpoint}
          disabled={currentExperiment?.is_locked}
        >
          Create checkpoint
        </Button>
      </div>

      <div className="flex-1 overflow-auto">
        {/* Revisions timeline */}
        <div className="p-3">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500">
            Revisions
          </h3>

          {loadingRevisions && revisions.length === 0 && (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="animate-pulse rounded bg-gray-50 p-2">
                  <div className="h-3 w-20 rounded bg-gray-200" />
                  <div className="mt-1 h-3 w-full rounded bg-gray-200" />
                </div>
              ))}
            </div>
          )}

          {!loadingRevisions && revisions.length === 0 && (
            <div className="py-6">
              <EmptyState
                icon={<History size={28} />}
                title="No revisions"
                description="Create a checkpoint to save the current state."
              />
            </div>
          )}

          <div className="space-y-1">
            {revisions.map((rev) => {
              const config = getChangeConfig(rev.change_type);
              const Icon = config.icon;

              return (
                <button
                  key={rev.id}
                  onClick={() => setViewingRevision(rev)}
                  className="group flex w-full items-start gap-2.5 rounded-md p-2 text-left transition-colors hover:bg-gray-50"
                >
                  {/* Badge */}
                  <div
                    className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded ${config.color}`}
                  >
                    <Icon size={11} />
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="rounded bg-gray-100 px-1 py-0.5 font-mono text-[10px] text-gray-600">
                        v{rev.revision_number}
                      </span>
                      <span className="text-xs font-medium text-gray-700">
                        {config.label}
                      </span>
                    </div>
                    {rev.change_summary && (
                      <p className="mt-0.5 truncate text-xs text-gray-500">
                        {rev.change_summary}
                      </p>
                    )}
                    <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-gray-400">
                      <span>{rev.profile?.display_name ?? 'Unknown'}</span>
                      <span>·</span>
                      <span>
                        {formatDistanceToNow(new Date(rev.created_at), {
                          addSuffix: true,
                        })}
                      </span>
                    </div>
                  </div>

                  <Eye
                    size={12}
                    className="mt-1 shrink-0 text-gray-300 opacity-0 group-hover:opacity-100"
                  />
                </button>
              );
            })}
          </div>

          {hasMore && (
            <button
              onClick={() => fetchRevisions(revisions.length)}
              className="mt-2 w-full rounded-md py-1.5 text-center text-xs font-medium text-blue-600 hover:bg-blue-50"
            >
              Load more
            </button>
          )}
        </div>

        {/* Audit events */}
        {auditEvents.length > 0 && (
          <div className="border-t border-gray-200 p-3">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500">
              Audit log
            </h3>
            <div className="space-y-1.5">
              {auditEvents.map((event) => (
                <div
                  key={event.id}
                  className="rounded-md bg-gray-50 px-2.5 py-1.5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-gray-700">
                      {event.event_type.replace(/_/g, ' ')}
                    </span>
                    {event.revision_number !== null && (
                      <span className="rounded bg-gray-200 px-1 py-0.5 font-mono text-[10px] text-gray-500">
                        v{event.revision_number}
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 text-[10px] text-gray-400">
                    {event.actor?.display_name ?? 'System'} ·{' '}
                    {formatDistanceToNow(new Date(event.created_at), {
                      addSuffix: true,
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Snapshot viewer dialog */}
      {viewingRevision && (
        <Dialog
          open={!!viewingRevision}
          onClose={() => setViewingRevision(null)}
          title={`Revision v${viewingRevision.revision_number}`}
        >
          <div className="space-y-3">
            <div className="flex items-center gap-3 text-sm text-gray-500">
              <span>{viewingRevision.profile?.display_name ?? 'Unknown'}</span>
              <span>
                {format(new Date(viewingRevision.created_at), 'MMM d, yyyy h:mm a')}
              </span>
            </div>
            {viewingRevision.change_summary && (
              <p className="text-sm text-gray-700">
                {viewingRevision.change_summary}
              </p>
            )}
            <div className="max-h-96 overflow-auto rounded-md bg-gray-50 p-3">
              <pre className="whitespace-pre-wrap text-xs text-gray-700">
                {JSON.stringify(viewingRevision.snapshot, null, 2)}
              </pre>
            </div>
            <p className="text-xs text-gray-400">
              Hash: {viewingRevision.content_hash}
            </p>
          </div>
        </Dialog>
      )}
    </div>
  );
}
