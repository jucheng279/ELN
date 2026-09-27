/*
# Strengthen Lifecycle Invariants and FK Integrity (Tasks 4-5)

## Summary
Tightens the experiment lifecycle by:
1. Adding CHECK constraint on experiments.status to restrict to known values
2. Strengthening enforce_experiment_lock to guard content fields by lifecycle status
3. Adding experiment_revision_id FK to reviews and signatures tables
4. Adding indexes on new FK columns

## Security
- No RLS changes; trigger updates are SECURITY DEFINER with empty search_path
*/

-- 1. CHECK constraint on experiment status
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'experiments_status_check'
  ) THEN
    ALTER TABLE public.experiments ADD CONSTRAINT experiments_status_check
      CHECK (status IN ('draft','in_progress','completed','in_review','changes_requested','approved','locked','archived'));
  END IF;
END $$;

-- 2. Strengthen enforce_experiment_lock
CREATE OR REPLACE FUNCTION public.enforce_experiment_lock()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $fn$
BEGIN
  IF OLD.is_locked = true THEN
    IF OLD.title IS DISTINCT FROM NEW.title
       OR OLD.experiment_date IS DISTINCT FROM NEW.experiment_date
       OR OLD.notebook_id IS DISTINCT FROM NEW.notebook_id
       OR OLD.folder_id IS DISTINCT FROM NEW.folder_id
    THEN
      RAISE EXCEPTION 'Cannot modify a locked experiment record';
    END IF;
  END IF;

  IF OLD.status NOT IN ('draft', 'in_progress') 
     AND OLD.status IS NOT DISTINCT FROM NEW.status THEN
    IF OLD.title IS DISTINCT FROM NEW.title
       OR OLD.experiment_date IS DISTINCT FROM NEW.experiment_date
    THEN
      RAISE EXCEPTION 'Cannot modify experiment content outside draft/in_progress status';
    END IF;
  END IF;

  RETURN NEW;
END;
$fn$;

-- 3. Add experiment_revision_id to reviews if missing
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'reviews' AND column_name = 'experiment_revision_id'
  ) THEN
    ALTER TABLE public.reviews ADD COLUMN experiment_revision_id uuid
      REFERENCES public.experiment_revisions(id);
  END IF;
END $$;

-- 4. Add experiment_revision_id to signatures if missing
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'signatures' AND column_name = 'experiment_revision_id'
  ) THEN
    ALTER TABLE public.signatures ADD COLUMN experiment_revision_id uuid
      REFERENCES public.experiment_revisions(id);
  END IF;
END $$;

-- 5. Index the new FK columns
CREATE INDEX IF NOT EXISTS idx_reviews_revision ON public.reviews(experiment_revision_id);
CREATE INDEX IF NOT EXISTS idx_signatures_revision ON public.signatures(experiment_revision_id);
