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
  PenLine,
  Loader2,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useExperimentStore } from '@/stores/experimentStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { useAuthStore } from '@/stores/authStore';
import type { Review, Signature } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import ExperimentStatusBadge from '@/components/eln/ExperimentStatusBadge';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogAction,
  AlertDialogCancel,
} from '@/components/ui/alert-dialog';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

export default function ReviewPanel() {
  const {
    currentExperiment,
    submitForReview,
    approveExperiment,
    requestChanges,
    signAndLock,
    createAmendment,
  } = useExperimentStore();
  const { members, fetchMembers } = useWorkspaceStore();
  const { user } = useAuthStore();

  const [reviews, setReviews] = useState<Review[]>([]);
  const [signature, setSignature] = useState<Signature | null>(null);
  const [loading, setLoading] = useState(true);

  const [showSubmitDialog, setShowSubmitDialog] = useState(false);
  const [showFeedbackDialog, setShowFeedbackDialog] = useState(false);
  const [showApproveDialog, setShowApproveDialog] = useState(false);
  const [showSignDialog, setShowSignDialog] = useState(false);
  const [showAmendDialog, setShowAmendDialog] = useState(false);

  const [selectedReviewer, setSelectedReviewer] = useState('');
  const [feedback, setFeedback] = useState('');
  const [amendReason, setAmendReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetchMembers();
  }, [fetchMembers]);

  const fetchReviewData = useCallback(async () => {
    if (!currentExperiment) return;
    setLoading(true);
    try {
      const { data: reviewData } = await supabase
        .from('reviews')
        .select('*, reviewer:profiles!reviews_reviewer_id_fkey(id, display_name, email)')
        .eq('experiment_id', currentExperiment.id)
        .order('created_at', { ascending: false });
      setReviews((reviewData ?? []) as Review[]);

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
  }, [fetchReviewData, currentExperiment?.status]);

  if (!currentExperiment) return null;

  const exp = currentExperiment;
  const isAuthor = user?.id === exp.created_by;
  const latestReview = reviews[0] ?? null;
  const isReviewer = user?.id === latestReview?.reviewer_id;
  const pendingReview = latestReview?.status === 'pending' ? latestReview : null;

  const runAction = async (fn: () => Promise<unknown>, successMsg: string, cleanup?: () => void) => {
    setSubmitting(true);
    try {
      await fn();
      toast.success(successMsg);
      cleanup?.();
      await fetchReviewData();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Action failed');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmitForReview = () => {
    if (!selectedReviewer) return;
    runAction(
      () => submitForReview(exp.id, selectedReviewer),
      'Submitted for review',
      () => { setShowSubmitDialog(false); setSelectedReviewer(''); }
    );
  };

  const handleApprove = () => {
    if (!pendingReview) return;
    runAction(
      () => approveExperiment(exp.id, pendingReview.id),
      'Experiment approved',
      () => setShowApproveDialog(false)
    );
  };

  const handleRequestChanges = () => {
    if (!feedback.trim() || !pendingReview) return;
    runAction(
      () => requestChanges(exp.id, pendingReview.id, feedback.trim()),
      'Changes requested',
      () => { setShowFeedbackDialog(false); setFeedback(''); }
    );
  };

  const handleResubmit = () => {
    if (!latestReview) return;
    runAction(
      async () => {
        const { error } = await supabase.rpc('resubmit_for_review', {
          p_experiment_id: exp.id,
          p_review_id: latestReview.id,
        });
        if (error) throw error;
        await useExperimentStore.getState().fetchExperiment(exp.id);
      },
      'Resubmitted for review'
    );
  };

  const handleSignAndLock = () => {
    runAction(
      () => signAndLock(exp.id),
      'Experiment signed and locked',
      () => setShowSignDialog(false)
    );
  };

  const handleCreateAmendment = () => {
    if (!amendReason.trim()) return;
    runAction(
      async () => {
        const result = await createAmendment(exp.id, amendReason.trim());
        if (result?.id) {
          window.location.href = `/experiments/${result.id}`;
        }
      },
      'Amendment created — opening new experiment',
      () => { setShowAmendDialog(false); setAmendReason(''); }
    );
  };

  if (loading) {
    return (
      <div className="space-y-3 p-3">
        {[1, 2].map((i) => (
          <div key={i} className="space-y-2 rounded-lg p-3">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-3 w-full" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex-1 space-y-3 overflow-auto p-3">
        {/* Current status */}
        <div className="flex items-center gap-2 rounded-lg bg-muted/50 px-3 py-2">
          <span className="text-xs text-muted-foreground">Status</span>
          <ExperimentStatusBadge status={exp.status} />
        </div>

        {/* Submit for review (completed or changes_requested) */}
        {['completed', 'changes_requested'].includes(exp.status) && isAuthor && (
          <div className="rounded-lg bg-muted/50 px-3 py-3">
            <p className="text-xs text-muted-foreground">
              {exp.status === 'changes_requested'
                ? 'Address the feedback and resubmit for review.'
                : 'Submit this experiment for peer review when ready.'}
            </p>
            <div className="mt-2 space-y-2">
              {exp.status === 'changes_requested' && latestReview && (
                <Button size="sm" className="w-full" disabled={submitting} onClick={handleResubmit}>
                  {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
                  Resubmit to {latestReview.reviewer?.display_name || 'reviewer'}
                </Button>
              )}
              <Button
                size="sm"
                variant={exp.status === 'changes_requested' ? 'outline' : 'default'}
                className="w-full"
                onClick={() => setShowSubmitDialog(true)}
              >
                <Send className="h-3.5 w-3.5" />
                {exp.status === 'changes_requested' ? 'Submit to different reviewer' : 'Submit for review'}
              </Button>
            </div>
          </div>
        )}

        {/* In review */}
        {exp.status === 'in_review' && pendingReview && (
          <div className="space-y-3">
            <div className="divide-y divide-border rounded-lg bg-muted/50 px-3 py-1">
              <div className="flex items-center justify-between py-1.5 text-xs">
                <span className="text-muted-foreground">Reviewer</span>
                <span className="font-medium text-foreground">{pendingReview.reviewer?.display_name ?? '---'}</span>
              </div>
              <div className="flex items-center justify-between py-1.5 text-xs">
                <span className="text-muted-foreground">Submitted</span>
                <span className="text-foreground">{formatDistanceToNow(new Date(pendingReview.created_at), { addSuffix: true })}</span>
              </div>
              <div className="flex items-center justify-between py-1.5 text-xs">
                <span className="text-muted-foreground">Revision</span>
                <span className="font-mono text-foreground">v{pendingReview.revision_number}</span>
              </div>
            </div>

            {isReviewer && (
              <div className="space-y-2">
                <Button size="sm" className="w-full" disabled={submitting} onClick={() => setShowApproveDialog(true)}>
                  <CheckCircle className="h-3.5 w-3.5" /> Approve
                </Button>
                <Button variant="outline" size="sm" className="w-full" onClick={() => setShowFeedbackDialog(true)}>
                  <AlertCircle className="h-3.5 w-3.5" /> Request changes
                </Button>
              </div>
            )}

            {isAuthor && !isReviewer && (
              <div className={cn('flex items-center gap-2 rounded-lg px-3 py-2 bg-amber-50 dark:bg-amber-950/30')}>
                <Clock className="h-3.5 w-3.5 text-amber-600" />
                <span className="text-xs text-amber-700 dark:text-amber-400">Waiting for reviewer's decision</span>
              </div>
            )}
          </div>
        )}

        {/* Approved */}
        {exp.status === 'approved' && (
          <div className="space-y-3">
            <div className={cn('rounded-lg px-3 py-2 bg-emerald-50 dark:bg-emerald-950/30')}>
              <div className="flex items-center gap-1.5">
                <CheckCircle className="h-3.5 w-3.5 text-emerald-600" />
                <span className="text-xs font-medium text-emerald-700 dark:text-emerald-400">Approved</span>
              </div>
              {latestReview && latestReview.status === 'approved' && (
                <p className="mt-1 text-[10px] text-emerald-600">
                  by {latestReview.reviewer?.display_name} · {latestReview.reviewed_at ? format(new Date(latestReview.reviewed_at), 'MMM d, yyyy') : ''}
                </p>
              )}
            </div>
            <Button size="sm" className="w-full" onClick={() => setShowSignDialog(true)}>
              <Shield className="h-3.5 w-3.5" /> Sign and lock
            </Button>
          </div>
        )}

        {/* Locked */}
        {exp.status === 'locked' && signature && (
          <div className="space-y-3">
            <div className="rounded-lg bg-muted px-3 py-2 space-y-1.5">
              <div className="flex items-center gap-1.5">
                <Lock className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-xs font-medium text-foreground">Signed &amp; Locked</span>
              </div>
              <div className="divide-y divide-border text-xs">
                <div className="flex justify-between py-1">
                  <span className="text-muted-foreground">Signer</span>
                  <span className="text-foreground">{signature.signer?.display_name ?? '---'}</span>
                </div>
                <div className="flex justify-between py-1">
                  <span className="text-muted-foreground">Date</span>
                  <span className="text-foreground">{format(new Date(signature.signed_at), 'MMM d, yyyy h:mm a')}</span>
                </div>
                <div className="flex justify-between py-1">
                  <span className="text-muted-foreground">Revision</span>
                  <span className="font-mono text-foreground">v{signature.revision_number}</span>
                </div>
              </div>
              <Separator />
              <p className="pt-1 text-[10px] italic text-muted-foreground">{signature.declaration}</p>
            </div>
            <Button variant="outline" size="sm" className="w-full" onClick={() => setShowAmendDialog(true)}>
              <PenLine className="h-3.5 w-3.5" /> Create amendment
            </Button>
          </div>
        )}

        {/* Review history */}
        {reviews.length > 1 && (
          <>
            <Separator />
            <div>
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Review history</h4>
              <div className="space-y-1.5">
                {reviews.slice(1).map((r) => (
                  <div key={r.id} className="rounded-lg bg-muted/50 px-2.5 py-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium text-foreground capitalize">{r.status.replace(/_/g, ' ')}</span>
                      <span className="font-mono text-muted-foreground text-[10px]">v{r.revision_number}</span>
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                      {r.reviewer?.display_name} · {r.reviewed_at ? formatDistanceToNow(new Date(r.reviewed_at), { addSuffix: true }) : formatDistanceToNow(new Date(r.created_at), { addSuffix: true })}
                    </div>
                    {r.comment && <p className="mt-0.5 text-[10px] text-muted-foreground italic truncate">{r.comment}</p>}
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>

      {/* Submit for review dialog */}
      <Dialog open={showSubmitDialog} onOpenChange={setShowSubmitDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>Submit for review</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Reviewer</Label>
              <Select value={selectedReviewer} onValueChange={(v) => v !== null && setSelectedReviewer(v)}>
                <SelectTrigger className="w-full"><SelectValue placeholder="Select a reviewer" /></SelectTrigger>
                <SelectContent>
                  {members.filter((m) => m.user_id !== user?.id && m.role !== 'guest').map((m) => (
                    <SelectItem key={m.user_id} value={m.user_id}>
                      {m.profile?.display_name ?? m.profile?.email ?? 'Unknown'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setShowSubmitDialog(false)}>Cancel</Button>
            <Button size="sm" disabled={!selectedReviewer || submitting} onClick={handleSubmitForReview}>
              {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />} Submit
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Approve dialog */}
      <AlertDialog open={showApproveDialog} onOpenChange={setShowApproveDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Approve experiment</AlertDialogTitle>
            <AlertDialogDescription>
              You are approving this experiment at revision v{pendingReview?.revision_number ?? exp.current_revision}. The author will be notified.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={submitting} onClick={handleApprove}>
              {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle className="h-3.5 w-3.5" />} Approve
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Request changes dialog */}
      <Dialog open={showFeedbackDialog} onOpenChange={setShowFeedbackDialog}>
        <DialogContent>
          <DialogHeader><DialogTitle>Request changes</DialogTitle></DialogHeader>
          <div className="space-y-1.5">
            <Label>Feedback</Label>
            <Textarea value={feedback} onChange={(e) => setFeedback(e.target.value)} rows={4} placeholder="Describe what changes are needed..." autoFocus />
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setShowFeedbackDialog(false)}>Cancel</Button>
            <Button variant="destructive" size="sm" disabled={!feedback.trim() || submitting} onClick={handleRequestChanges}>
              {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <AlertCircle className="h-3.5 w-3.5" />} Request changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Sign & lock dialog */}
      <AlertDialog open={showSignDialog} onOpenChange={setShowSignDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Sign and lock experiment</AlertDialogTitle>
            <AlertDialogDescription>
              I, the undersigned, certify that this experiment record is complete and accurate. This digital signature locks the record from further modification.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className={cn('rounded-lg px-3 py-2 bg-amber-50 dark:bg-amber-950/30')}>
            <p className="text-xs text-amber-700 dark:text-amber-400">
              <strong>Warning:</strong> Once signed, this experiment cannot be edited without creating a formal amendment.
            </p>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={submitting} onClick={handleSignAndLock}>
              {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Shield className="h-3.5 w-3.5" />} I approve and sign
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Amendment dialog */}
      <AlertDialog open={showAmendDialog} onOpenChange={setShowAmendDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Create amendment</AlertDialogTitle>
            <AlertDialogDescription>
              This will unlock the experiment for editing. The original signed record remains intact. A new revision will track the amendment.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-1.5">
            <Label>Reason for amendment</Label>
            <Textarea value={amendReason} onChange={(e) => setAmendReason(e.target.value)} rows={3} placeholder="Describe why this amendment is needed..." autoFocus />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" disabled={!amendReason.trim() || submitting} onClick={handleCreateAmendment}>
              {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PenLine className="h-3.5 w-3.5" />} Create amendment
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
