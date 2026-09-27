/*
# Refine experiment lock enforcement trigger

The lock enforcement trigger must allow status transitions (which are
validated by the separate status transition trigger) while blocking
all other content modifications on locked experiments.

Changes:
- Allow status and is_archived changes on locked experiments
- Block title, date, notebook, folder changes on locked experiments
*/

CREATE OR REPLACE FUNCTION public.enforce_experiment_lock()
RETURNS trigger AS $$
BEGIN
  IF OLD.is_locked = true THEN
    -- Always allow status and archive flag changes (validated by status trigger)
    -- Block changes to scientific content metadata
    IF OLD.title IS DISTINCT FROM NEW.title
      OR OLD.experiment_date IS DISTINCT FROM NEW.experiment_date
      OR OLD.notebook_id IS DISTINCT FROM NEW.notebook_id
      OR OLD.folder_id IS DISTINCT FROM NEW.folder_id THEN
      RAISE EXCEPTION 'Cannot modify a locked experiment record';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = '';
