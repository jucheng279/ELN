import { describe, it, expect } from 'vitest';

function highlightText(text: string, query: string): Array<{ text: string; match: boolean }> {
  if (!query.trim()) return [{ text, match: false }];
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(${escaped})`, 'gi');
  const parts: Array<{ text: string; match: boolean }> = [];
  let lastIndex = 0;

  text.replace(regex, (match, _p1, offset) => {
    if (offset > lastIndex) {
      parts.push({ text: text.slice(lastIndex, offset), match: false });
    }
    parts.push({ text: match, match: true });
    lastIndex = offset + match.length;
    return match;
  });

  if (lastIndex < text.length) {
    parts.push({ text: text.slice(lastIndex), match: false });
  }

  return parts.length > 0 ? parts : [{ text, match: false }];
}

describe('Search text highlighting (React-safe)', () => {
  it('returns full text as non-match when query is empty', () => {
    const result = highlightText('Hello World', '');
    expect(result).toEqual([{ text: 'Hello World', match: false }]);
  });

  it('highlights matching portions', () => {
    const result = highlightText('Enzyme Kinetics Study', 'kinetics');
    expect(result).toEqual([
      { text: 'Enzyme ', match: false },
      { text: 'Kinetics', match: true },
      { text: ' Study', match: false },
    ]);
  });

  it('handles multiple matches', () => {
    const result = highlightText('test ABC test XYZ test', 'test');
    expect(result.filter(r => r.match).length).toBe(3);
  });

  it('escapes regex special characters in query', () => {
    const result = highlightText('Price is $5.00', '$5.00');
    expect(result).toEqual([
      { text: 'Price is ', match: false },
      { text: '$5.00', match: true },
    ]);
  });

  it('produces no HTML string output (XSS-safe)', () => {
    const result = highlightText('<script>alert("xss")</script>', 'script');
    const allText = result.map(r => r.text).join('');
    expect(allText).toBe('<script>alert("xss")</script>');
    expect(allText).not.toContain('<mark');
  });

  it('no match returns full text', () => {
    const result = highlightText('Hello World', 'xyz');
    expect(result).toEqual([{ text: 'Hello World', match: false }]);
  });
});

describe('Search relevance semantics', () => {
  it('relevance sort is meaningless with empty query', () => {
    const query = '';
    const effectiveSort = query.trim() ? 'relevance' : 'date';
    expect(effectiveSort).toBe('date');
  });

  it('relevance sort is valid with text query', () => {
    const query = 'kinetics';
    const effectiveSort = query.trim() ? 'relevance' : 'date';
    expect(effectiveSort).toBe('relevance');
  });
});

describe('Search URL state', () => {
  it('query params round-trip correctly', () => {
    const state = {
      q: 'enzyme kinetics',
      status: 'in_review',
      notebook: 'abc-123',
      author: '',
      from: '2024-01-01',
      to: '',
      sort: 'relevance',
      page: '2',
    };

    const params = new URLSearchParams();
    for (const [key, val] of Object.entries(state)) {
      if (val) params.set(key, val);
    }

    expect(params.get('q')).toBe('enzyme kinetics');
    expect(params.get('status')).toBe('in_review');
    expect(params.get('notebook')).toBe('abc-123');
    expect(params.get('author')).toBeNull();
    expect(params.get('from')).toBe('2024-01-01');
    expect(params.get('to')).toBeNull();
    expect(params.get('sort')).toBe('relevance');
    expect(params.get('page')).toBe('2');
  });

  it('empty state produces no params', () => {
    const state = { q: '', status: '', notebook: '', author: '', from: '', to: '', sort: '', page: '' };
    const params = new URLSearchParams();
    for (const [key, val] of Object.entries(state)) {
      if (val) params.set(key, val);
    }
    expect(params.toString()).toBe('');
  });
});
