import { useState, useRef } from 'react';
import { Upload, File, Download, X, RefreshCw, Loader2 } from 'lucide-react';
import { uploadFile, getSignedUrl, deleteFile } from '@/lib/storage';

interface AttachmentContent {
  filename: string;
  displayName: string;
  mimeType: string;
  fileSize: number;
  storagePath: string;
  url: string;
  caption: string;
}

const DEFAULT_CONTENT: AttachmentContent = {
  filename: '',
  displayName: '',
  mimeType: '',
  fileSize: 0,
  storagePath: '',
  url: '',
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
  block: { content: any };
  onUpdate: (content: any) => void;
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
      // Delete old file if replacing
      if (data.storagePath) {
        await deleteFile(data.storagePath).catch(() => {});
      }

      const { path, url } = await uploadFile(workspaceId, experimentId, file);
      onUpdate({
        ...data,
        filename: file.name,
        displayName: file.name,
        mimeType: file.type || 'application/octet-stream',
        fileSize: file.size,
        storagePath: path,
        url,
      });
    } catch (err: any) {
      setError(err.message || 'Upload failed');
    } finally {
      setUploading(false);
    }
  }

  async function handleDownload() {
    if (data.storagePath) {
      try {
        const url = await getSignedUrl(data.storagePath);
        window.open(url, '_blank');
      } catch {
        if (data.url) window.open(data.url, '_blank');
      }
    } else if (data.url) {
      window.open(data.url, '_blank');
    }
  }

  async function handleRemove() {
    if (data.storagePath) {
      await deleteFile(data.storagePath).catch(() => {});
    }
    onUpdate(DEFAULT_CONTENT);
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }

  if (!data.url && !data.storagePath) {
    return (
      <div
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        onClick={() => !readOnly && !uploading && fileInputRef.current?.click()}
        className={`flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-8 transition-colors ${
          uploading ? 'pointer-events-none' : 'cursor-pointer'
        } ${
          isDragging ? 'border-blue-400 bg-blue-50' : 'border-gray-300 bg-gray-50 hover:border-gray-400'
        } ${readOnly ? 'pointer-events-none opacity-60' : ''}`}
      >
        {uploading ? (
          <>
            <Loader2 className="h-8 w-8 text-blue-500 animate-spin" />
            <p className="text-sm text-gray-500">Uploading...</p>
          </>
        ) : (
          <>
            <Upload className="h-8 w-8 text-gray-400" />
            <p className="text-sm text-gray-500">Drop a file here or click to upload</p>
            <p className="text-xs text-gray-400">Any file type accepted</p>
          </>
        )}
        {error && <p className="text-xs text-red-500">{error}</p>}
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
          }}
        />
      </div>
    );
  }

  const typeLabel = getFileIcon(data.mimeType);

  return (
    <div className="rounded-lg border border-gray-200 bg-white">
      <div className="flex items-center gap-3 p-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-gray-100 text-xs font-bold text-gray-500">
          {typeLabel}
        </div>
        <div className="flex-1 min-w-0">
          <p className="truncate text-sm font-medium text-gray-900">{data.displayName || data.filename}</p>
          <p className="text-xs text-gray-500">
            {data.mimeType} &middot; {formatFileSize(data.fileSize)}
          </p>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={handleDownload}
            className="rounded p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
            title="Download"
          >
            <Download className="h-4 w-4" />
          </button>
          {!readOnly && (
            <>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="rounded p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                title="Replace file"
                disabled={uploading}
              >
                {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              </button>
              <button
                onClick={handleRemove}
                className="rounded p-1.5 text-gray-400 hover:bg-gray-100 hover:text-red-500"
                title="Remove"
              >
                <X className="h-4 w-4" />
              </button>
            </>
          )}
        </div>
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
          }}
        />
      </div>
      {error && (
        <div className="border-t border-red-100 px-3 py-1.5">
          <p className="text-xs text-red-500">{error}</p>
        </div>
      )}
      {!readOnly ? (
        <div className="border-t border-gray-100 px-3 py-2">
          <input
            type="text"
            value={data.caption}
            onChange={(e) => onUpdate({ ...data, caption: e.target.value })}
            placeholder="Add a caption..."
            className="w-full text-xs text-gray-600 bg-transparent outline-none placeholder:text-gray-400"
          />
        </div>
      ) : data.caption ? (
        <div className="border-t border-gray-100 px-3 py-2">
          <p className="text-xs text-gray-600 italic">{data.caption}</p>
        </div>
      ) : null}
    </div>
  );
}
