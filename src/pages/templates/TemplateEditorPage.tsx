import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Plus,
  Trash2,
  GripVertical,
  Save,
  Upload,
  ChevronDown,
  ChevronUp,
  Clock,
  Check,
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import Button from '@/components/common/Button';
import Input from '@/components/common/Input';
import Tabs from '@/components/common/Tabs';
import type { Template, TemplateVersion, BlockType } from '@/lib/types';

interface BlockDefinition {
  id: string;
  type: BlockType;
  label: string;
  defaultContent: any;
}

const BLOCK_TYPES: { value: BlockType; label: string }[] = [
  { value: 'heading', label: 'Heading' },
  { value: 'paragraph', label: 'Paragraph' },
  { value: 'list', label: 'List' },
  { value: 'checklist', label: 'Checklist' },
  { value: 'callout', label: 'Callout' },
  { value: 'divider', label: 'Divider' },
  { value: 'parameters', label: 'Parameters' },
  { value: 'table', label: 'Table' },
  { value: 'image', label: 'Image' },
  { value: 'attachment', label: 'Attachment' },
  { value: 'protocol', label: 'Protocol' },
  { value: 'result', label: 'Result' },
  { value: 'reference', label: 'Reference' },
  { value: 'code', label: 'Code' },
];

const versionStatusStyle: Record<string, { bg: string; text: string }> = {
  draft: { bg: 'bg-gray-100', text: 'text-gray-600' },
  published: { bg: 'bg-green-50', text: 'text-green-700' },
  superseded: { bg: 'bg-gray-100', text: 'text-gray-500' },
};

function generateId() {
  return crypto.randomUUID();
}

export default function TemplateEditorPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [template, setTemplate] = useState<Template | null>(null);
  const [versions, setVersions] = useState<TemplateVersion[]>([]);
  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);

  // Editable fields
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');
  const [blocks, setBlocks] = useState<BlockDefinition[]>([]);
  const [activeTab, setActiveTab] = useState('blocks');
  const [dragIndex, setDragIndex] = useState<number | null>(null);

  useEffect(() => {
    if (id) fetchTemplate();
  }, [id]);

  async function fetchTemplate() {
    setLoading(true);
    const [tplRes, verRes] = await Promise.all([
      supabase.from('templates').select('*').eq('id', id).single(),
      supabase
        .from('template_versions')
        .select('*')
        .eq('template_id', id)
        .order('version_number', { ascending: false }),
    ]);

    if (tplRes.error) {
      console.error('Failed to fetch template:', tplRes.error);
      setLoading(false);
      return;
    }

    const tpl = tplRes.data as Template;
    const vers = (verRes.data ?? []) as TemplateVersion[];

    setTemplate(tpl);
    setVersions(vers);
    setName(tpl.name);
    setDescription(tpl.description ?? '');
    setCategory(tpl.category ?? '');

    // Load latest version content
    const latest = vers[0];
    if (latest) {
      setSelectedVersionId(latest.id);
      loadVersionContent(latest);
    }

    setLoading(false);
  }

  function loadVersionContent(version: TemplateVersion) {
    const content = version.content;
    if (Array.isArray(content)) {
      setBlocks(
        content.map((b: any) => ({
          id: b.id || generateId(),
          type: b.type || 'paragraph',
          label: b.label || '',
          defaultContent: b.defaultContent ?? b.default_content ?? null,
        })),
      );
    } else {
      setBlocks([]);
    }
  }

  function handleVersionSelect(versionId: string) {
    const version = versions.find((v) => v.id === versionId);
    if (version) {
      setSelectedVersionId(versionId);
      loadVersionContent(version);
    }
  }

  function addBlock() {
    setBlocks((prev) => [
      ...prev,
      {
        id: generateId(),
        type: 'paragraph',
        label: '',
        defaultContent: null,
      },
    ]);
  }

  function removeBlock(idx: number) {
    setBlocks((prev) => prev.filter((_, i) => i !== idx));
  }

  function updateBlock(idx: number, patch: Partial<BlockDefinition>) {
    setBlocks((prev) =>
      prev.map((b, i) => (i === idx ? { ...b, ...patch } : b)),
    );
  }

  function moveBlock(from: number, to: number) {
    setBlocks((prev) => {
      const next = [...prev];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return next;
    });
  }

  function serializeBlocks() {
    return blocks.map((b) => ({
      id: b.id,
      type: b.type,
      label: b.label,
      defaultContent: b.defaultContent,
    }));
  }

  async function handleSaveDraft() {
    if (!id) return;
    setSaving(true);
    try {
      // Update template metadata
      await supabase
        .from('templates')
        .update({
          name: name.trim(),
          description: description.trim() || null,
          category: category.trim() || null,
        })
        .eq('id', id);

      const { data: user } = await supabase.auth.getUser();
      const content = serializeBlocks();

      // Check if current selected version is a draft — update it
      const currentVersion = versions.find((v) => v.id === selectedVersionId);
      if (currentVersion && currentVersion.status === 'draft') {
        await supabase
          .from('template_versions')
          .update({ content })
          .eq('id', currentVersion.id);
      } else {
        // Create a new draft version
        const nextNum = (versions[0]?.version_number ?? 0) + 1;
        const { data: newVer } = await supabase
          .from('template_versions')
          .insert({
            template_id: id,
            version_number: nextNum,
            content,
            status: 'draft',
            created_by: user.user!.id,
          })
          .select()
          .single();

        if (newVer) {
          setVersions((prev) => [newVer, ...prev]);
          setSelectedVersionId(newVer.id);
        }
      }

      await fetchTemplate();
    } catch (err) {
      console.error('Failed to save draft:', err);
    } finally {
      setSaving(false);
    }
  }

  async function handlePublish() {
    if (!id) return;
    setPublishing(true);
    try {
      const { data: user } = await supabase.auth.getUser();
      const content = serializeBlocks();

      // Supersede all previously published versions
      await supabase
        .from('template_versions')
        .update({ status: 'superseded' })
        .eq('template_id', id)
        .eq('status', 'published');

      const nextNum = (versions[0]?.version_number ?? 0) + 1;

      // If current is a draft, promote it
      const currentVersion = versions.find((v) => v.id === selectedVersionId);
      if (currentVersion && currentVersion.status === 'draft') {
        await supabase
          .from('template_versions')
          .update({
            content,
            status: 'published',
            published_at: new Date().toISOString(),
          })
          .eq('id', currentVersion.id);
      } else {
        await supabase.from('template_versions').insert({
          template_id: id,
          version_number: nextNum,
          content,
          status: 'published',
          published_at: new Date().toISOString(),
          created_by: user.user!.id,
        });
      }

      // Update template
      await supabase
        .from('templates')
        .update({
          name: name.trim(),
          description: description.trim() || null,
          category: category.trim() || null,
          current_version: currentVersion?.status === 'draft' ? currentVersion.version_number : nextNum,
          status: 'published',
        })
        .eq('id', id);

      await fetchTemplate();
    } catch (err) {
      console.error('Failed to publish version:', err);
    } finally {
      setPublishing(false);
    }
  }

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center text-sm text-gray-400">
        Loading template…
      </div>
    );
  }

  if (!template) {
    return (
      <div className="h-full flex items-center justify-center text-sm text-gray-400">
        Template not found
      </div>
    );
  }

  const selectedVersion = versions.find((v) => v.id === selectedVersionId);

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-200 px-6 py-3">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/app/templates')}
            className="rounded-md p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
          >
            <ArrowLeft size={18} />
          </button>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="text-base font-semibold text-gray-900 bg-transparent border-none outline-none focus:ring-0 p-0"
            placeholder="Template name"
          />
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            icon={<Save size={14} />}
            loading={saving}
            onClick={handleSaveDraft}
          >
            Save Draft
          </Button>
          <Button
            size="sm"
            icon={<Upload size={14} />}
            loading={publishing}
            onClick={handlePublish}
          >
            Publish Version
          </Button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 flex overflow-hidden">
        {/* Main editor */}
        <div className="flex-1 overflow-auto">
          {/* Meta fields */}
          <div className="px-6 py-4 border-b border-gray-100 space-y-3">
            <div className="grid grid-cols-2 gap-4">
              <Input
                label="Category"
                placeholder="e.g., Biology"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
              />
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">
                  Status
                </label>
                <div className="py-2">
                  <span
                    className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                      (versionStatusStyle[template.status] ?? versionStatusStyle.draft).bg
                    } ${(versionStatusStyle[template.status] ?? versionStatusStyle.draft).text}`}
                  >
                    {template.status.charAt(0).toUpperCase() + template.status.slice(1)}
                  </span>
                </div>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1.5">
                Description
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Describe what this template is for…"
                rows={2}
                className="block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              />
            </div>
          </div>

          {/* Tabs */}
          <div className="px-6">
            <Tabs
              tabs={[
                { id: 'blocks', label: 'Block Definitions', count: blocks.length },
              ]}
              activeTab={activeTab}
              onChange={setActiveTab}
            />
          </div>

          {/* Blocks editor */}
          <div className="px-6 py-4 space-y-2">
            {blocks.length === 0 && (
              <div className="text-center py-8 text-sm text-gray-400">
                No blocks defined. Add blocks to define your template structure.
              </div>
            )}

            {blocks.map((block, idx) => (
              <div
                key={block.id}
                draggable
                onDragStart={() => setDragIndex(idx)}
                onDragOver={(e) => {
                  e.preventDefault();
                  if (dragIndex !== null && dragIndex !== idx) {
                    moveBlock(dragIndex, idx);
                    setDragIndex(idx);
                  }
                }}
                onDragEnd={() => setDragIndex(null)}
                className="flex items-start gap-2 rounded-lg border border-gray-200 bg-white p-3 hover:border-gray-300 transition-colors"
              >
                <div className="cursor-grab pt-1 text-gray-300 hover:text-gray-500">
                  <GripVertical size={16} />
                </div>

                <div className="flex-1 grid grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">
                      Type
                    </label>
                    <select
                      value={block.type}
                      onChange={(e) =>
                        updateBlock(idx, { type: e.target.value as BlockType })
                      }
                      className="block w-full rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-sm text-gray-700 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500/30"
                    >
                      {BLOCK_TYPES.map((bt) => (
                        <option key={bt.value} value={bt.value}>
                          {bt.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">
                      Label
                    </label>
                    <input
                      type="text"
                      value={block.label}
                      onChange={(e) => updateBlock(idx, { label: e.target.value })}
                      placeholder="Section label"
                      className="block w-full rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500/30"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">
                      Default Content
                    </label>
                    <input
                      type="text"
                      value={
                        typeof block.defaultContent === 'string'
                          ? block.defaultContent
                          : block.defaultContent
                            ? JSON.stringify(block.defaultContent)
                            : ''
                      }
                      onChange={(e) =>
                        updateBlock(idx, { defaultContent: e.target.value || null })
                      }
                      placeholder="Optional default"
                      className="block w-full rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-sm text-gray-900 placeholder:text-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500/30"
                    />
                  </div>
                </div>

                <button
                  onClick={() => removeBlock(idx)}
                  className="rounded-md p-1 text-gray-300 hover:bg-red-50 hover:text-red-500 transition-colors mt-5"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            ))}

            <button
              onClick={addBlock}
              className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-gray-300 py-2.5 text-sm text-gray-500 hover:border-blue-400 hover:text-blue-600 hover:bg-blue-50/30 transition-colors"
            >
              <Plus size={15} />
              Add Block
            </button>
          </div>
        </div>

        {/* Version sidebar */}
        <div className="w-64 shrink-0 border-l border-gray-200 bg-gray-50/50 overflow-auto">
          <div className="px-4 py-3 border-b border-gray-200">
            <h3 className="text-xs font-medium uppercase tracking-wide text-gray-500">
              Versions
            </h3>
          </div>
          <div className="p-2 space-y-1">
            {versions.length === 0 && (
              <p className="px-2 py-4 text-xs text-gray-400 text-center">
                No versions yet. Save a draft to create v1.
              </p>
            )}
            {versions.map((ver) => {
              const isSelected = ver.id === selectedVersionId;
              const st = versionStatusStyle[ver.status] ?? versionStatusStyle.draft;
              return (
                <button
                  key={ver.id}
                  onClick={() => handleVersionSelect(ver.id)}
                  className={[
                    'w-full flex items-center gap-2 rounded-md px-3 py-2 text-left transition-colors',
                    isSelected
                      ? 'bg-blue-50 text-blue-700'
                      : 'text-gray-700 hover:bg-gray-100',
                  ].join(' ')}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm font-medium">
                        v{ver.version_number}
                      </span>
                      <span
                        className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium ${st.bg} ${st.text}`}
                      >
                        {ver.status}
                      </span>
                    </div>
                    <div className="text-xs text-gray-400 mt-0.5 flex items-center gap-1">
                      <Clock size={10} />
                      {new Date(ver.created_at).toLocaleDateString()}
                    </div>
                  </div>
                  {ver.status === 'published' && (
                    <Check size={14} className="text-green-600 shrink-0" />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
