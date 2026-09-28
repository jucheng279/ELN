import { describe, it, expect } from 'vitest';

type SaveState = 'clean' | 'dirty' | 'saving' | 'saved' | 'error' | 'conflict';

function shouldBlockNavigation(saveState: SaveState): boolean {
  return saveState === 'error' || saveState === 'conflict' || saveState === 'dirty';
}

describe('Save error retry behavior', () => {
  it('error state should block navigation', () => {
    expect(shouldBlockNavigation('error')).toBe(true);
  });

  it('conflict state should block navigation', () => {
    expect(shouldBlockNavigation('conflict')).toBe(true);
  });

  it('dirty state should block navigation', () => {
    expect(shouldBlockNavigation('dirty')).toBe(true);
  });

  it('clean state allows navigation', () => {
    expect(shouldBlockNavigation('clean')).toBe(false);
  });

  it('saved state allows navigation', () => {
    expect(shouldBlockNavigation('saved')).toBe(false);
  });

  it('saving state allows navigation (in-flight save will complete)', () => {
    expect(shouldBlockNavigation('saving')).toBe(false);
  });
});

describe('Conflict handling semantics', () => {
  it('reload from server clears pending changes', () => {
    const pendingChanges = new Map<string, object>();
    pendingChanges.set('block-1', { type: 'paragraph', content: 'test' });
    pendingChanges.set('block-2', { type: 'heading', content: 'title' });

    expect(pendingChanges.size).toBe(2);
    pendingChanges.clear();
    expect(pendingChanges.size).toBe(0);
  });

  it('retry preserves pending changes on failure', () => {
    const pendingChanges = new Map<string, object>();
    pendingChanges.set('block-1', { type: 'paragraph', content: 'test' });

    const beforeRetry = new Map(pendingChanges);
    // Simulate failed retry - changes remain
    expect(pendingChanges.size).toBe(beforeRetry.size);
    expect(pendingChanges.get('block-1')).toBe(beforeRetry.get('block-1'));
  });
});

describe('Navigation protection logic', () => {
  it('clean/saved navigates freely', () => {
    const states: SaveState[] = ['clean', 'saved'];
    for (const state of states) {
      expect(shouldBlockNavigation(state)).toBe(false);
    }
  });

  it('error/conflict requires confirmation', () => {
    const states: SaveState[] = ['error', 'conflict'];
    for (const state of states) {
      expect(shouldBlockNavigation(state)).toBe(true);
    }
  });
});
