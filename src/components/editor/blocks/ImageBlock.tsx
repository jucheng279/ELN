import { useState, useCallback, useRef, DragEvent, ChangeEvent } from 'react';
import { Upload, X, Image as ImageIcon } from 'lucide-react';

interface ImageContent {
  url: string;
  caption: string;
  alt: string;
  filename: string;
  fileSize: number;
}

interface ImageBlockProps {
  content: ImageContent;
  onUpdate: (content: ImageContent) => void;
  readOnly: boolean;
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export default function ImageBlock({ content, onUpdate, readOnly }: ImageBlockProps) {
  const { url, caption, alt, filename, fileSize } = content;
  const [isDragging, setIsDragging] = useState(false);
  const [isHovering, setIsHovering] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const processFile = useCallback(
    (file: File) => {
      if (!file.type.startsWith('image/')) return;

      const reader = new FileReader();
      reader.onload = (e) => {
        const dataUrl = e.target?.result as string;
        onUpdate({
          ...content,
          url: dataUrl,
          filename: file.name,
          fileSize: file.size,
        });
      };
      reader.readAsDataURL(file);
    },
    [content, onUpdate]
  );

  const handleDragOver = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      if (!readOnly) setIsDragging(true);
    },
    [readOnly]
  );

  const handleDragLeave = useCallback((e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);
      if (readOnly) return;

      const file = e.dataTransfer.files?.[0];
      if (file) processFile(file);
    },
    [readOnly, processFile]
  );

  const handleFileSelect = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) processFile(file);
      // Reset input so the same file can be re-selected
      e.target.value = '';
    },
    [processFile]
  );

  const handleClick = useCallback(() => {
    if (!readOnly) fileInputRef.current?.click();
  }, [readOnly]);

  const removeImage = useCallback(() => {
    onUpdate({ ...content, url: '', filename: '', fileSize: 0 });
  }, [content, onUpdate]);

  // --- No image: upload area ---
  if (!url) {
    if (readOnly) {
      return (
        <div className="flex items-center justify-center rounded-lg border border-dashed border-gray-200 bg-gray-50 p-8">
          <div className="text-center text-gray-400">
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
        className={`flex items-center justify-center rounded-lg border-2 border-dashed p-8 cursor-pointer transition-colors ${
          isDragging
            ? 'border-blue-400 bg-blue-50'
            : 'border-gray-300 bg-gray-50 hover:border-gray-400 hover:bg-gray-100'
        }`}
      >
        <div className="text-center">
          <Upload
            className={`w-10 h-10 mx-auto mb-3 ${
              isDragging ? 'text-blue-500' : 'text-gray-400'
            }`}
          />
          <p className="text-sm font-medium text-gray-600">
            Drop an image here or click to upload
          </p>
          <p className="text-xs text-gray-400 mt-1">
            Supports JPG, PNG, GIF, WebP, SVG
          </p>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleFileSelect}
          className="hidden"
        />
      </div>
    );
  }

  // --- Image exists ---
  return (
    <div className="w-full">
      {/* Image container */}
      <div
        className="relative rounded-lg overflow-hidden bg-gray-100"
        onMouseEnter={() => setIsHovering(true)}
        onMouseLeave={() => setIsHovering(false)}
      >
        <img
          src={url}
          alt={alt || filename || 'Uploaded image'}
          className="w-full max-h-[500px] object-contain"
        />

        {/* Hover overlay */}
        {!readOnly && isHovering && (
          <div className="absolute inset-0 bg-black/40 flex items-center justify-center gap-3 transition-opacity">
            <button
              onClick={(e) => {
                e.stopPropagation();
                fileInputRef.current?.click();
              }}
              className="px-3 py-1.5 text-xs font-medium text-white bg-white/20 hover:bg-white/30 rounded-md backdrop-blur-sm transition-colors"
            >
              Replace
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                removeImage();
              }}
              className="p-1.5 text-white bg-white/20 hover:bg-red-500/80 rounded-md backdrop-blur-sm transition-colors"
              title="Remove image"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleFileSelect}
          className="hidden"
        />
      </div>

      {/* File info */}
      {filename && (
        <div className="mt-1.5 text-xs text-gray-400">
          {filename} · {formatFileSize(fileSize)}
        </div>
      )}

      {/* Caption */}
      {readOnly ? (
        caption && (
          <p className="mt-2 text-sm text-gray-500 italic">{caption}</p>
        )
      ) : (
        <input
          value={caption}
          onChange={(e) => onUpdate({ ...content, caption: e.target.value })}
          placeholder="Add a caption..."
          className="mt-2 w-full text-sm text-gray-500 bg-transparent border-none outline-none placeholder:text-gray-300 focus:placeholder:text-gray-400"
        />
      )}

      {/* Alt text */}
      {readOnly ? (
        alt && (
          <p className="mt-1 text-xs text-gray-400">Alt: {alt}</p>
        )
      ) : (
        <input
          value={alt}
          onChange={(e) => onUpdate({ ...content, alt: e.target.value })}
          placeholder="Alt text for accessibility"
          className="mt-1 w-full text-xs text-gray-400 bg-transparent border-none outline-none placeholder:text-gray-300 focus:placeholder:text-gray-400"
        />
      )}
    </div>
  );
}
