import { useState } from 'react';
import { useExperimentStore } from '@/stores/experimentStore';
import { blocksPlainText } from '@/lib/blockText';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { toast } from 'sonner';

interface SaveConflictDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function SaveConflictDialog({ open, onOpenChange }: SaveConflictDialogProps) {
  const [confirming, setConfirming] = useState(false);
  const [reloading, setReloading] = useState(false);
  const unsavedBlocks = open ? useExperimentStore.getState().getUnsavedBlocks() : [];
  const count = unsavedBlocks.length;

  const handleOpenChange = (next: boolean) => {
    if (!next) setConfirming(false);
    onOpenChange(next);
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(blocksPlainText(unsavedBlocks));
      toast.success('Your unsaved text was copied to the clipboard');
    } catch {
      toast.error('Could not copy to the clipboard');
    }
  };

  const handleDiscard = async () => {
    setReloading(true);
    try {
      await useExperimentStore.getState().discardAndReload();
      handleOpenChange(false);
      toast.success('Loaded the latest version');
    } finally {
      setReloading(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogContent>
        {confirming ? (
          <>
            <AlertDialogHeader>
              <AlertDialogTitle>Discard your unsaved edits?</AlertDialogTitle>
              <AlertDialogDescription>
                Your changes to {count} {count === 1 ? 'block' : 'blocks'} will be permanently lost and
                replaced with the latest saved version. This cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogAction variant="outline" onClick={() => setConfirming(false)} disabled={reloading}>
                Back
              </AlertDialogAction>
              <AlertDialogAction variant="destructive" onClick={() => void handleDiscard()} disabled={reloading}>
                {reloading ? 'Reloading...' : 'Discard and reload'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </>
        ) : (
          <>
            <AlertDialogHeader>
              <AlertDialogTitle>Changed elsewhere</AlertDialogTitle>
              <AlertDialogDescription>
                Someone else saved changes to this experiment while you were editing.{' '}
                {count === 1 ? '1 block has' : `${count} blocks have`} unsaved edits that could not be
                saved. Copy your text before loading the latest version.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction variant="outline" onClick={() => void handleCopy()} disabled={count === 0}>
                Copy my unsaved text
              </AlertDialogAction>
              <AlertDialogAction variant="destructive" onClick={() => setConfirming(true)}>
                Reload latest
              </AlertDialogAction>
            </AlertDialogFooter>
          </>
        )}
      </AlertDialogContent>
    </AlertDialog>
  );
}
