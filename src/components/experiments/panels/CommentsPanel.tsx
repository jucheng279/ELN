import { useState, useEffect, useRef, useCallback } from 'react';
import { formatDistanceToNow } from 'date-fns';
import {
  MessageSquare,
  Reply,
  CheckCircle2,
  CircleDot,
  Send,
  ChevronDown,
  ChevronRight,
  AtSign,
  Loader2,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useExperimentStore } from '@/stores/experimentStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { useAuthStore } from '@/stores/authStore';
import type { CommentThread, Comment, Profile } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import { Skeleton } from '@/components/ui/skeleton';
import EmptyState from '@/components/eln/EmptyState';
import { cn } from '@/lib/utils';

function getInitials(name?: string | null): string {
  if (!name) return '?';
  return name
    .split(' ')
    .map((w) => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

export default function CommentsPanel() {
  const { currentExperiment } = useExperimentStore();
  const { members, fetchMembers } = useWorkspaceStore();
  const { user } = useAuthStore();

  const [threads, setThreads] = useState<CommentThread[]>([]);
  const [loading, setLoading] = useState(true);
  const [newComment, setNewComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');
  const [showResolved, setShowResolved] = useState(false);

  const [mentionQuery, setMentionQuery] = useState<string | null>(null);
  const [mentionResults, setMentionResults] = useState<Profile[]>([]);
  const [activeInput, setActiveInput] = useState<'new' | 'reply'>('new');
  const newCommentRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    fetchMembers();
  }, [fetchMembers]);

  const fetchThreads = useCallback(async () => {
    if (!currentExperiment) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('comment_threads')
        .select(
          '*, comments(*, profile:profiles(id, display_name, avatar_url))',
        )
        .eq('experiment_id', currentExperiment.id)
        .order('created_at', { ascending: false });

      if (error) throw error;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sorted = (data ?? []).map((thread: any) => ({
        ...thread,
        comments: (thread.comments ?? []).sort(
          (a: Comment, b: Comment) =>
            new Date(a.created_at).getTime() -
            new Date(b.created_at).getTime(),
        ),
      })) as CommentThread[];

      setThreads(sorted);
    } catch (err) {
      console.error('Failed to fetch threads:', err);
    } finally {
      setLoading(false);
    }
  }, [currentExperiment?.id]);

  useEffect(() => {
    fetchThreads();
  }, [fetchThreads]);

  const handleTextChange = (
    text: string,
    setter: (val: string) => void,
    source: 'new' | 'reply',
  ) => {
    setter(text);
    setActiveInput(source);

    const match = text.match(/@(\w*)$/);
    if (match) {
      const q = match[1].toLowerCase();
      setMentionQuery(q);
      const filtered = members
        .filter(
          (m) =>
            m.profile &&
            (m.profile.display_name.toLowerCase().includes(q) ||
              m.profile.email.toLowerCase().includes(q)),
        )
        .map((m) => m.profile!)
        .slice(0, 5);
      setMentionResults(filtered);
    } else {
      setMentionQuery(null);
      setMentionResults([]);
    }
  };

  const insertMention = (profile: Profile) => {
    const setter = activeInput === 'new' ? setNewComment : setReplyText;
    const current = activeInput === 'new' ? newComment : replyText;
    const updated = current.replace(/@(\w*)$/, `@${profile.display_name} `);
    setter(updated);
    setMentionQuery(null);
    setMentionResults([]);
  };

  const extractMentions = (text: string): string[] => {
    const mentioned: string[] = [];
    members.forEach((m) => {
      if (m.profile && text.includes(`@${m.profile.display_name}`)) {
        mentioned.push(m.user_id);
      }
    });
    return mentioned;
  };

  const handleNewComment = async () => {
    if (!newComment.trim() || !currentExperiment || !user) return;
    setSubmitting(true);
    try {
      const mentionedIds = extractMentions(newComment);
      const { error } = await supabase.rpc('add_comment_with_mentions', {
        p_experiment_id: currentExperiment.id,
        p_thread_id: null,
        p_content: newComment.trim(),
        p_mentioned_user_ids: mentionedIds,
      });
      if (error) throw error;

      setNewComment('');
      await fetchThreads();
    } catch (err) {
      console.error('Failed to create comment:', err);
    } finally {
      setSubmitting(false);
    }
  };

  const handleReply = async (threadId: string) => {
    if (!replyText.trim() || !currentExperiment || !user) return;
    setSubmitting(true);
    try {
      const mentionedIds = extractMentions(replyText);
      const { error } = await supabase.rpc('add_comment_with_mentions', {
        p_experiment_id: currentExperiment.id,
        p_thread_id: threadId,
        p_content: replyText.trim(),
        p_mentioned_user_ids: mentionedIds,
      });
      if (error) throw error;

      setReplyText('');
      setReplyingTo(null);
      await fetchThreads();
    } catch (err) {
      console.error('Failed to reply:', err);
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleResolve = async (thread: CommentThread) => {
    try {
      const newResolved = !thread.is_resolved;
      await supabase
        .from('comment_threads')
        .update({
          is_resolved: newResolved,
          resolved_by: newResolved ? user?.id : null,
          resolved_at: newResolved ? new Date().toISOString() : null,
        })
        .eq('id', thread.id);
      await fetchThreads();
    } catch (err) {
      console.error('Failed to toggle resolve:', err);
    }
  };

  const openThreads = threads.filter((t) => !t.is_resolved);
  const resolvedThreads = threads.filter((t) => t.is_resolved);

  if (loading) {
    return (
      <div className="space-y-3 p-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="space-y-2 rounded-lg p-3">
            <div className="flex items-center gap-2">
              <Skeleton className="h-6 w-6 rounded-full" />
              <Skeleton className="h-3 w-24" />
            </div>
            <Skeleton className="h-3 w-full" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* New comment form */}
      <div className="border-b p-3">
        <div className="relative">
          <Textarea
            ref={newCommentRef}
            value={newComment}
            onChange={(e) =>
              handleTextChange(e.target.value, setNewComment, 'new')
            }
            placeholder="Add a comment… (use @ to mention)"
            rows={2}
            className="min-h-0 resize-none text-sm"
          />
          {mentionQuery !== null &&
            mentionResults.length > 0 &&
            activeInput === 'new' && (
              <MentionDropdown
                results={mentionResults}
                onSelect={insertMention}
              />
            )}
        </div>
        <div className="mt-1.5 flex justify-end">
          <Button
            size="sm"
            disabled={!newComment.trim() || submitting}
            onClick={handleNewComment}
          >
            {submitting && !replyingTo ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Send className="h-3.5 w-3.5" />
            )}
            Comment
          </Button>
        </div>
      </div>

      {/* Threads */}
      <div className="flex-1 overflow-auto">
        {openThreads.length === 0 && resolvedThreads.length === 0 && (
          <EmptyState
            icon={MessageSquare}
            title="No comments yet"
            description="Start a conversation about this experiment."
            className="py-12"
          />
        )}

        {/* Open threads */}
        <div className="divide-y">
          {openThreads.map((thread) => (
            <ThreadCard
              key={thread.id}
              thread={thread}
              replyingTo={replyingTo}
              replyText={replyText}
              submitting={submitting}
              mentionQuery={mentionQuery}
              mentionResults={mentionResults}
              activeInput={activeInput}
              onSetReplyingTo={setReplyingTo}
              onReplyTextChange={(text) =>
                handleTextChange(text, setReplyText, 'reply')
              }
              onReply={handleReply}
              onToggleResolve={handleToggleResolve}
              onInsertMention={insertMention}
            />
          ))}
        </div>

        {/* Resolved threads */}
        {resolvedThreads.length > 0 && (
          <div className="border-t">
            <button
              onClick={() => setShowResolved(!showResolved)}
              className={cn(
                'flex w-full items-center gap-1.5 px-3 py-2 text-xs font-medium text-muted-foreground',
                'hover:bg-muted transition-colors'
              )}
            >
              {showResolved ? (
                <ChevronDown className="h-3 w-3" />
              ) : (
                <ChevronRight className="h-3 w-3" />
              )}
              {resolvedThreads.length} resolved{' '}
              {resolvedThreads.length === 1 ? 'comment' : 'comments'}
            </button>
            {showResolved && (
              <div className="divide-y opacity-60">
                {resolvedThreads.map((thread) => (
                  <ThreadCard
                    key={thread.id}
                    thread={thread}
                    replyingTo={replyingTo}
                    replyText={replyText}
                    submitting={submitting}
                    mentionQuery={mentionQuery}
                    mentionResults={mentionResults}
                    activeInput={activeInput}
                    onSetReplyingTo={setReplyingTo}
                    onReplyTextChange={(text) =>
                      handleTextChange(text, setReplyText, 'reply')
                    }
                    onReply={handleReply}
                    onToggleResolve={handleToggleResolve}
                    onInsertMention={insertMention}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Mention dropdown ──────────────────────────── */

function MentionDropdown({
  results,
  onSelect,
}: {
  results: Profile[];
  onSelect: (p: Profile) => void;
}) {
  return (
    <div className="absolute left-0 right-0 top-full z-10 mt-1 rounded-lg border bg-popover py-1 shadow-lg">
      {results.map((p) => (
        <button
          key={p.id}
          onClick={() => onSelect(p)}
          className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-muted"
        >
          <AtSign className="h-3 w-3 text-muted-foreground" />
          <span className="text-foreground">{p.display_name}</span>
          <span className="text-xs text-muted-foreground">{p.email}</span>
        </button>
      ))}
    </div>
  );
}

/* ── Thread card ───────────────────────────────── */

interface ThreadCardProps {
  thread: CommentThread;
  replyingTo: string | null;
  replyText: string;
  submitting: boolean;
  mentionQuery: string | null;
  mentionResults: Profile[];
  activeInput: 'new' | 'reply';
  onSetReplyingTo: (id: string | null) => void;
  onReplyTextChange: (text: string) => void;
  onReply: (threadId: string) => void;
  onToggleResolve: (thread: CommentThread) => void;
  onInsertMention: (profile: Profile) => void;
}

function ThreadCard({
  thread,
  replyingTo,
  replyText,
  submitting,
  mentionQuery,
  mentionResults,
  activeInput,
  onSetReplyingTo,
  onReplyTextChange,
  onReply,
  onToggleResolve,
  onInsertMention,
}: ThreadCardProps) {
  const comments = thread.comments ?? [];
  const isReplying = replyingTo === thread.id;

  return (
    <div className="px-3 py-3">
      {comments.map((comment, idx) => (
        <div
          key={comment.id}
          className={cn(idx > 0 && 'mt-2 ml-6 border-l-2 border-border pl-3')}
        >
          <div className="flex items-center gap-2">
            <Avatar size="sm">
              {comment.profile?.avatar_url && (
                <AvatarImage src={comment.profile.avatar_url} />
              )}
              <AvatarFallback>
                {getInitials(comment.profile?.display_name)}
              </AvatarFallback>
            </Avatar>
            <span className="text-xs font-medium text-foreground">
              {comment.profile?.display_name ?? 'Unknown'}
            </span>
            <span className="text-xs text-muted-foreground">
              {formatDistanceToNow(new Date(comment.created_at), {
                addSuffix: true,
              })}
            </span>
          </div>
          <p className="mt-1 ml-8 whitespace-pre-wrap text-sm text-foreground/80">
            {comment.content}
          </p>
        </div>
      ))}

      {/* Actions */}
      <div className="mt-2 flex items-center gap-1">
        <Button
          variant="ghost"
          size="xs"
          className="text-muted-foreground"
          onClick={() => onSetReplyingTo(isReplying ? null : thread.id)}
        >
          <Reply className="h-3 w-3" />
          Reply
        </Button>
        <Button
          variant="ghost"
          size="xs"
          className="text-muted-foreground"
          onClick={() => onToggleResolve(thread)}
        >
          {thread.is_resolved ? (
            <>
              <CircleDot className="h-3 w-3" />
              Reopen
            </>
          ) : (
            <>
              <CheckCircle2 className="h-3 w-3" />
              Resolve
            </>
          )}
        </Button>
      </div>

      {/* Reply input */}
      {isReplying && (
        <div className="relative mt-2 ml-6">
          <Textarea
            value={replyText}
            onChange={(e) => onReplyTextChange(e.target.value)}
            placeholder="Write a reply…"
            rows={2}
            className="min-h-0 resize-none text-sm"
            autoFocus
          />
          {mentionQuery !== null &&
            mentionResults.length > 0 &&
            activeInput === 'reply' && (
              <MentionDropdown
                results={mentionResults}
                onSelect={onInsertMention}
              />
            )}
          <div className="mt-1 flex justify-end">
            <Button
              size="xs"
              disabled={!replyText.trim() || (submitting && isReplying)}
              onClick={() => onReply(thread.id)}
            >
              {submitting && isReplying ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Send className="h-3 w-3" />
              )}
              Reply
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
