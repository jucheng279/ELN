import { useState, useEffect, useCallback } from 'react';
import { format, formatDistanceToNow } from 'date-fns';
import {
  Send,
  CheckCircle,
  AlertCircle,
  Shield,
  Lock,
  RotateCcw,
  Clock,
  FileCheck,
  PenLine,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useExperimentStore } from '@/stores/experimentStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { useAuthStore } from '@/stores/authStore';
import type { Review, Signature, ExperimentStatus } from '@/lib/types';
import Button from '@/components/common/Button';
import Dialog from '@/components/common/Dialog';
import StatusBadge from '@/components/common/StatusBadge';

// ── Component ────────────────────────────────────

export default function ReviewPanel() {
  const { currentExperiment, updateExperimentStatus, createRevision } =
    useExperimentStore();
  const { members, fetchMembers } = useWorkspaceStore();
  const { user } = useAuthStore();

  const [review, setReview] = useState<Review | null>(null);
  const [signature, setSignature] = useState<Signature | null>(null);
  const [loading, setLoading] = useState(true);

  // Dialog state
  const [showSubmitDialog, setShowSubmitDialog] = useState(false);
  const [showFeedbackDialog, setShowFeedbackDialog] = useState(false);
  const [showSignDialog, setShowSignDialog] = useState(false);
  const [showAmendDialog, setShowAmendDialog] = useState(false);

  // Form state
  const [selectedReviewer, setSelectedReviewer] = useState('');
  const [submitNote, setSubmitNote] = useState('');
  const [feedback, setFeedback] = useState('');
  const [amendReason, setAmendReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchMembers();
  }, [fetchMembers]);

  const fetchReviewData = useCallback(async () => {
    if (!currentExperiment) return;
    setLoading(true);
    try {
      // Fetch latest review
      const { data: reviewData } = await supabase
        .from('reviews')
        .select('*, reviewer:profiles!reviews_reviewer_id_fkey(id, display_name, email)')
        .eq('experiment_id', currentExperiment.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      setReview(reviewData as Review | null);

      // Fetch signature
      const { data: sigData } = await supabase
        .from('signatures')
        .select('*, signer:profiles!signatures_signer_id_fkey(id, display_name)')
        .eq('experiment_id', currentExperiment.id)
        .order('signed_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      setSignature(sigData as Signature | null);
    } catch (err) {
      console.error('Failed to fetch review data:', err);
    } finally {
      setLoading(false);
    }
  }, [currentExperiment?.id]);

  useEffect(() => {
    fetchReviewData();
  }, [fetchReviewData]);

  if (!currentExperiment) return null;

  const exp = currentExperiment;
  const isAuthor = user?.id === exp.created_by;
  const isReviewer = user?.id === review?.reviewer_id;

  // ── Handlers ──────────────────────────────────

  const createAuditEvent = async (eventType: string, metadata?: Record<string, any>) => {
    await supabase.from('audit_events').insert({
      workspace_id: exp.workspace_id,
      object_type: 'experiment',
      object_id: exp.id,
      event_type: eventType,
      actor_id: user!.id,
      revision_number: exp.current_revision,
      metadata: metadata ?? null,
    });
  };

  const createNotification = async (userId: string, title: string, body: string) => {
    await supabase.from('notifications').insert({
      user_id: userId,
      type: 'review',
      title,
      body,
      experiment_id: exp.id,
    });
  };

  // Submit for review
  const handleSubmitForReview = async () => {
    if (!selectedReviewer) return;
    setSubmitting(true);
    setError('');
    try {
      // Create revision checkpoint
      await createRevision(exp.id, 'Submitted for review', 'status_change');

      // Create review record
      const { error: reviewErr } = await supabase.from('reviews').insert({
        experiment_id: exp.id,
        reviewer_id: selectedReviewer,
        revision_number: exp.current_revision + 1,
        status: 'pending',
        comment: submitNote || null,
      });
      if (reviewErr) throw reviewErr;

      // Update status
      await updateExperimentStatus(exp.id, 'in_review');

      // Create audit event
      await createAuditEvent('submitted_for_review', { reviewer_id: selectedReviewer });

      // Notify reviewer
      await createNotification(
        selectedReviewer,
        'Review requested',
        `${exp.experiment_id}: "${exp.title}" has been submitted for your review.`,
      );

      setShowSubmitDialog(false);
      setSelectedReviewer('');
      setSubmitNote('');
      await fetchReviewData();
    } catch (err: any) {
      setError(err?.message ?? 'Failed to submit for review');
    } finally {
      setSubmitting(false);
    }
  };

  // Approve
  const handleApprove = async () => {
    setSubmitting(true);
    setError('');
    try {
      // Update review
      await supabase
        .from('reviews')
        .update({
          status: 'approved',
          reviewed_at: new Date().toISOString(),
        })
        .eq('id', review!.id);

      await updateExperimentStatus(exp.id, 'approved');
      await createRevision(exp.id, 'Review approved', 'approval');
      await createAuditEvent('review_approved');

      // Notify author
      await createNotification(
        exp.created_by,
        'Experiment approved',
        `${exp.experiment_id}: "${exp.title}" has been approved.`,
      );

      await fetchReviewData();
    } catch (err: any) {
      setError(err?.message ?? 'Failed to approve');
    } finally {
      setSubmitting(false);
    }
  };

  // Request changes
  const handleRequestChanges = async () => {
    if (!feedback.trim()) return;
    setSubmitting(true);
    setError('');
    try {
      await supabase
        .from('reviews')
        .update({
          status: 'changes_requested',
          comment: feedback.trim(),
          reviewed_at: new Date().toISOString(),
        })
        .eq('id', review!.id);

      await updateExperimentStatus(exp.id, 'changes_requested');
      await createRevision(exp.id, 'Changes requested', 'status_change');
      await createAuditEvent('changes_requested');

      await createNotification(
        exp.created_by,
        'Changes requested',
        `Reviewer requested changes on ${exp.experiment_id}: "${exp.title}".`,
      );

      setShowFeedbackDialog(false);
      setFeedback('');
      await fetchReviewData();
    } catch (err: any) {
      setError(err?.message ?? 'Failed to request changes');
    } finally {
      setSubmitting(false);
    }
  };

  // Resubmit
  const handleResubmit = async () => {
    setSubmitting(true);
    setError('');
    try {
      await supabase
        .from('reviews')
        .update({ status: 'pending', comment: null })
        .eq('id', review!.id);

      await updateExperimentStatus(exp.id, 'in_review');
      await createRevision(exp.id, 'Resubmitted for review', 'status_change');
      await createAuditEvent('resubmitted_for_review');

      if (review?.reviewer_id) {
        await createNotification(
          review.reviewer_id,
          'Experiment resubmitted',
          `${exp.experiment_id}: "${exp.title}" has been resubmitted for review.`,
        );
      }

      await fetchReviewData();
    } catch (err: any) {
      setError(err?.message ?? 'Failed to resubmit');
    } finally {
      setSubmitting(false);
    }
  };

  // Sign and lock
  const handleSignAndLock = async () => {
    setSubmitting(true);
    setError('');
    try {
      // Compute content hash for the signature
      const { data: blocks } = await supabase
        .from('experiment_blocks')
        .select('*')
        .eq('experiment_id', exp.id)
        .order('order_key', { ascending: true });

      const snapshotJson = JSON.stringify(blocks ?? []);
      const encoder = new TextEncoder();
      const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(snapshotJson));
      const contentHash = Array.from(new Uint8Array(hashBuffer))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');

      const declaration = `I, the undersigned, certify that this experiment record (revision ${exp.current_revision}) is complete and accurate. This digital signature locks the record from further modification.`;

      const { error: sigErr } = await supabase.from('signatures').insert({
        experiment_id: exp.id,
        signer_id: user!.id,
        revision_number: exp.current_revision,
        content_hash: contentHash,
        declaration,
      });
      if (sigErr) throw sigErr;

      await updateExperimentStatus(exp.id, 'locked');
      await createRevision(exp.id, 'Signed and locked', 'signature');
      await createAuditEvent('signed_and_locked', {
        content_hash: contentHash,
        revision_number: exp.current_revision,
      });

      setShowSignDialog(false);
      await fetchReviewData();
    } catch (err: any) {
      setError(err?.message ?? 'Failed to sign');
    } finally {
      setSubmitting(false);
    }
  };

  // Create amendment
  const handleCreateAmendment = async () => {
    if (!amendReason.trim()) return;
    setSubmitting(true);
    setError('');
    try {
      // Unlock the experiment
      await supabase
        .from('experiments')
        .update({ is_locked: false, status: 'in_progress' as ExperimentStatus })
        .eq('id', exp.id);

      await createRevision(exp.id, `Amendment: ${amendReason.trim()}`, 'edit');
      await createAuditEvent('amendment_created', { reason: amendReason.trim() });

      // Re-fetch to update local state
      await updateExperimentStatus(exp.id, 'in_progress');

      setShowAmendDialog(false);
      setAmendReason('');
      await fetchReviewData();
    } catch (err: any) {
      setError(err?.message ?? 'Failed to create amendment');
    } finally {
      setSubmitting(false);
    }
  };

  // ── Render helpers ────────────────────────────

  if (loading) {
    return (
      <div className="space-y-3 p-3">
        {[1, 2].map((i) => (
          <div key={i} className="animate-pulse rounded-md bg-gray-50 p-3">
            <div className="h-3 w-20 rounded bg-gray-200" />
            <div className="mt-2 h-3 w-full rounded bg-gray-200" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 overflow-auto p-3 space-y-3">
        {/* Current status */}
        <div className="flex items-center gap-2 rounded-md bg-gray-50 px-3 py-2">
          <span className="text-xs text-gray-500">Status</span>
          <StatusBadge status={exp.status} />
        </div>

        {error && (
          <div className="rounded-md bg-red-50 px-3 py-2 text-xs text-red-700">
            {error}
          </div>
        )}

        {/* ── Draft / In Progress / Completed ──── */}
        {['draft', 'in_progress', 'completed'].includes(exp.status) && (
          <div className="rounded-md bg-gray-50 px-3 py-3">
            <p className="text-xs text-gray-500">
              Submit this experiment for peer review when ready.
            </p>
            <div className="mt-2">
              <Button
                variant="primary"
                size="sm"
                fullWidth
                icon={<Send size={13} />}
                onClick={() => setShowSubmitDialog(true)}
              >
                Submit for review
              </Button>
            </div>
          </div>
        )}

        {/* ── In Review ────────────────────────── */}
        {exp.status === 'in_review' && review && (
          <div className="space-y-3">
            <div className="rounded-md bg-gray-50 px-3 py-2 space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-gray-500">Reviewer</span>
                <span className="font-medium text-gray-900">
                  {review.reviewer?.display_name ?? '—'}
                </span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-gray-500">Submitted</span>
                <span className="text-gray-700">
                  {formatDistanceToNow(new Date(review.created_at), { addSuffix: true })}
                </span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-gray-500">Revision</span>
                <span className="font-mono text-gray-700">v{review.revision_number}</span>
              </div>
            </div>

            {isReviewer && (
              <div className="space-y-2">
                <Button
                  variant="primary"
                  size="sm"
                  fullWidth
                  icon={<CheckCircle size={13} />}
                  loading={submitting}
                  onClick={handleApprove}
                >
                  Approve
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  fullWidth
                  icon={<AlertCircle size={13} />}
                  onClick={() => setShowFeedbackDialog(true)}
                >
                  Request changes
                </Button>
              </div>
            )}

            {isAuthor && !isReviewer && (
              <div className="flex items-center gap-2 rounded-md bg-amber-50 px-3 py-2">
                <Clock size={14} className="text-amber-600" />
                <span className="text-xs text-amber-700">
                  Waiting for reviewer's decision
                </span>
              </div>
            )}
          </div>
        )}

        {/* ── Changes Requested ────────────────── */}
        {exp.status === 'changes_requested' && review && (
          <div className="space-y-3">
            <div className="rounded-md bg-orange-50 px-3 py-2">
              <p className="text-xs font-medium text-orange-700">
                Reviewer feedback
              </p>
              <p className="mt-1 whitespace-pre-wrap text-xs text-orange-800">
                {review.comment ?? 'No specific feedback provided.'}
              </p>
              <p className="mt-1.5 text-[10px] text-orange-500">
                {review.reviewer?.display_name} ·{' '}
                {review.reviewed_at
                  ? formatDistanceToNow(new Date(review.reviewed_at), { addSuffix: true })
                  : ''}
              </p>
            </div>

            {isAuthor && (
              <Button
                variant="primary"
                size="sm"
                fullWidth
                icon={<RotateCcw size={13} />}
                loading={submitting}
                onClick={handleResubmit}
              >
                Resubmit for review
              </Button>
            )}
          </div>
        )}

        {/* ── Approved ─────────────────────────── */}
        {exp.status === 'approved' && (
          <div className="space-y-3">
            <div className="rounded-md bg-emerald-50 px-3 py-2">
              <div className="flex items-center gap-1.5">
                <CheckCircle size={13} className="text-emerald-600" />
                <span className="text-xs font-medium text-emerald-700">
                  Approved
                </span>
              </div>
              {review && (
                <p className="mt-1 text-[10px] text-emerald-600">
                  by {review.reviewer?.display_name} ·{' '}
                  {review.reviewed_at
                    ? format(new Date(review.reviewed_at), 'MMM d, yyyy')
                    : ''}
                </p>
              )}
            </div>

            <Button
              variant="primary"
              size="sm"
              fullWidth
              icon={<Shield size={13} />}
              onClick={() => setShowSignDialog(true)}
            >
              Sign and lock
            </Button>
          </div>
        )}

        {/* ── Locked ───────────────────────────── */}
        {exp.status === 'locked' && signature && (
          <div className="space-y-3">
            <div className="rounded-md bg-slate-100 px-3 py-2 space-y-1.5">
              <div className="flex items-center gap-1.5">
                <Lock size={13} className="text-slate-600" />
                <span className="text-xs font-medium text-slate-700">
                  Signed &amp; Locked
                </span>
              </div>
              <div className="divide-y divide-slate-200 text-xs">
                <div className="flex justify-between py-1">
                  <span className="text-slate-500">Signer</span>
                  <span className="text-slate-900">
                    {signature.signer?.display_name ?? '—'}
                  </span>
                </div>
                <div className="flex justify-between py-1">
                  <span className="text-slate-500">Date</span>
                  <span className="text-slate-700">
                    {format(new Date(signature.signed_at), 'MMM d, yyyy h:mm a')}
                  </span>
                </div>
                <div className="flex justify-between py-1">
                  <span className="text-slate-500">Revision</span>
                  <span className="font-mono text-slate-700">
                    v{signature.revision_number}
                  </span>
                </div>
              </div>
              <p className="mt-1 border-t border-slate-200 pt-1.5 text-[10px] italic text-slate-500">
                {signature.declaration}
              </p>
            </div>

            <Button
              variant="secondary"
              size="sm"
              fullWidth
              icon={<PenLine size={13} />}
              onClick={() => setShowAmendDialog(true)}
            >
              Create amendment
            </Button>
          </div>
        )}
      </div>

      {/* ── Dialogs ──────────────────────────────── */}

      {/* Submit for review dialog */}
      {showSubmitDialog && (
        <Dialog
          open={showSubmitDialog}
          onClose={() => setShowSubmitDialog(false)}
          title="Submit for review"
        >
          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Reviewer
              </label>
              <select
                value={selectedReviewer}
                onChange={(e) => setSelectedReviewer(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                <option value="">Select a reviewer</option>
                {members
                  .filter((m) => m.user_id !== user?.id)
                  .map((m) => (
                    <option key={m.user_id} value={m.user_id}>
                      {m.profile?.display_name ?? m.profile?.email ?? 'Unknown'}
                    </option>
                  ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Note (optional)
              </label>
              <textarea
                value={submitNote}
                onChange={(e) => setSubmitNote(e.target.value)}
                rows={3}
                placeholder="Add context for the reviewer..."
                className="w-full resize-none rounded-lg border border-gray-300 px-3 py-2 text-sm placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setShowSubmitDialog(false)}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                size="sm"
                loading={submitting}
                disabled={!selectedReviewer}
                icon={<Send size={13} />}
                onClick={handleSubmitForReview}
              >
                Submit
              </Button>
            </div>
          </div>
        </Dialog>
      )}

      {/* Request changes dialog */}
      {showFeedbackDialog && (
        <Dialog
          open={showFeedbackDialog}
          onClose={() => setShowFeedbackDialog(false)}
          title="Request changes"
        >
          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Feedback
              </label>
              <textarea
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                rows={4}
                placeholder="Describe what changes are needed..."
                className="w-full resize-none rounded-lg border border-gray-300 px-3 py-2 text-sm placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                autoFocus
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setShowFeedbackDialog(false)}
              >
                Cancel
              </Button>
              <Button
                variant="danger"
                size="sm"
                loading={submitting}
                disabled={!feedback.trim()}
                icon={<AlertCircle size={13} />}
                onClick={handleRequestChanges}
              >
                Request changes
              </Button>
            </div>
          </div>
        </Dialog>
      )}

      {/* Sign dialog */}
      {showSignDialog && (
        <Dialog
          open={showSignDialog}
          onClose={() => setShowSignDialog(false)}
          title="Sign and lock experiment"
        >
          <div className="space-y-4">
            <div className="rounded-md bg-gray-50 p-3">
              <p className="text-sm text-gray-700">
                I, the undersigned, certify that this experiment record
                (revision <strong>v{exp.current_revision}</strong>) is complete and
                accurate. This digital signature locks the record from further
                modification.
              </p>
            </div>
            <div className="rounded-md bg-amber-50 px-3 py-2">
              <p className="text-xs text-amber-700">
                <strong>Warning:</strong> Once signed, this experiment cannot be
                edited without creating a formal amendment.
              </p>
            </div>
            <div className="flex justify-end gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setShowSignDialog(false)}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                size="sm"
                loading={submitting}
                icon={<Shield size={13} />}
                onClick={handleSignAndLock}
              >
                I approve and sign
              </Button>
            </div>
          </div>
        </Dialog>
      )}

      {/* Amendment dialog */}
      {showAmendDialog && (
        <Dialog
          open={showAmendDialog}
          onClose={() => setShowAmendDialog(false)}
          title="Create amendment"
        >
          <div className="space-y-4">
            <p className="text-sm text-gray-600">
              This will unlock the experiment for editing. A new revision will be
              created with the amendment reason recorded in the audit trail.
            </p>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Reason for amendment
              </label>
              <textarea
                value={amendReason}
                onChange={(e) => setAmendReason(e.target.value)}
                rows={3}
                placeholder="Describe why this amendment is needed..."
                className="w-full resize-none rounded-lg border border-gray-300 px-3 py-2 text-sm placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                autoFocus
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setShowAmendDialog(false)}
              >
                Cancel
              </Button>
              <Button
                variant="danger"
                size="sm"
                loading={submitting}
                disabled={!amendReason.trim()}
                icon={<PenLine size={13} />}
                onClick={handleCreateAmendment}
              >
                Create amendment
              </Button>
            </div>
          </div>
        </Dialog>
      )}
    </div>
  );
}
