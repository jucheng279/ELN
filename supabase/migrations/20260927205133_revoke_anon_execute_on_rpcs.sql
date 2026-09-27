/*
# Revoke Anon Execute on SECURITY DEFINER RPCs (Task 18 - Cleanup)

## Summary
Revokes EXECUTE from the anon role on 30 SECURITY DEFINER functions.
Only authenticated users should be able to call these.

## Security
- Closes the advisory: anon role can no longer call domain RPCs
*/

REVOKE EXECUTE ON FUNCTION public.accept_invitation(p_token text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.approve_experiment(p_experiment_id uuid, p_review_id uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.archive_attachment(p_attachment_id uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.archive_experiment_rpc(p_experiment_id uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.can_edit_experiment(p_experiment_id uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.can_mutate_experiment_content(p_experiment_id uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.can_sign_experiment(p_experiment_id uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.claim_editor_session(p_experiment_id uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.complete_experiment(p_experiment_id uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.create_amendment(p_experiment_id uuid, p_reason text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.create_attachment(p_experiment_id uuid, p_original_filename text, p_display_name text, p_storage_path text, p_mime_type text, p_file_size bigint, p_checksum text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.create_experiment_rpc(p_workspace_id uuid, p_notebook_id uuid, p_title text, p_template_version_id uuid, p_folder_id uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.create_revision(p_experiment_id uuid, p_change_summary text, p_change_type text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.delete_experiment_block(p_experiment_id uuid, p_block_id uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.get_workspace_role(ws_id uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.insert_experiment_block(p_experiment_id uuid, p_type text, p_content jsonb, p_order_key text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.is_workspace_editor(ws_id uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.is_workspace_member(ws_id uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.publish_protocol_version(p_protocol_id uuid, p_version_id uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.publish_template_version(p_template_id uuid, p_version_id uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.release_editor_session(p_experiment_id uuid, p_session_id uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.reopen_experiment(p_experiment_id uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.replace_attachment(p_attachment_id uuid, p_storage_path text, p_file_size bigint, p_checksum text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.request_experiment_changes(p_experiment_id uuid, p_review_id uuid, p_comment text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.restore_experiment_rpc(p_experiment_id uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.resubmit_for_review(p_experiment_id uuid, p_review_id uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.sign_and_lock_experiment(p_experiment_id uuid, p_declaration text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.start_experiment(p_experiment_id uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.submit_for_review(p_experiment_id uuid, p_reviewer_id uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.upsert_experiment_blocks(p_experiment_id uuid, p_blocks jsonb) FROM anon;
