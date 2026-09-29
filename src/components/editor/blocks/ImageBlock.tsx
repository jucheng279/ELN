import { useState, useCallback, useRef, useEffect, DragEvent, ChangeEvent } from 'react';
import { Upload, X, Image as ImageIcon, Loader2, Shield } from 'lucide-react';
import { uploadFile, replaceFile, getSignedUrl } from '@/lib/storage';
import type { ImageContent } from '@/lib/types';

interface ImageBlockProps {
  content: ImageContent;
  onUpdate: (content: ImageContent) => void;
  readOnly: boolean;
  workspaceId?: string;
  experimentId?: string;
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function checksumFingerprint(checksum: string | undefined): string | null {
  if (!checksum || checksum.length < 12) return null;
  return `${checksum.slice(0, 6)}...${checksum.slice(-4)}`;
}

export default function ImageBlock({ content, onUpdate, readOnly, workspaceId, experimentId }: ImageBlockProps) {
  const { caption, alt, filename, fileSize, storagePath, attachmentId } = content;
  const [isDragging, setIsDragging] = useState(false);
  const [isHovering, setIsHovering] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resolvedUrl, setResolvedUrl] = useState<string>('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const resolveUrl = useCallback(async (path: string) => {
    try {
      const signed = await getSignedUrl(path);
      setResolvedUrl(signed);
    } catch {
      setResolvedUrl('');
    }
  }, []);

  useEffect(() => {
    if (storagePath) {
      resolveUrl(storagePath);
    }
  }, [storagePath, resolveUrl]);

  const processFile = useCallback(
    async (file: File) => {
      if (!file.type.startsWith('image/')) return;
      if (!workspaceId || !experimentId) {
        setError('Cannot upload: missing context');
        return;
      }

      setUploading(true);
      setError(null);
      try {
        if (attachmentId) {
          const result = await replaceFile(workspaceId, experimentId, attachmentId, file);
          const signed = await getSignedUrl(result.path);
          onUpdate({
            ...content,
            storagePath: result.path,
            attachmentVersionId: result.attachmentVersionId,
            filename: file.name,
            fileSize: file.size,
            versionNumber: result.versionNumber,
            checksum: result.checksum,
          });
          setResolvedUrl(signed);
        } else {
          const result = await uploadFile(workspaceId, experimentId, file);
          const signed = await getSignedUrl(result.path);
          onUpdate({
            ...content,
            storagePath: result.path,
            attachmentId: result.attachmentId,
            attachmentVersionId: result.attachmentVersionId,
            filename: file.name,
            fileSize: file.size,
            versionNumber: 1,
            checksum: result.checksum,
          });
          setResolvedUrl(signed);
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Upload failed';
        setError(message);
      } finally {
        setUploading(false);
      }
    },
    [content, onUpdate, workspaceId, experimentId, attachmentId]
  );

  const handleDragOver = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault(); e.stopPropagation();
    if (!readOnly) setIsDragging(true);
  }, [readOnly]);

  const handleDragLeave = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault(); e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault(); e.stopPropagation();
    setIsDragging(false);
    if (readOnly) return;
    const file = e.dataTransfer.files?.[0];
    if (file) processFile(file);
  }, [readOnly, processFile]);

  const handleFileSelect = useCallback((e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
    e.target.value = '';
  }, [processFile]);

  const handleClick = useCallback(() => {
    if (!readOnly && !uploading) fileInputRef.current?.click();
  }, [readOnly, uploading]);

  const removeImage = useCallback(() => {
    onUpdate({
      ...content,
      filename: '',
      fileSize: 0,
      storagePath: undefined,
      attachmentId: undefined,
      attachmentVersionId: undefined,
      versionNumber: undefined,
      checksum: undefined,
    });
    setResolvedUrl('');
  }, [content, onUpdate]);

  if (!resolvedUrl && !storagePath) {
    if (readOnly) {
      return (
        <div className="flex items-center justify-center rounded-lg border border-dashed border-muted-foreground/25 bg-muted/30 p-8">
          <div className="text-center text-muted-foreground">
            <ImageIcon className="w-10 h-10 mx-auto mb-2 opacity-50" />
            <p className="text-sm">No image</p>
          </div>
        </div>
      );
    }

    return (
      <div
        onClick={handleClick}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`flex items-center justify-center rounded-lg border-2 border-dashed p-8 transition-colors ${
          uploading ? 'pointer-events-none' : 'cursor-pointer'
        } ${isDragging ? 'border-blue-400 bg-blue-50' : 'border-muted-foreground/25 bg-muted/30 hover:border-muted-foreground/40'}`}
      >
        <div className="text-center">
          {uploading ? (
            <><Loader2 className="w-10 h-10 mx-auto mb-3 text-primary animate-spin" /><p className="text-sm font-medium text-muted-foreground">Uploading image...</p></>
          ) : (
            <><Upload className={`w-10 h-10 mx-auto mb-3 ${isDragging ? 'text-blue-500' : 'text-muted-foreground/50'}`} /><p className="text-sm font-medium text-muted-foreground">Drop an image here or click to upload</p><p className="text-xs text-muted-foreground/70 mt-1">Supports JPG, PNG, GIF, WebP, SVG</p></>
          )}
          {error && <p className="text-xs text-destructive mt-2">{error}</p>}
        </div>
        <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFileSelect} className="hidden" />
      </div>
    );
  }

  const fingerprint = checksumFingerprint(content.checksum);

  return (
    <div className="w-full">
      <div
        className="relative rounded-lg overflow-hidden bg-muted"
        onMouseEnter={() => setIsHovering(true)}
        onMouseLeave={() => setIsHovering(false)}
      >
        {resolvedUrl ? (
          <img src={resolvedUrl} alt={alt || filename || 'Uploaded image'} className="w-full max-h-[500px] object-contain" onError={() => { if (storagePath) resolveUrl(storagePath); }} />
        ) : (
          <div className="flex items-center justify-center h-48"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        )}

        {!readOnly && isHovering && (
          <div className="absolute inset-0 bg-black/40 flex items-center justify-center gap-3 transition-opacity">
            <button onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }} className="px-3 py-1.5 text-xs font-medium text-white bg-white/20 hover:bg-white/30 rounded-md backdrop-blur-sm transition-colors">
              Replace
            </button>
            <button onClick={(e) => { e.stopPropagation(); removeImage(); }} className="p-1.5 text-white bg-white/20 hover:bg-red-500/80 rounded-md backdrop-blur-sm transition-colors" title="Remove image">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        <input ref={fileInputRef} type="file" accept="image/*" onChange={handleFileSelect} className="hidden" />
      </div>

      {filename && (
        <div className="mt-1.5 flex items-center gap-1.5 text-xs text-muted-foreground">
          <span>{filename} &middot; {formatFileSize(fileSize)}</span>
          {content.versionNumber && content.versionNumber > 1 && (
            <span className="rounded bg-muted px-1 py-0.5 font-mono text-[10px]">v{content.versionNumber}</span>
          )}
          {fingerprint && (
            <span className="inline-flex items-center gap-0.5 rounded bg-muted px-1 py-0.5 font-mono text-[10px]" title={`SHA-256 ${content.checksum}`}>
              <Shield className="h-2.5 w-2.5" />
              {fingerprint}
            </span>
          )}
        </div>
      )}

      {readOnly ? (
        caption && <p className="mt-2 text-sm text-muted-foreground italic">{caption}</p>
      ) : (
        <input value={caption} onChange={(e) => onUpdate({ ...content, caption: e.target.value })} placeholder="Add a caption..." className="mt-2 w-full text-sm text-muted-foreground bg-transparent border-none outline-none placeholder:text-muted-foreground/40" />
      )}

      {readOnly ? (
        alt && <p className="mt-1 text-xs text-muted-foreground/70">Alt: {alt}</p>
      ) : (
        <input value={alt} onChange={(e) => onUpdate({ ...content, alt: e.target.value })} placeholder="Alt text for accessibility" className="mt-1 w-full text-xs text-muted-foreground/70 bg-transparent border-none outline-none placeholder:text-muted-foreground/40" />
      )}
    </div>
  );
}
