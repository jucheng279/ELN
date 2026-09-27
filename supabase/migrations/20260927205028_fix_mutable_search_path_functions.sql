/*
# Fix Mutable Search Path on Legacy Functions (Task 18 - Cleanup)

## Summary
Sets immutable search_path on 4 functions flagged by the security advisor:
- generate_experiment_id
- update_experiment_search
- enforce_protocol_version_immutability
- enforce_template_version_immutability

## Security
- All now have SET search_path TO '' to prevent search_path injection
*/

-- 1. generate_experiment_id
CREATE OR REPLACE FUNCTION public.generate_experiment_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $fn$
DECLARE
  v_num bigint;
BEGIN
  v_num := NEW.experiment_number;
  NEW.experiment_id := 'EXP-' || lpad(v_num::text, 5, '0');
  RETURN NEW;
END;
$fn$;

-- 2. update_experiment_search
CREATE OR REPLACE FUNCTION public.update_experiment_search()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $fn$
BEGIN
  NEW.search_vector := to_tsvector('english',
    coalesce(NEW.title, '') || ' ' || coalesce(NEW.experiment_id, '')
  );
  RETURN NEW;
END;
$fn$;

-- 3. enforce_protocol_version_immutability
CREATE OR REPLACE FUNCTION public.enforce_protocol_version_immutability()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $fn$
BEGIN
  IF OLD.status IN ('published', 'superseded') THEN
    IF OLD.content IS DISTINCT FROM NEW.content
       OR OLD.version_number IS DISTINCT FROM NEW.version_number THEN
      RAISE EXCEPTION 'Cannot modify content of a published or superseded protocol version';
    END IF;
  END IF;
  RETURN NEW;
END;
$fn$;

-- 4. enforce_template_version_immutability
CREATE OR REPLACE FUNCTION public.enforce_template_version_immutability()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $fn$
BEGIN
  IF OLD.status IN ('published', 'superseded') THEN
    IF OLD.content IS DISTINCT FROM NEW.content
       OR OLD.version_number IS DISTINCT FROM NEW.version_number THEN
      RAISE EXCEPTION 'Cannot modify content of a published or superseded template version';
    END IF;
  END IF;
  RETURN NEW;
END;
$fn$;
