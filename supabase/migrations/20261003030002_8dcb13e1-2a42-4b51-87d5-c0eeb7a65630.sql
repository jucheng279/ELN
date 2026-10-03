DROP POLICY IF EXISTS "Authorized editors can delete files" ON storage.objects;
CREATE POLICY "Authorized editors can delete unreferenced files" ON storage.objects
FOR DELETE TO authenticated
USING (
  bucket_id = 'eln-files'
  AND (storage.foldername(name))[1] IS NOT NULL
  AND (storage.foldername(name))[2] IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM public.experiments e
    WHERE e.workspace_id = ((storage.foldername(objects.name))[1])::uuid
      AND e.id = ((storage.foldername(objects.name))[2])::uuid
      AND NOT e.is_locked)
  AND public.is_workspace_editor(((storage.foldername(name))[1])::uuid)
  -- Bytes bound to an immutable attachment version are never deletable;
  -- only orphan uploads (failed RPC cleanup) may be removed.
  AND NOT EXISTS (SELECT 1 FROM public.attachment_versions av WHERE av.storage_path = objects.name)
  AND NOT EXISTS (SELECT 1 FROM public.attachments a WHERE a.storage_path = objects.name)
);
