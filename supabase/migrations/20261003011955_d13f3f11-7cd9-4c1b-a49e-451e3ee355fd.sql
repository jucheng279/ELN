-- Cycle 33: optimistic-concurrency rejections used SQLSTATE 40001
-- (serialization_failure). PostgREST automatically retries transactions that
-- fail with 40001, so a stale write was re-executed until the gateway timed out
-- (~125 s, "upstream request timeout") instead of returning a conflict.
-- Re-raise these deliberate conflicts as PT409 (PostgREST maps PTxxx to HTTP xxx;
-- never retried). Bodies are otherwise byte-identical; grants/ownership are kept
-- by CREATE OR REPLACE.
DO $$
DECLARE r record; v_def text; v_new text;
BEGIN
  FOR r IN
    SELECT p.oid, p.proname FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace
      AND p.proname IN ('approve_experiment','delete_experiment_block','request_experiment_changes',
                        'resubmit_for_review','sign_and_lock_experiment','update_experiment_metadata',
                        'upsert_experiment_blocks')
  LOOP
    v_def := pg_get_functiondef(r.oid);
    v_new := replace(replace(v_def, 'ERRCODE = ''40001''', 'ERRCODE = ''PT409'''),
                     'ERRCODE = ''serialization_failure''', 'ERRCODE = ''PT409''');
    IF v_new = v_def THEN
      RAISE EXCEPTION 'Cycle 33: expected conflict ERRCODE not found in %', r.proname;
    END IF;
    EXECUTE v_new;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
             AND (p.prosrc ILIKE '%''40001''%' OR p.prosrc ILIKE '%serialization_failure%')) THEN
    RAISE EXCEPTION 'Cycle 33: a public function still raises 40001';
  END IF;
END $$;
