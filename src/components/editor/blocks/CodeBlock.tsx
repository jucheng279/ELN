import { useState, useRef, useEffect, useCallback, KeyboardEvent } from 'react';

interface CodeBlockProps {
  content: any;
  onUpdate: (content: any) => void;
  readOnly: boolean;
}

export default function CodeBlock({
  content,
  onUpdate,
  readOnly,
}: CodeBlockProps) {
  const code: string = content?.code || '';
  const language: string = content?.language || '';
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [localCode, setLocalCode] = useState(code);
  const [localLanguage, setLocalLanguage] = useState(language);

  useEffect(() => {
    setLocalCode(code);
  }, [code]);

  useEffect(() => {
    setLocalLanguage(language);
  }, [language]);

  useEffect(() => {
    return () => {
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
      }
    };
  }, []);

  const debouncedUpdate = useCallback(
    (newCode: string, newLanguage: string) => {
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
      }

      debounceTimer.current = setTimeout(() => {
        onUpdate({ code: newCode, language: newLanguage });
      }, 500);
    },
    [onUpdate]
  );

  const handleCodeChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const newCode = e.target.value;
      setLocalCode(newCode);
      debouncedUpdate(newCode, localLanguage);
    },
    [localLanguage, debouncedUpdate]
  );

  const handleLanguageChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const newLanguage = e.target.value;
      setLocalLanguage(newLanguage);
      debouncedUpdate(localCode, newLanguage);
    },
    [localCode, debouncedUpdate]
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Tab') {
        e.preventDefault();
        const textarea = e.currentTarget;
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const newCode =
          localCode.substring(0, start) + '  ' + localCode.substring(end);
        setLocalCode(newCode);
        debouncedUpdate(newCode, localLanguage);

        requestAnimationFrame(() => {
          textarea.selectionStart = start + 2;
          textarea.selectionEnd = start + 2;
        });
      }
    },
    [localCode, localLanguage, debouncedUpdate]
  );

  return (
    <div className="relative">
      <div className="absolute right-3 top-3 z-10">
        <input
          type="text"
          value={localLanguage}
          onChange={handleLanguageChange}
          readOnly={readOnly}
          placeholder="Language"
          className="w-24 rounded bg-gray-800 px-2 py-0.5 text-xs text-gray-400 outline-none placeholder:text-gray-600 focus:text-gray-200"
        />
      </div>
      <textarea
        value={localCode}
        onChange={handleCodeChange}
        onKeyDown={handleKeyDown}
        readOnly={readOnly}
        placeholder="Write your code here..."
        className="min-h-[100px] w-full resize-y rounded-lg bg-gray-900 p-4 pr-32 font-mono text-sm text-gray-100 outline-none placeholder:text-gray-600"
        spellCheck={false}
      />
    </div>
  );
}
