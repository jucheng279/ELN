import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import SaveConflictDialog from '@/components/experiments/SaveConflictDialog';
import { useExperimentStore } from '@/stores/experimentStore';
import { db, resetDb, makeBlock, makeExperiment, rpcCalls } from '@/test/supabaseMock';

vi.mock('@/lib/supabase', async () => ({
  supabase: (await import('@/test/supabaseMock')).supabaseMock,
}));

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const writeText = vi.fn(async () => undefined);

beforeEach(() => {
  resetDb();
  writeText.mockClear();
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  db.rpcHandlers.upsert_experiment_blocks = () => ({ data: null, error: { code: 'PT409', message: 'conflict' } });
  useExperimentStore.setState({
    currentExperiment: makeExperiment(),
    blocks: [makeBlock('b1'), makeBlock('b2')],
    saveState: 'clean',
  });
  useExperimentStore.getState().initSession('exp-1');
  useExperimentStore.getState().updateBlock('b1', { html: '<p>My <strong>unsaved</strong> notes</p>' });
  useExperimentStore.getState()._setSaveState('conflict');
});

afterEach(async () => {
  cleanup();
  await useExperimentStore.getState().discardAndReload();
});

describe('SaveConflictDialog', () => {
  it('lists the affected blocks and copies the unsaved text', async () => {
    render(<SaveConflictDialog open onOpenChange={() => undefined} />);

    expect(screen.getByText(/1 block has unsaved edits/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Copy my unsaved text' }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith('My unsaved notes'));
    expect(useExperimentStore.getState().hasPendingChanges()).toBe(true);
  });

  it('requires a second confirmation before discarding local edits', async () => {
    const onOpenChange = vi.fn();
    render(<SaveConflictDialog open onOpenChange={onOpenChange} />);

    fireEvent.click(screen.getByRole('button', { name: 'Reload latest' }));

    expect(screen.getByText('Discard your unsaved edits?')).toBeInTheDocument();
    expect(useExperimentStore.getState().hasPendingChanges()).toBe(true);
    expect(useExperimentStore.getState().blocks[0].content).toEqual({
      html: '<p>My <strong>unsaved</strong> notes</p>',
    });

    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByRole('button', { name: 'Reload latest' })).toBeInTheDocument();
    expect(useExperimentStore.getState().hasPendingChanges()).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Reload latest' }));
    fireEvent.click(screen.getByRole('button', { name: 'Discard and reload' }));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    const state = useExperimentStore.getState();
    expect(state.hasPendingChanges()).toBe(false);
    expect(state.saveState).toBe('clean');
    expect(state.blocks.find((b) => b.id === 'b1')?.content).toEqual({ html: 'b1 server' });
    expect(rpcCalls('upsert_experiment_blocks')).toHaveLength(0);
  });

  it('cancel closes without discarding', async () => {
    const onOpenChange = vi.fn();
    render(<SaveConflictDialog open onOpenChange={onOpenChange} />);

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(useExperimentStore.getState().hasPendingChanges()).toBe(true);
  });
});
