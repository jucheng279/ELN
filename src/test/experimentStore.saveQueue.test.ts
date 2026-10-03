import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mock = await vi.hoisted(async () => import('@/test/supabaseMock'));

vi.mock('@/lib/supabase', () => ({ supabase: mock.supabaseMock }));

type StoreModule = typeof import('@/stores/experimentStore');
type Store = StoreModule['useExperimentStore'];
type StoreState = ReturnType<Store['getState']>;

const CONFLICT = { code: 'PT409', message: 'changed by someone else' };
const SERVER_ERROR = { code: '57014', message: 'statement timeout' };

function okUpsert(args: Record<string, unknown>) {
  const blocks = args.p_blocks as Array<{ id: string; row_version: number }>;
  return { data: { updated: blocks.map((b) => ({ id: b.id, row_version: b.row_version + 1 })) }, error: null };
}

async function setup() {
  vi.resetModules();
  const mod: StoreModule = await import('@/stores/experimentStore');
  mock.resetDb();
  const store = mod.useExperimentStore;
  store.setState({
    currentExperiment: mock.makeExperiment(),
    blocks: [mock.makeBlock('b1'), mock.makeBlock('b2')],
    saveState: 'clean',
    loading: false,
  });
  store.getState().initSession('exp-1');
  await mock.settle();
  const loadingValues: boolean[] = [];
  store.subscribe((s) => loadingValues.push(s.loading));
  const block = (id: string) => store.getState().blocks.find((b) => b.id === id);
  return { store, mod, mock, loadingValues, block };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('updateExperiment', () => {
  it('applies the returned metadata without reloading blocks and keeps pending edits', async () => {
    const { store, mock, loadingValues, block } = await setup();
    store.getState().updateBlock('b1', { html: 'local edit' });
    mock.db.blocks = [mock.makeBlock('b1', { content: { html: 'server copy' } }), mock.makeBlock('b2')];
    mock.db.rpcHandlers.update_experiment_metadata = (args) => ({
      data: {
        success: true,
        metadata_version: (args.p_expected_version as number) + 1,
        title: args.p_title,
        experiment_date: '2024-01-01',
        notebook_id: 'nb-1',
        folder_id: null,
        updated_at: '2024-02-01T00:00:00Z',
      },
      error: null,
    });

    await store.getState().updateExperiment('exp-1', { title: 'Renamed' });

    expect(mock.rpcCalls('update_experiment_metadata')[0]).toMatchObject({
      p_experiment_id: 'exp-1',
      p_expected_version: 5,
      p_title: 'Renamed',
      p_clear_folder: false,
    });
    expect(store.getState().currentExperiment).toMatchObject({ title: 'Renamed', metadata_version: 6 });
    expect(block('b1')?.content).toEqual({ html: 'local edit' });
    expect(store.getState().hasPendingChanges()).toBe(true);
    expect(store.getState().saveState).toBe('dirty');
    expect(mock.db.fromCalls).not.toContain('experiment_blocks');
    expect(loadingValues).not.toContain(true);

    await store.getState().updateExperiment('exp-1', { experiment_date: '2024-03-03' });
    expect(mock.rpcCalls('update_experiment_metadata')[1]).toMatchObject({ p_expected_version: 6 });

    mock.db.rpcHandlers.upsert_experiment_blocks = okUpsert;
    await vi.advanceTimersByTimeAsync(2000);
    expect(mock.rpcCalls('upsert_experiment_blocks')[0].p_blocks).toEqual([
      expect.objectContaining({ id: 'b1', content: { html: 'local edit' }, row_version: 1 }),
    ]);
    expect(store.getState().saveState).toBe('saved');
  });

  it('maps PT409 to the friendly error and refreshes only metadata', async () => {
    const { store, mod, mock, loadingValues, block } = await setup();
    store.getState().updateBlock('b1', { html: 'local edit' });
    mock.db.experiment = mock.makeExperiment({ title: 'Server title', metadata_version: 9 });
    mock.db.blocks = [mock.makeBlock('b1', { content: { html: 'server copy' }, row_version: 4 })];
    mock.db.rpcHandlers.update_experiment_metadata = () => ({ data: null, error: CONFLICT });

    await expect(store.getState().updateExperiment('exp-1', { title: 'Mine' })).rejects.toThrow(
      mod.METADATA_CONFLICT_MESSAGE
    );

    expect(store.getState().currentExperiment).toMatchObject({ title: 'Server title', metadata_version: 9 });
    expect(block('b1')?.content).toEqual({ html: 'local edit' });
    expect(block('b2')).toBeDefined();
    expect(store.getState().hasPendingChanges()).toBe(true);
    expect(mock.db.fromCalls).not.toContain('experiment_blocks');
    expect(loadingValues).not.toContain(true);
  });
});

describe('autosave queue', () => {
  it('enters the conflict state on PT409, keeps the edit and never retries', async () => {
    const { store, mock, block } = await setup();
    mock.db.rpcHandlers.upsert_experiment_blocks = () => ({ data: null, error: CONFLICT });
    store.getState().updateBlock('b1', { html: 'local edit' });

    await vi.advanceTimersByTimeAsync(2000);
    expect(store.getState().saveState).toBe('conflict');

    store.getState().updateBlock('b1', { html: 'more local edit' });
    await vi.advanceTimersByTimeAsync(20000);

    expect(mock.rpcCalls('upsert_experiment_blocks')).toHaveLength(1);
    expect(store.getState().saveState).toBe('conflict');
    expect(store.getState().hasPendingChanges()).toBe(true);
    expect(block('b1')?.content).toEqual({ html: 'more local edit' });
  });

  it('enters the error state on other failures and retries on schedule', async () => {
    const { store, mock } = await setup();
    let attempts = 0;
    mock.db.rpcHandlers.upsert_experiment_blocks = (args) =>
      ++attempts === 1 ? { data: null, error: SERVER_ERROR } : okUpsert(args);
    store.getState().updateBlock('b1', { html: 'local edit' });

    await vi.advanceTimersByTimeAsync(2000);
    expect(store.getState().saveState).toBe('error');
    expect(store.getState().hasPendingChanges()).toBe(true);

    await vi.advanceTimersByTimeAsync(2000);
    const calls = mock.rpcCalls('upsert_experiment_blocks');
    expect(calls).toHaveLength(2);
    expect(calls[1].p_blocks).toEqual([expect.objectContaining({ id: 'b1', content: { html: 'local edit' } })]);
    expect(store.getState().saveState).toBe('saved');
    expect(store.getState().hasPendingChanges()).toBe(false);
  });

  it('keeps edits made during an in-flight save and saves them next with the new version', async () => {
    const { store, mock, block } = await setup();
    const first = mock.deferred<{ data: unknown; error: unknown }>();
    let call = 0;
    mock.db.rpcHandlers.upsert_experiment_blocks = (args) => (++call === 1 ? first.promise : okUpsert(args));

    store.getState().updateBlock('b1', { html: 'v1' });
    await vi.advanceTimersByTimeAsync(2000);
    expect(store.getState().saveState).toBe('saving');

    store.getState().updateBlock('b1', { html: 'v2' });
    await store.getState().refreshExperiment('exp-1');
    expect(block('b1')?.content).toEqual({ html: 'v2' });

    first.resolve({ data: { updated: [{ id: 'b1', row_version: 2 }] }, error: null });
    await mock.settle();
    expect(store.getState().saveState).toBe('dirty');
    expect(block('b1')?.row_version).toBe(2);

    await vi.advanceTimersByTimeAsync(2000);
    expect(mock.rpcCalls('upsert_experiment_blocks')[1].p_blocks).toEqual([
      expect.objectContaining({ id: 'b1', content: { html: 'v2' }, row_version: 2 }),
    ]);
    expect(store.getState().saveState).toBe('saved');
  });
});

describe('reorder and delete', () => {
  it('propagates the reorder row_version into the pending entry', async () => {
    const { store, mock, block } = await setup();
    mock.db.rpcHandlers.upsert_experiment_blocks = okUpsert;
    store.getState().updateBlock('b1', { html: 'local edit' });

    await store.getState().reorderBlocks('exp-1', 'b1', 'a5');
    expect(mock.rpcCalls('upsert_experiment_blocks')[0].p_blocks).toEqual([
      expect.objectContaining({ id: 'b1', order_key: 'a5', row_version: 1 }),
    ]);
    expect(block('b1')?.row_version).toBe(2);
    expect(store.getState().blocks.map((b) => b.id)).toEqual(['b2', 'b1']);

    await vi.advanceTimersByTimeAsync(2000);
    expect(mock.rpcCalls('upsert_experiment_blocks')[1].p_blocks).toEqual([
      expect.objectContaining({ id: 'b1', order_key: 'a5', row_version: 2, content: { html: 'local edit' } }),
    ]);
    expect(store.getState().saveState).toBe('saved');
  });

  it('restores the previous order on failure without dropping pending content', async () => {
    const { store, mock, block } = await setup();
    mock.db.rpcHandlers.upsert_experiment_blocks = () => ({ data: null, error: SERVER_ERROR });
    store.getState().updateBlock('b1', { html: 'local edit' });

    await expect(store.getState().reorderBlocks('exp-1', 'b1', 'a5')).rejects.toBeTruthy();

    expect(store.getState().blocks.map((b) => b.id)).toEqual(['b1', 'b2']);
    expect(block('b1')).toMatchObject({ order_key: 'a1', content: { html: 'local edit' } });
    expect(store.getState().hasPendingChanges()).toBe(true);
    expect(mock.db.fromCalls).not.toContain('experiment_blocks');
  });

  it('waits for the in-flight save and deletes with the freshest row_version', async () => {
    const { store, mock, block } = await setup();
    const save = mock.deferred<{ data: unknown; error: unknown }>();
    mock.db.rpcHandlers.upsert_experiment_blocks = () => save.promise;
    store.getState().updateBlock('b1', { html: 'local edit' });
    await vi.advanceTimersByTimeAsync(2000);

    const deletion = store.getState().deleteBlock('b1');
    await mock.settle();
    expect(mock.rpcCalls('delete_experiment_block')).toHaveLength(0);

    save.resolve({ data: { updated: [{ id: 'b1', row_version: 2 }] }, error: null });
    await deletion;

    expect(mock.rpcCalls('delete_experiment_block')[0]).toEqual({
      p_experiment_id: 'exp-1',
      p_block_id: 'b1',
      p_expected_version: 2,
    });
    expect(block('b1')).toBeUndefined();
  });

  it('maps a delete PT409 to the conflict state and keeps the block', async () => {
    const { store, mod, mock, block } = await setup();
    mock.db.rpcHandlers.delete_experiment_block = () => ({ data: null, error: CONFLICT });

    await expect(store.getState().deleteBlock('b2')).rejects.toThrow(mod.BLOCK_CONFLICT_MESSAGE);
    expect(store.getState().saveState).toBe('conflict');
    expect(block('b2')).toBeDefined();
  });
});

const TRANSITIONS: Array<[string, string, (s: StoreState) => Promise<unknown>]> = [
  ['start', 'start_experiment', (s) => s.startExperiment('exp-1')],
  ['complete', 'complete_experiment', (s) => s.completeExperiment('exp-1')],
  ['reopen', 'reopen_experiment', (s) => s.reopenExperiment('exp-1')],
  ['submit', 'submit_for_review', (s) => s.submitForReview('exp-1', 'reviewer-1')],
  ['resubmit', 'resubmit_for_review', (s) => s.resubmitForReview('exp-1', 'review-1')],
  ['approve', 'approve_experiment', (s) => s.approveExperiment('exp-1', 'review-1')],
  ['request changes', 'request_experiment_changes', (s) => s.requestChanges('exp-1', 'review-1', 'fix')],
  ['sign', 'sign_and_lock_experiment', (s) => s.signAndLock('exp-1')],
  ['archive', 'archive_experiment_rpc', (s) => s.archiveExperiment('exp-1')],
  ['restore revision', 'restore_experiment_revision', (s) => s.restoreRevision('exp-1', 'rev-1')],
  ['checkpoint', 'create_checkpoint', (s) => s.createRevision('exp-1', 'Manual checkpoint')],
];

describe('lifecycle actions drain pending saves first', () => {
  it.each(TRANSITIONS)('%s saves pending edits before calling %s', async (_label, rpcName, run) => {
    const { store, mock, loadingValues } = await setup();
    mock.db.rpcHandlers.upsert_experiment_blocks = okUpsert;
    store.getState().updateBlock('b1', { html: 'local edit' });

    await run(store.getState());

    const names = mock.rpc.mock.calls.map(([n]) => n);
    expect(names.indexOf('upsert_experiment_blocks')).toBeGreaterThanOrEqual(0);
    expect(names.indexOf('upsert_experiment_blocks')).toBeLessThan(names.indexOf(rpcName));
    expect(store.getState().hasPendingChanges()).toBe(false);
    expect(loadingValues).not.toContain(true);
  });

  it.each(TRANSITIONS)('%s aborts and keeps edits when the save fails', async (_label, rpcName, run) => {
    const { store, mod, mock, block } = await setup();
    mock.db.rpcHandlers.upsert_experiment_blocks = () => ({ data: null, error: SERVER_ERROR });
    store.getState().updateBlock('b1', { html: 'local edit' });

    await expect(run(store.getState())).rejects.toThrow(mod.TRANSITION_UNSAVED_MESSAGE);

    expect(mock.rpcCalls(rpcName)).toHaveLength(0);
    expect(store.getState().hasPendingChanges()).toBe(true);
    expect(block('b1')?.content).toEqual({ html: 'local edit' });
  });

  it.each(TRANSITIONS)('%s aborts without writing while a conflict is unresolved', async (_label, rpcName, run) => {
    const { store, mod, mock } = await setup();
    mock.db.rpcHandlers.upsert_experiment_blocks = () => ({ data: null, error: CONFLICT });
    store.getState().updateBlock('b1', { html: 'local edit' });
    await vi.advanceTimersByTimeAsync(2000);

    await expect(run(store.getState())).rejects.toThrow(mod.TRANSITION_CONFLICT_MESSAGE);

    expect(mock.rpcCalls(rpcName)).toHaveLength(0);
    expect(mock.rpcCalls('upsert_experiment_blocks')).toHaveLength(1);
    expect(store.getState().saveState).toBe('conflict');
  });
});

describe('refreshExperiment merge', () => {
  it('keeps pending local content and applies server changes to the other blocks', async () => {
    const { store, mock, loadingValues, block } = await setup();
    store.setState((s) => ({ blocks: [...s.blocks, mock.makeBlock('b4')] }));
    store.getState().updateBlock('b1', { html: 'local edit' });
    mock.db.experiment = mock.makeExperiment({ title: 'Server title', metadata_version: 7 });
    mock.db.blocks = [
      mock.makeBlock('b3', { order_key: 'a0' }),
      mock.makeBlock('b1', { content: { html: 'their edit' }, row_version: 3 }),
      mock.makeBlock('b2', { content: { html: 'b2 updated' }, row_version: 2 }),
    ];

    await store.getState().refreshExperiment('exp-1');

    expect(store.getState().blocks.map((b) => b.id)).toEqual(['b3', 'b1', 'b2']);
    expect(block('b1')).toMatchObject({ content: { html: 'local edit' }, row_version: 1 });
    expect(block('b2')).toMatchObject({ content: { html: 'b2 updated' }, row_version: 2 });
    expect(store.getState().currentExperiment).toMatchObject({ title: 'Server title', metadata_version: 7 });
    expect(store.getState().hasPendingChanges()).toBe(true);
    expect(loadingValues).not.toContain(true);

    mock.db.rpcHandlers.upsert_experiment_blocks = (args) => {
      const [sent] = args.p_blocks as Array<{ row_version: number }>;
      return sent.row_version === 3 ? okUpsert(args) : { data: null, error: CONFLICT };
    };
    await vi.advanceTimersByTimeAsync(2000);
    expect(store.getState().saveState).toBe('conflict');
  });

  it('only discards local edits through discardAndReload', async () => {
    const { store, mock, block } = await setup();
    store.getState().updateBlock('b1', { html: 'local edit' });
    mock.db.blocks = [mock.makeBlock('b1', { content: { html: 'their edit' }, row_version: 3 })];

    await store.getState().discardAndReload();

    expect(block('b1')).toMatchObject({ content: { html: 'their edit' }, row_version: 3 });
    expect(block('b2')).toBeUndefined();
    expect(store.getState().hasPendingChanges()).toBe(false);
    expect(store.getState().saveState).toBe('clean');
  });
});
