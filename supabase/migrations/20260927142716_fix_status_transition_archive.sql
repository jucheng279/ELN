/*
# Fix status transitions for archive and restore

Allow archiving from all non-archived states (including locked).
Allow restoring archived to draft.
Also allow in_progress -> archived and completed -> archived transitions.
Update the status transition trigger accordingly.
*/

CREATE OR REPLACE FUNCTION public.validate_experiment_status()
RETURNS trigger AS $$
BEGIN
  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;

  CASE OLD.status
    WHEN 'draft' THEN
      IF NEW.status NOT IN ('in_progress', 'archived') THEN
        RAISE EXCEPTION 'Invalid status transition from draft to %', NEW.status;
      END IF;
    WHEN 'in_progress' THEN
      IF NEW.status NOT IN ('completed', 'draft', 'archived') THEN
        RAISE EXCEPTION 'Invalid status transition from in_progress to %', NEW.status;
      END IF;
    WHEN 'completed' THEN
      IF NEW.status NOT IN ('in_review', 'in_progress', 'archived') THEN
        RAISE EXCEPTION 'Invalid status transition from completed to %', NEW.status;
      END IF;
    WHEN 'in_review' THEN
      IF NEW.status NOT IN ('changes_requested', 'approved', 'archived') THEN
        RAISE EXCEPTION 'Invalid status transition from in_review to %', NEW.status;
      END IF;
    WHEN 'changes_requested' THEN
      IF NEW.status NOT IN ('in_review', 'in_progress', 'archived') THEN
        RAISE EXCEPTION 'Invalid status transition from changes_requested to %', NEW.status;
      END IF;
    WHEN 'approved' THEN
      IF NEW.status NOT IN ('locked', 'archived') THEN
        RAISE EXCEPTION 'Invalid status transition from approved to %', NEW.status;
      END IF;
    WHEN 'locked' THEN
      IF NEW.status NOT IN ('archived') THEN
        RAISE EXCEPTION 'Cannot change status of a locked experiment directly';
      END IF;
    WHEN 'archived' THEN
      IF NEW.status NOT IN ('draft') THEN
        RAISE EXCEPTION 'Invalid status transition from archived to %', NEW.status;
      END IF;
    ELSE
      RAISE EXCEPTION 'Unknown experiment status: %', OLD.status;
  END CASE;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';
