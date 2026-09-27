import { useState, useRef } from 'react';
import { Upload, Download, X, RefreshCw, Loader2 } from 'lucide-react';
import { uploadFile, replaceFile, archiveAttachment, getSignedUrl } from '@/lib/storage';
import type { AttachmentContent } from '@/lib/types';

const DEFAULT_CONTENT: AttachmentContent = {
  filename: '',
  displayName: '',
  mimeType: '',
  fileSize: 0,
  storagePath: '',
  attachmentId: '',
  versionNumber: 0,
  caption: '',
};

function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function getFileIcon(mimeType: string): string {
  if (mimeType.startsWith('application/pdf')) return 'PDF';
  if (mimeType.includes('spreadsheet') || mimeType.includes('csv') || mimeType.includes('excel')) return 'XLS';
  if (mimeType.includes('word') || mimeType.includes('document')) return 'DOC';
  if (mimeType.includes('zip') || mimeType.includes('compress')) return 'ZIP';
  if (mimeType.startsWith('text/')) return 'TXT';
  return 'FILE';
}

export default function AttachmentBlock({
  block,
  onUpdate,
  readOnly,
  workspaceId,
  experimentId,
}: {
  block: { content: AttachmentContent };
  onUpdate: (content: AttachmentContent) => void;
  readOnly: boolean;
  workspaceId?: string;
  experimentId?: string;
}) {
  const data: AttachmentContent = { ...DEFAULT_CONTENT, ...block.content };
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: globalThis.File) {
    if (!workspaceId || !experimentId) {
      setError('Cannot upload: missing context');
      return;
    }

    setUploading(true);
    setError(null);
    try {
      if (data.attachmentId) {
        const result = await replaceFile(workspaceId, experimentId, data.attachmentId, file);
        onUpdate({
          ...data,
          filename: file.name,
          displayName: file.name,
          mimeType: file.type || 'application/octet-stream',
          fileSize: file.size,
          storagePath: result.path,
          versionNumber: result.versionNumber,
        });
      } else {
        const result = await uploadFile(workspaceId, experimentId, file);
        onUpdate({
          ...data,
          filename: file.name,
          displayName: file.name,
          mimeType: file.type || 'application/octet-stream',
          fileSize: file.size,
          storagePath: result.path,
          attachmentId: result.attachmentId,
          versionNumber: 1,
        });
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Upload failed';
      setError(message);
    } finally {
      setUploading(false);
    }
  }

  async function handleDownload() {
    if (!data.storagePath) return;
    try {
      const url = await getSignedUrl(data.storagePath);
      window.open(url, '_blank');
    } catch {
      setError('Failed to generate download link');
    }
  }

  async function handleRemove() {
    if (data.attachmentId) {
      try {
        await archiveAttachment(data.attachmentId);
      } catch {
        return;
      }
    }
    onUpdate(DEFAULT_CONTENT);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }

  if (!data.storagePath && !data.attachmentId) {
    return (
      <div
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        onClick={() => !readOnly && !uploading && fileInputRef.current?.click()}
        className={`flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-8 transition-colors ${
          uploading ? 'pointer-events-none' : 'cursor-pointer'
        } ${
          isDragging ? 'border-blue-400 bg-blue-50' : 'border-muted-foreground/25 bg-muted/30 hover:border-muted-foreground/40'
        } ${readOnly ? 'pointer-events-none opacity-60' : ''}`}
      >
        {uploading ? (
          <><Loader2 className="h-8 w-8 text-primary animate-spin" /><p className="text-sm text-muted-foreground">Uploading...</p></>
        ) : (
          <><Upload className="h-8 w-8 text-muted-foreground/50" /><p className="text-sm text-muted-foreground">Drop a file here or click to upload</p></>
        )}
        {error && <p className="text-xs text-destructive">{error}</p>}
        <input ref={fileInputRef} type="file" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
      </div>
    );
  }

  const typeLabel = getFileIcon(data.mimeType);

  return (
    <div className="rounded-lg border border-border bg-background">
      <div className="flex items-center gap-3 px-3 py-2.5">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded bg-muted text-[10px] font-bold text-muted-foreground">
          {typeLabel}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <p className="truncate text-sm font-medium text-foreground">{data.displayName || data.filename}</p>
            {data.versionNumber > 1 && (
              <span className="shrink-0 rounded bg-muted px-1 py-0.5 text-[10px] font-mono text-muted-foreground">v{data.versionNumber}</span>
            )}
          </div>
          <p className="text-xs text-muted-foreground">{formatFileSize(data.fileSize)}</p>
        </div>
        <div className="flex items-center gap-0.5">
          <button onClick={handleDownload} className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground" title="Download">
            <Download className="h-4 w-4" />
          </button>
          {!readOnly && (
            <>
              <button onClick={() => fileInputRef.current?.click()} className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground" title="Replace (new version)" disabled={uploading}>
                {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              </button>
              <button onClick={handleRemove} className="rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-destructive" title="Remove">
                <X className="h-4 w-4" />
              </button>
            </>
          )}
        </div>
        <input ref={fileInputRef} type="file" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
      </div>
      {error && <div className="border-t border-destructive/20 px-3 py-1.5"><p className="text-xs text-destructive">{error}</p></div>}
      {!readOnly ? (
        <div className="border-t border-border px-3 py-2">
          <input type="text" value={data.caption} onChange={(e) => onUpdate({ ...data, caption: e.target.value })} placeholder="Add a caption..." className="w-full text-xs text-muted-foreground bg-transparent outline-none placeholder:text-muted-foreground/50" />
        </div>
      ) : data.caption ? (
        <div className="border-t border-border px-3 py-2"><p className="text-xs text-muted-foreground italic">{data.caption}</p></div>
      ) : null}
    </div>
  );
}
