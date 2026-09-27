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
  AlertTriangle,
  Info,
  CheckCircle2,
  FileText,
  Paperclip,
  Image,
  Link2,
  FlaskConical,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useExperimentStore } from '@/stores/experimentStore';
import type { ExperimentRevision, AuditEvent, BlockType } from '@/lib/types';
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
import DOMPurify from 'dompurify';

function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html);
}

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

// ─── Block renderers for snapshot view ────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function SnapshotBlockRenderer({ block }: { block: { type: BlockType; content: any } }) {
  const { type, content } = block;

  if (!content && type !== 'divider') {
    return null;
  }

  switch (type) {
    case 'paragraph':
      return (
        <div
          className="prose prose-sm max-w-none text-foreground dark:prose-invert"
          dangerouslySetInnerHTML={{ __html: sanitizeHtml(content?.html ?? content?.text ?? '') }}
        />
      );

    case 'heading': {
      const level = content?.level ?? 2;
      const text = content?.text ?? '';
      const Tag = (`h${Math.min(Math.max(level, 1), 6)}`) as 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
      const sizes: Record<number, string> = {
        1: 'text-2xl font-bold',
        2: 'text-xl font-semibold',
        3: 'text-lg font-semibold',
        4: 'text-base font-semibold',
        5: 'text-sm font-semibold',
        6: 'text-sm font-medium',
      };
      return <Tag className={cn(sizes[level] ?? sizes[3], 'text-foreground')}>{text}</Tag>;
    }

    case 'list': {
      const items: string[] = content?.items ?? [];
      const ordered = content?.style === 'ordered';
      const ListTag = ordered ? 'ol' : 'ul';
      return (
        <ListTag className={cn('ml-5 space-y-0.5 text-sm text-foreground', ordered ? 'list-decimal' : 'list-disc')}>
          {items.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ListTag>
      );
    }

    case 'checklist': {
      const items: { text: string; checked: boolean }[] = content?.items ?? [];
      return (
        <div className="space-y-1">
          {items.map((item, i) => (
            <div key={i} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={item.checked}
                readOnly
                className="h-3.5 w-3.5 rounded border-muted-foreground/40"
              />
              <span className={cn(item.checked && 'text-muted-foreground line-through')}>
                {item.text}
              </span>
            </div>
          ))}
        </div>
      );
    }

    case 'callout': {
      const calloutType = content?.type ?? 'info';
      const text = content?.text ?? content?.html ?? '';
      const styles: Record<string, { bg: string; border: string; icon: typeof Info }> = {
        info: { bg: 'bg-blue-50 dark:bg-blue-950/30', border: 'border-blue-200 dark:border-blue-800', icon: Info },
        warning: { bg: 'bg-amber-50 dark:bg-amber-950/30', border: 'border-amber-200 dark:border-amber-800', icon: AlertTriangle },
        success: { bg: 'bg-green-50 dark:bg-green-950/30', border: 'border-green-200 dark:border-green-800', icon: CheckCircle2 },
        error: { bg: 'bg-red-50 dark:bg-red-950/30', border: 'border-red-200 dark:border-red-800', icon: AlertTriangle },
      };
      const style = styles[calloutType] ?? styles.info;
      const CalloutIcon = style.icon;
      return (
        <div className={cn('flex gap-2.5 rounded-lg border p-3', style.bg, style.border)}>
          <CalloutIcon className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="prose prose-sm max-w-none text-foreground dark:prose-invert" dangerouslySetInnerHTML={{ __html: sanitizeHtml(text) }} />
        </div>
      );
    }

    case 'table': {
      const html = content?.html;
      if (html) {
        return (
          <div
            className="overflow-x-auto rounded-lg border [&_table]:w-full [&_table]:text-sm [&_td]:border [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:bg-muted [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_th]:font-medium"
            dangerouslySetInnerHTML={{ __html: sanitizeHtml(html) }}
          />
        );
      }
      // Fallback for rows/columns data
      const rows: string[][] = content?.rows ?? [];
      const headers: string[] = content?.headers ?? [];
      return (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            {headers.length > 0 && (
              <thead>
                <tr>
                  {headers.map((h, i) => (
                    <th key={i} className="border-b bg-muted px-2 py-1 text-left font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
            )}
            <tbody>
              {rows.map((row, ri) => (
                <tr key={ri}>
                  {row.map((cell, ci) => (
                    <td key={ci} className="border-b px-2 py-1">{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }

    case 'parameters': {
      const params: { key: string; value: string; unit?: string }[] = content?.parameters ?? content?.items ?? [];
      if (!Array.isArray(params) || params.length === 0) {
        // Fallback: treat content as key-value object
        const entries = Object.entries(content ?? {}).filter(([k]) => k !== 'type');
        if (entries.length === 0) return null;
        return (
          <div className="rounded-lg border bg-muted/30">
            <div className="grid grid-cols-[auto_1fr] text-sm">
              {entries.map(([k, v], i) => (
                <div key={k} className={cn('contents', i > 0 && '[&>*]:border-t')}>
                  <div className="border-r bg-muted/50 px-3 py-1.5 font-medium text-muted-foreground">{k}</div>
                  <div className="px-3 py-1.5">{String(v)}</div>
                </div>
              ))}
            </div>
          </div>
        );
      }
      return (
        <div className="rounded-lg border bg-muted/30">
          <div className="grid grid-cols-[auto_1fr] text-sm">
            {params.map((p, i) => (
              <div key={i} className={cn('contents', i > 0 && '[&>*]:border-t')}>
                <div className="border-r bg-muted/50 px-3 py-1.5 font-medium text-muted-foreground">{p.key}</div>
                <div className="px-3 py-1.5">
                  {p.value}{p.unit ? <span className="ml-1 text-muted-foreground">{p.unit}</span> : null}
                </div>
              </div>
            ))}
          </div>
        </div>
      );
    }

    case 'code': {
      const code = content?.code ?? content?.text ?? '';
      const language = content?.language ?? '';
      return (
        <div className="rounded-lg border bg-zinc-950 dark:bg-zinc-900">
          {language && (
            <div className="border-b border-zinc-800 px-3 py-1 text-xs text-zinc-400">{language}</div>
          )}
          <pre className="overflow-x-auto p-3 text-xs text-zinc-100">
            <code>{code}</code>
          </pre>
        </div>
      );
    }

    case 'divider':
      return <hr className="border-border" />;

    case 'image': {
      const url = content?.url ?? content?.src ?? content?.storagePath ?? '';
      const alt = content?.alt ?? content?.caption ?? '';
      return (
        <div className="space-y-1">
          {url ? (
            <div className="flex items-center gap-2 rounded-lg border bg-muted/30 p-3 text-sm">
              <Image className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="truncate">{alt || url}</span>
            </div>
          ) : (
            <div className="flex items-center gap-2 rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground">
              <Image className="h-4 w-4 shrink-0" />
              <span>Image (no URL recorded)</span>
            </div>
          )}
          {content?.caption && <p className="text-xs text-muted-foreground">{content.caption}</p>}
        </div>
      );
    }

    case 'protocol': {
      const name = content?.name ?? content?.protocol_name ?? 'Unnamed protocol';
      const steps: { instruction?: string; step_number?: number; text?: string }[] = content?.steps ?? [];
      return (
        <div className="rounded-lg border">
          <div className="flex items-center gap-2 border-b bg-muted/50 px-3 py-2 text-sm font-medium">
            <FlaskConical className="h-3.5 w-3.5 text-muted-foreground" />
            {name}
          </div>
          {steps.length > 0 && (
            <ol className="list-decimal space-y-1 py-2 pl-8 pr-3 text-sm">
              {steps.map((s, i) => (
                <li key={i}>{s.instruction ?? s.text ?? `Step ${s.step_number ?? i + 1}`}</li>
              ))}
            </ol>
          )}
        </div>
      );
    }

    case 'attachment': {
      const filename = content?.filename ?? content?.original_filename ?? content?.display_name ?? 'Unknown file';
      const size = content?.file_size;
      return (
        <div className="flex items-center gap-2 rounded-lg border bg-muted/30 p-3 text-sm">
          <Paperclip className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="truncate font-medium">{filename}</span>
          {size != null && (
            <span className="shrink-0 text-xs text-muted-foreground">
              ({formatBytes(size)})
            </span>
          )}
        </div>
      );
    }

    case 'result': {
      const title = content?.title ?? 'Result';
      const text = content?.html ?? content?.text ?? '';
      return (
        <div className="rounded-lg border border-green-200 bg-green-50/50 dark:border-green-900 dark:bg-green-950/20">
          <div className="flex items-center gap-2 border-b border-green-200 px-3 py-2 text-sm font-medium dark:border-green-900">
            <CheckCircle2 className="h-3.5 w-3.5 text-green-600" />
            {title}
          </div>
          {text && (
            <div className="prose prose-sm max-w-none p-3 dark:prose-invert" dangerouslySetInnerHTML={{ __html: sanitizeHtml(text) }} />
          )}
        </div>
      );
    }

    case 'reference': {
      const title = content?.title ?? '';
      const doi = content?.doi ?? '';
      const url = content?.url ?? '';
      const citation = content?.citation ?? '';
      return (
        <div className="flex items-start gap-2 rounded-lg border bg-muted/30 p-3 text-sm">
          <Link2 className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            {title && <div className="font-medium">{title}</div>}
            {citation && <div className="text-xs text-muted-foreground">{citation}</div>}
            {doi && <div className="text-xs text-muted-foreground">DOI: {doi}</div>}
            {url && <div className="truncate text-xs text-blue-600">{url}</div>}
          </div>
        </div>
      );
    }

    case 'related_experiment': {
      const eid = content?.experiment_id ?? content?.id ?? '';
      const title = content?.title ?? '';
      const relation = content?.relation_type ?? '';
      return (
        <div className="flex items-center gap-2 rounded-lg border bg-muted/30 p-3 text-sm">
          <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="font-medium">{eid}</span>
          {title && <span className="text-muted-foreground">— {title}</span>}
          {relation && <Badge variant="secondary" className="ml-auto text-[10px]">{relation}</Badge>}
        </div>
      );
    }

    default:
      return (
        <div className="rounded-lg border border-dashed bg-muted/20 p-3 text-xs text-muted-foreground">
          <span className="font-mono">[{type}]</span> block — no renderer available
        </div>
      );
  }
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

// ─── Snapshot viewer content ────────────────────────────────────────

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
  } = snapshot;

  return (
    <div className="space-y-5">
      {/* Experiment header info */}
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

      {/* Blocks */}
      {blocks.length > 0 && (
        <div className="space-y-3">
          {blocks
            .sort((a: Record<string, unknown>, b: Record<string, unknown>) => {
              if (a.order_key && b.order_key) return (a.order_key as string).localeCompare(b.order_key as string);
              return 0;
            })
            .map((block: Record<string, unknown>, i: number) => (
              <SnapshotBlockRenderer key={(block.id as string) ?? i} block={block as { type: BlockType; content: Record<string, unknown> | null }} />
            ))}
        </div>
      )}

      {blocks.length === 0 && (
        <p className="text-sm italic text-muted-foreground">No content blocks in this snapshot.</p>
      )}

      {/* Protocols section */}
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

      {/* Attachments section */}
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
                  <span className="shrink-0 text-xs text-muted-foreground">({formatBytes(a.file_size as number)})</span>
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
      );
      await fetchRevisions();
    } catch (err) {
      console.error('Failed to create checkpoint:', err);
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
    } catch (err) {
      console.error('Failed to restore revision:', err);
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
                disabled={currentExperiment?.is_locked || restoring}
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
