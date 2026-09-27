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
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useExperimentStore } from '@/stores/experimentStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { useAuthStore } from '@/stores/authStore';
import type { CommentThread, Comment, Profile } from '@/lib/types';
import Button from '@/components/common/Button';
import EmptyState from '@/components/common/EmptyState';

// ── Component ────────────────────────────────────

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

  // Mention autocomplete
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

      // Sort comments within each thread by created_at ascending
      const sorted = (data ?? []).map((thread: any) => ({
        ...thread,
        comments: (thread.comments ?? []).sort(
          (a: Comment, b: Comment) =>
            new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
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

  // Mention handling
  const handleTextChange = (
    text: string,
    setter: (val: string) => void,
    source: 'new' | 'reply',
  ) => {
    setter(text);
    setActiveInput(source);

    // Detect @mention
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

  // Extract mentioned user IDs from text
  const extractMentions = (text: string): string[] => {
    const mentioned: string[] = [];
    members.forEach((m) => {
      if (m.profile && text.includes(`@${m.profile.display_name}`)) {
        mentioned.push(m.user_id);
      }
    });
    return mentioned;
  };

  // Create notification for mentioned users
  const createMentionNotifications = async (
    mentionedIds: string[],
    commentText: string,
  ) => {
    if (!currentExperiment || mentionedIds.length === 0) return;
    const notifications = mentionedIds.map((userId) => ({
      user_id: userId,
      type: 'mention',
      title: 'You were mentioned in a comment',
      body: commentText.slice(0, 200),
      experiment_id: currentExperiment.id,
    }));
    await supabase.from('notifications').insert(notifications);
  };

  // Create new thread
  const handleNewComment = async () => {
    if (!newComment.trim() || !currentExperiment || !user) return;
    setSubmitting(true);
    try {
      // Create thread
      const { data: thread, error: threadError } = await supabase
        .from('comment_threads')
        .insert({ experiment_id: currentExperiment.id })
        .select()
        .single();
      if (threadError) throw threadError;

      // Create comment
      const { error: commentError } = await supabase
        .from('comments')
        .insert({
          thread_id: thread.id,
          content: newComment.trim(),
          created_by: user.id,
        });
      if (commentError) throw commentError;

      // Handle mentions
      const mentionedIds = extractMentions(newComment);
      if (mentionedIds.length > 0) {
        const mentionRows = mentionedIds.map((userId) => ({
          comment_id: thread.id,
          mentioned_user_id: userId,
        }));
        await supabase.from('mentions').insert(mentionRows);
        await createMentionNotifications(mentionedIds, newComment.trim());
      }

      setNewComment('');
      await fetchThreads();
    } catch (err) {
      console.error('Failed to create comment:', err);
    } finally {
      setSubmitting(false);
    }
  };

  // Reply to thread
  const handleReply = async (threadId: string) => {
    if (!replyText.trim() || !user) return;
    setSubmitting(true);
    try {
      const { error } = await supabase.from('comments').insert({
        thread_id: threadId,
        content: replyText.trim(),
        created_by: user.id,
      });
      if (error) throw error;

      // Handle mentions
      const mentionedIds = extractMentions(replyText);
      if (mentionedIds.length > 0) {
        await createMentionNotifications(mentionedIds, replyText.trim());
      }

      setReplyText('');
      setReplyingTo(null);
      await fetchThreads();
    } catch (err) {
      console.error('Failed to reply:', err);
    } finally {
      setSubmitting(false);
    }
  };

  // Toggle resolve
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
          <div key={i} className="animate-pulse rounded-md bg-gray-50 p-3">
            <div className="h-3 w-24 rounded bg-gray-200" />
            <div className="mt-2 h-3 w-full rounded bg-gray-200" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* New comment input */}
      <div className="border-b border-gray-200 p-3">
        <div className="relative">
          <textarea
            ref={newCommentRef}
            value={newComment}
            onChange={(e) =>
              handleTextChange(e.target.value, setNewComment, 'new')
            }
            placeholder="Add a comment... (use @ to mention)"
            rows={2}
            className="w-full resize-none rounded-md border border-gray-200 px-3 py-2 text-sm placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          {mentionQuery !== null &&
            mentionResults.length > 0 &&
            activeInput === 'new' && (
              <div className="absolute left-0 right-0 top-full z-10 mt-1 rounded-md border border-gray-200 bg-white py-1 shadow-lg">
                {mentionResults.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => insertMention(p)}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-gray-50"
                  >
                    <AtSign size={12} className="text-gray-400" />
                    <span className="text-gray-900">{p.display_name}</span>
                    <span className="text-xs text-gray-400">{p.email}</span>
                  </button>
                ))}
              </div>
            )}
        </div>
        <div className="mt-1.5 flex justify-end">
          <Button
            variant="primary"
            size="sm"
            loading={submitting && !replyingTo}
            icon={<Send size={12} />}
            onClick={handleNewComment}
            disabled={!newComment.trim()}
          >
            Comment
          </Button>
        </div>
      </div>

      {/* Threads list */}
      <div className="flex-1 overflow-auto">
        {openThreads.length === 0 && resolvedThreads.length === 0 && (
          <div className="py-12">
            <EmptyState
              icon={<MessageSquare size={32} />}
              title="No comments yet"
              description="Start a conversation about this experiment."
            />
          </div>
        )}

        {/* Open threads */}
        <div className="divide-y divide-gray-100">
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
          <div className="border-t border-gray-200">
            <button
              onClick={() => setShowResolved(!showResolved)}
              className="flex w-full items-center gap-1.5 px-3 py-2 text-xs font-medium text-gray-500 hover:bg-gray-50"
            >
              {showResolved ? (
                <ChevronDown size={12} />
              ) : (
                <ChevronRight size={12} />
              )}
              {resolvedThreads.length} resolved{' '}
              {resolvedThreads.length === 1 ? 'comment' : 'comments'}
            </button>
            {showResolved && (
              <div className="divide-y divide-gray-100 opacity-60">
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

// ── Thread card sub-component ────────────────────

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
          className={idx > 0 ? 'mt-2 ml-4 border-l-2 border-gray-100 pl-3' : ''}
        >
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-medium text-gray-900">
              {comment.profile?.display_name ?? 'Unknown'}
            </span>
            <span className="text-xs text-gray-400">
              {formatDistanceToNow(new Date(comment.created_at), {
                addSuffix: true,
              })}
            </span>
          </div>
          <p className="mt-0.5 text-sm text-gray-700 whitespace-pre-wrap">
            {comment.content}
          </p>
        </div>
      ))}

      {/* Actions */}
      <div className="mt-2 flex items-center gap-2">
        <button
          onClick={() => onSetReplyingTo(isReplying ? null : thread.id)}
          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-gray-500 hover:bg-gray-100"
        >
          <Reply size={11} />
          Reply
        </button>
        <button
          onClick={() => onToggleResolve(thread)}
          className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-gray-500 hover:bg-gray-100"
        >
          {thread.is_resolved ? (
            <>
              <CircleDot size={11} />
              Reopen
            </>
          ) : (
            <>
              <CheckCircle2 size={11} />
              Resolve
            </>
          )}
        </button>
      </div>

      {/* Reply input */}
      {isReplying && (
        <div className="relative mt-2 ml-4">
          <textarea
            value={replyText}
            onChange={(e) => onReplyTextChange(e.target.value)}
            placeholder="Write a reply..."
            rows={2}
            className="w-full resize-none rounded-md border border-gray-200 px-2.5 py-1.5 text-sm placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            autoFocus
          />
          {mentionQuery !== null &&
            mentionResults.length > 0 &&
            activeInput === 'reply' && (
              <div className="absolute left-0 right-0 top-full z-10 mt-1 rounded-md border border-gray-200 bg-white py-1 shadow-lg">
                {mentionResults.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => onInsertMention(p)}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-gray-50"
                  >
                    <AtSign size={12} className="text-gray-400" />
                    <span className="text-gray-900">{p.display_name}</span>
                  </button>
                ))}
              </div>
            )}
          <div className="mt-1 flex justify-end">
            <Button
              variant="primary"
              size="sm"
              loading={submitting && isReplying}
              icon={<Send size={12} />}
              onClick={() => onReply(thread.id)}
              disabled={!replyText.trim()}
            >
              Reply
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
