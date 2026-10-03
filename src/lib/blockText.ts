import type { ExperimentBlock } from '@/lib/types';

const TEXT_KEYS = new Set([
  'html', 'text', 'items', 'code', 'caption', 'rows', 'name', 'value', 'unit',
  'description', 'label', 'title', 'citation', 'notes', 'actual_value', 'reason', 'parameters', 'deviations',
]);

function htmlToText(html: string): string {
  if (!/[<&]/.test(html)) return html;
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return doc.body.textContent ?? '';
}

function collect(value: unknown, out: string[]) {
  if (typeof value === 'string') {
    const text = htmlToText(value).trim();
    if (text) out.push(text);
  } else if (Array.isArray(value)) {
    for (const item of value) collect(item, out);
  } else if (value && typeof value === 'object') {
    for (const [key, inner] of Object.entries(value)) {
      if (TEXT_KEYS.has(key)) collect(inner, out);
    }
  }
}

export function blockPlainText(block: Pick<ExperimentBlock, 'content'>): string {
  const out: string[] = [];
  collect(block.content, out);
  return out.join('\n');
}

export function blocksPlainText(blocks: Pick<ExperimentBlock, 'content'>[]): string {
  return blocks.map(blockPlainText).filter(Boolean).join('\n\n');
}
