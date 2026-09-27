import { useCallback } from 'react';
import { Plus, X } from 'lucide-react';

interface Parameter {
  name: string;
  value: string;
  unit: string;
  description: string;
}

interface ParameterContent {
  parameters: Parameter[];
}

interface ParameterBlockProps {
  content: ParameterContent;
  onUpdate: (content: ParameterContent) => void;
  readOnly: boolean;
}

export default function ParameterBlock({ content, onUpdate, readOnly }: ParameterBlockProps) {
  const { parameters } = content;

  const updateParameter = useCallback(
    (index: number, field: keyof Parameter, value: string) => {
      const updated = parameters.map((param, i) =>
        i === index ? { ...param, [field]: value } : param
      );
      onUpdate({ ...content, parameters: updated });
    },
    [parameters, content, onUpdate]
  );

  const addParameter = useCallback(() => {
    const newParam: Parameter = { name: '', value: '', unit: '', description: '' };
    onUpdate({ ...content, parameters: [...parameters, newParam] });
  }, [parameters, content, onUpdate]);

  const removeParameter = useCallback(
    (index: number) => {
      const updated = parameters.filter((_, i) => i !== index);
      onUpdate({ ...content, parameters: updated });
    },
    [parameters, content, onUpdate]
  );

  const columns: { key: keyof Parameter; label: string; width: string; placeholder: string }[] = [
    { key: 'name', label: 'Name', width: 'w-1/4', placeholder: 'Parameter name' },
    { key: 'value', label: 'Value', width: 'w-1/5', placeholder: 'Value' },
    { key: 'unit', label: 'Unit', width: 'w-1/6', placeholder: 'Unit' },
    { key: 'description', label: 'Description', width: 'flex-1', placeholder: 'Description' },
  ];

  return (
    <div className="w-full rounded-lg border border-gray-200 overflow-hidden">
      {/* Header */}
      <div className="flex bg-gray-50 border-b border-gray-200">
        {columns.map((col) => (
          <div
            key={col.key}
            className={`${col.width} px-3 py-2 text-xs font-medium uppercase text-gray-500`}
          >
            {col.label}
          </div>
        ))}
        {/* Spacer for remove button */}
        {!readOnly && <div className="w-8" />}
      </div>

      {/* Rows */}
      {parameters.length === 0 && (
        <div className="px-3 py-4 text-sm text-gray-400 text-center">
          No parameters defined.
        </div>
      )}

      {parameters.map((param, index) => (
        <div
          key={index}
          className="flex items-center border-b border-gray-100 last:border-b-0 group"
        >
          {columns.map((col) => (
            <div key={col.key} className={`${col.width} px-3 py-2`}>
              {readOnly ? (
                <span className="text-sm text-gray-800">
                  {param[col.key] || (
                    <span className="text-gray-300">—</span>
                  )}
                </span>
              ) : (
                <input
                  value={param[col.key]}
                  onChange={(e) => updateParameter(index, col.key, e.target.value)}
                  placeholder={col.placeholder}
                  className="w-full text-sm text-gray-800 bg-transparent border-none outline-none placeholder:text-gray-300 focus:placeholder:text-gray-400"
                />
              )}
            </div>
          ))}

          {/* Remove button */}
          {!readOnly && (
            <div className="w-8 flex items-center justify-center">
              <button
                onClick={() => removeParameter(index)}
                className="p-1 text-gray-300 hover:text-red-500 rounded opacity-0 group-hover:opacity-100 transition-opacity"
                title="Remove parameter"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>
      ))}

      {/* Add button */}
      {!readOnly && (
        <div className="border-t border-gray-100">
          <button
            onClick={addParameter}
            className="flex items-center gap-1.5 px-3 py-2 text-xs text-gray-400 hover:text-blue-500 hover:bg-blue-50 transition-colors w-full"
          >
            <Plus className="w-3.5 h-3.5" />
            Add Parameter
          </button>
        </div>
      )}
    </div>
  );
}
