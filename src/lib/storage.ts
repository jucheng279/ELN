import { supabase } from '@/lib/supabase';

const BUCKET = 'eln-files';

export async function uploadFile(
  workspaceId: string,
  experimentId: string,
  file: File
): Promise<{ path: string; attachmentId: string; versionId: string }> {
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
  });
  if (rpcError) {
    await supabase.storage.from(BUCKET).remove([path]).catch(() => {});
    throw rpcError;
  }

  return {
    path,
    attachmentId: (data as any).attachment_id,
    versionId: (data as any).version_id,
  };
}

export async function replaceFile(
  workspaceId: string,
  experimentId: string,
  attachmentId: string,
  file: File
): Promise<{ path: string; versionId: string; versionNumber: number }> {
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
  });
  if (rpcError) {
    await supabase.storage.from(BUCKET).remove([path]).catch(() => {});
    throw rpcError;
  }

  return {
    path,
    versionId: (data as any).version_id,
    versionNumber: (data as any).version_number,
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
