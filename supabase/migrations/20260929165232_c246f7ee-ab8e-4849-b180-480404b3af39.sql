-- Cycle 2: SECURITY DEFINER least-privilege convergence.
-- 1) Trigger-only functions: never client-callable (triggers fire regardless of EXECUTE).
REVOKE EXECUTE ON FUNCTION public.enforce_block_lock() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enforce_experiment_lock() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enforce_protocol_version_immutability() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enforce_template_version_immutability() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.generate_experiment_id() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_workspace() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.protect_last_owner() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.update_experiment_search() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.validate_experiment_status() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._validate_block_provenance() FROM PUBLIC, anon, authenticated;

-- 2) Internal helpers (called only from owning SECURITY DEFINER functions).
REVOKE EXECUTE ON FUNCTION public._build_experiment_snapshot(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._create_revision_internal(uuid, text, text, uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._clone_attachment_reference(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._rewrite_blocks_for_copy(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;

-- 3) Obsolete overload: short replace_attachment stays non-client-callable.
REVOKE EXECUTE ON FUNCTION public.replace_attachment(uuid, text, bigint, text) FROM PUBLIC, anon, authenticated;

-- 4) No SECURITY DEFINER function in public is callable by PUBLIC or anon.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT p.oid::regprocedure AS sig FROM pg_proc p
           WHERE p.pronamespace = 'public'::regnamespace AND p.prosecdef LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', r.sig);
  END LOOP;
END $$;

-- 5) Explicit authenticated grants: intended client RPCs and RLS policy helpers.
GRANT EXECUTE ON FUNCTION public.accept_invitation(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.add_comment_with_mentions(uuid, uuid, text, uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_experiment(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.archive_attachment(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.archive_experiment_rpc(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.attach_protocol_to_experiment(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_edit_experiment(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_mutate_experiment_content(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_sign_experiment(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.claim_editor_session(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.release_editor_session(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_experiment(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_amendment(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_attachment(uuid, text, text, text, text, bigint, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_checkpoint(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_experiment_rpc(uuid, uuid, text, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_workspace_invitation(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_experiment_block(uuid, uuid, bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_protocol_deviation(uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.duplicate_experiment_rpc(uuid, boolean, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_experiment_capabilities(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_workspace_role(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_workspace_editor(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_workspace_member(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.insert_experiment_block(uuid, text, jsonb, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.publish_protocol_version(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.publish_template_version(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reopen_experiment(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.replace_attachment(uuid, text, bigint, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.request_experiment_changes(uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.restore_experiment_revision(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.restore_experiment_rpc(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resubmit_for_review(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.search_experiments(uuid, text, text, uuid, uuid, date, date, uuid[], text, integer, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sign_and_lock_experiment(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.start_experiment(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_for_review(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_experiment_metadata(uuid, text, date, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_experiment_blocks(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_protocol_deviation(uuid, integer, text, text) TO authenticated;
