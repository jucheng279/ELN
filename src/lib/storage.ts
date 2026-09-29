import { supabase } from '@/lib/supabase';
import { computeSha256 } from '@/lib/crypto';

const BUCKET = 'eln-files';

export interface UploadResult {
  path: string;
  attachmentId: string;
  attachmentVersionId: string;
  versionNumber: number;
  checksum: string;
}

export interface ReplaceResult {
  path: string;
  attachmentVersionId: string;
  versionNumber: number;
  checksum: string;
}

export async function uploadFile(
  workspaceId: string,
  experimentId: string,
  file: File
): Promise<UploadResult> {
  const checksum = await computeSha256(file);

  const timestamp = Date.now();
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const path = `${workspaceId}/${experimentId}/${timestamp}_${safeName}`;

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, { cacheControl: '3600', upsert: false });
  if (uploadError) throw uploadError;

  const { data, error: rpcError } = await supabase.rpc('create_attachment', {
    p_experiment_id: experimentId,
    p_original_filename: file.name,
    p_display_name: file.name,
    p_storage_path: path,
    p_mime_type: file.type || 'application/octet-stream',
    p_file_size: file.size,
    p_checksum: checksum,
  });
  if (rpcError) {
    await supabase.storage.from(BUCKET).remove([path]).catch(() => {});
    throw rpcError;
  }

  const result = data as Record<string, unknown>;
  return {
    path,
    attachmentId: result.attachment_id as string,
    attachmentVersionId: (result.attachment_version_id ?? result.version_id) as string,
    versionNumber: 1,
    checksum,
  };
}

export async function replaceFile(
  workspaceId: string,
  experimentId: string,
  attachmentId: string,
  file: File
): Promise<ReplaceResult> {
  const checksum = await computeSha256(file);

  const timestamp = Date.now();
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const path = `${workspaceId}/${experimentId}/${timestamp}_${safeName}`;

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, { cacheControl: '3600', upsert: false });
  if (uploadError) throw uploadError;

  const { data, error: rpcError } = await supabase.rpc('replace_attachment', {
    p_attachment_id: attachmentId,
    p_storage_path: path,
    p_file_size: file.size,
    p_checksum: checksum,
    p_original_filename: file.name,
    p_display_name: file.name,
    p_mime_type: file.type || 'application/octet-stream',
  });
  if (rpcError) {
    await supabase.storage.from(BUCKET).remove([path]).catch(() => {});
    throw rpcError;
  }

  const result = data as Record<string, unknown>;
  return {
    path,
    attachmentVersionId: (result.attachment_version_id ?? result.version_id) as string,
    versionNumber: result.version_number as number,
    checksum,
  };
}

export async function archiveAttachment(attachmentId: string): Promise<void> {
  const { error } = await supabase.rpc('archive_attachment', {
    p_attachment_id: attachmentId,
  });
  if (error) throw error;
}

export async function getSignedUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(path, 3600);
  if (error) throw error;
  return data.signedUrl;
}
