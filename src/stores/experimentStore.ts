import { create } from 'zustand';
import { generateKeyBetween } from 'fractional-indexing';
import { supabase } from '@/lib/supabase';
import type {
  Experiment,
  ExperimentBlock,
  ExperimentFilters,
  BlockType,
  BlockContent,
  Tag,
} from '@/lib/types';

// ──────────────────────────────────────────────
// Awaitable save queue
// ──────────────────────────────────────────────

const pendingBlockChanges = new Map<string, ExperimentBlock>();
const inFlightBlockIds = new Set<string>();
let autosaveTimer: ReturnType<typeof setTimeout> | null = null;
let activeExperimentId: string | null = null;
export const AUTOSAVE_DELAY_MS = 2000;

// Settled (never rejected) promise for whichever block write currently owns the queue.
let activeSavePromise: Promise<void> | null = null;
let metadataQueue: Promise<unknown> = Promise.resolve();

export const METADATA_CONFLICT_MESSAGE =
  'This experiment was updated by someone else. The latest version has been loaded, please try again.';
export const BLOCK_CONFLICT_MESSAGE =
  'This block was changed elsewhere. Resolve the conflict before continuing.';
export const TRANSITION_CONFLICT_MESSAGE =
  'Some of your edits conflict with changes made elsewhere. Resolve the conflict before continuing.';
export const TRANSITION_UNSAVED_MESSAGE =
  'Your latest edits could not be saved yet, so nothing was changed. Retry saving, then try again.';

const EXPERIMENT_DETAIL_SELECT =
  '*, notebook:notebooks(id, name), created_by_profile:profiles!experiments_created_by_fkey(id, display_name, email, avatar_url)';
const EXPERIMENT_LIST_SELECT =
  '*, notebook:notebooks(id, name), created_by_profile:profiles!experiments_created_by_fkey(id, display_name, avatar_url)';

function clearAutosaveTimer() {
  if (autosaveTimer) clearTimeout(autosaveTimer);
  autosaveTimer = null;
}

function scheduleSave() {
  clearAutosaveTimer();
  autosaveTimer = setTimeout(() => {
    autosaveTimer = null;
    void flushPendingBlocks().catch(() => undefined);
  }, AUTOSAVE_DELAY_MS);
}

async function waitForActiveSave(): Promise<void> {
  while (activeSavePromise) await activeSavePromise;
}

async function runExclusive<T>(fn: () => Promise<T>): Promise<T> {
  await waitForActiveSave();
  let settle!: () => void;
  const own = new Promise<void>((res) => { settle = res; });
  activeSavePromise = own;
  try {
    return await fn();
  } finally {
    if (activeSavePromise === own) activeSavePromise = null;
    settle();
  }
}

function hasLocalChange(blockId: string): boolean {
  return pendingBlockChanges.has(blockId) || inFlightBlockIds.has(blockId);
}

function sortBlocks(blocks: ExperimentBlock[]): ExperimentBlock[] {
  return [...blocks].sort((a, b) => a.order_key.localeCompare(b.order_key));
}

function mergeServerBlocks(local: ExperimentBlock[], server: ExperimentBlock[]): ExperimentBlock[] {
  const localById = new Map(local.map((b) => [b.id, b]));
  const serverIds = new Set(server.map((b) => b.id));
  const merged = server.map((s) =>
    hasLocalChange(s.id) ? localById.get(s.id) ?? pendingBlockChanges.get(s.id) ?? s : s
  );
  for (const b of local) {
    if (!serverIds.has(b.id) && hasLocalChange(b.id)) merged.push(b);
  }
  return sortBlocks(merged);
}

function applyServerVersions(data: unknown) {
  const updated = (data as { updated?: Array<{ id: string; row_version: number }> } | null)?.updated;
  if (!Array.isArray(updated) || updated.length === 0) return;
  const versions = new Map(updated.map((sv) => [sv.id, sv.row_version]));
  for (const [id, version] of versions) {
    const pending = pendingBlockChanges.get(id);
    if (pending) pendingBlockChanges.set(id, { ...pending, row_version: version });
  }
  useExperimentStore.setState((state) => ({
    blocks: state.blocks.map((b) => {
      const version = versions.get(b.id);
      return version != null ? { ...b, row_version: version } : b;
    }),
  }));
}

function setBlockOrderKey(blockId: string, orderKey: string) {
  const pending = pendingBlockChanges.get(blockId);
  if (pending) pendingBlockChanges.set(blockId, { ...pending, order_key: orderKey });
  useExperimentStore.setState((state) => ({
    blocks: sortBlocks(state.blocks.map((b) => (b.id === blockId ? { ...b, order_key: orderKey } : b))),
  }));
}

async function flushPendingBlocks(options?: { throwOnError?: boolean }): Promise<void> {
  await waitForActiveSave();
  if (pendingBlockChanges.size === 0) return;

  await runExclusive(async () => {
    if (pendingBlockChanges.size === 0) return;
    const blocksToSave = Array.from(pendingBlockChanges.values());
    pendingBlockChanges.clear();
    for (const b of blocksToSave) inFlightBlockIds.add(b.id);

    const state = useExperimentStore.getState();
    state._setSaveState('saving');

    try {
      const expId = activeExperimentId;
      if (!expId) throw new Error('No active experiment session');

      const { data, error } = await supabase.rpc('upsert_experiment_blocks', {
        p_experiment_id: expId,
        p_blocks: blocksToSave.map((b) => ({
          id: b.id,
          type: b.type,
          content: b.content,
          order_key: b.order_key,
          row_version: b.row_version,
        })),
      });
      if (error) throw error;

      for (const b of blocksToSave) inFlightBlockIds.delete(b.id);
      applyServerVersions(data);

      if (pendingBlockChanges.size > 0) {
        state._setSaveState('dirty');
        scheduleSave();
      } else {
        state._setSaveState('saved');
      }
      state._setLastSaved(new Date());
    } catch (error) {
      for (const b of blocksToSave) {
        inFlightBlockIds.delete(b.id);
        if (!pendingBlockChanges.has(b.id)) pendingBlockChanges.set(b.id, b);
      }
      const isConflict = isConflictError(error);
      state._setSaveState(isConflict ? 'conflict' : 'error');
      console.error('Autosave failed:', error);
      if (!isConflict) scheduleSave();
      if (options?.throwOnError) throw error;
    }
  });
}

// The database signals optimistic-concurrency conflicts as PT409 (formerly 40001).
export function isConflictError(error: unknown): boolean {
  if (!(error instanceof Object) || !('code' in error)) return false;
  const code = (error as { code: unknown }).code;
  return code === 'PT409' || code === '40001';
}

function conflictError(message: string): Error & { code: string } {
  return Object.assign(new Error(message), { code: 'PT409' });
}

async function drainPendingSaves(): Promise<void> {
  clearAutosaveTimer();
  const MAX_DRAIN = 5;
  for (let i = 0; i < MAX_DRAIN; i++) {
    await waitForActiveSave();
    if (pendingBlockChanges.size === 0) return;
    if (useExperimentStore.getState().saveState === 'conflict') {
      throw conflictError(TRANSITION_CONFLICT_MESSAGE);
    }
    await flushPendingBlocks({ throwOnError: true });
  }
  if (pendingBlockChanges.size > 0) {
    throw new Error('Could not drain pending saves after multiple attempts');
  }
}

async function prepareTransition(): Promise<void> {
  try {
    await drainPendingSaves();
  } catch (error) {
    throw new Error(isConflictError(error) ? TRANSITION_CONFLICT_MESSAGE : TRANSITION_UNSAVED_MESSAGE);
  }
}

async function runTransition(
  id: string,
  rpcName: string,
  args: Record<string, unknown>
): Promise<unknown> {
  await prepareTransition();
  const { data, error } = await supabase.rpc(rpcName, args);
  if (error) throw error;
  await useExperimentStore.getState().refreshExperiment(id);
  return data;
}

async function loadExperimentRecord(id: string): Promise<Experiment> {
  const { data, error } = await supabase
    .from('experiments')
    .select(EXPERIMENT_DETAIL_SELECT)
    .eq('id', id)
    .single();
  if (error) throw error;
  if (!data) throw new Error('Experiment not found');

  const experiment = data as Experiment;

  const { data: tagRows, error: tagError } = await supabase
    .from('experiment_tags')
    .select('tag:tags(*)')
    .eq('experiment_id', id);
  if (tagError) throw tagError;
  experiment.tags = (tagRows ?? []).map((r) => r.tag as unknown as Tag);

  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (userId) {
    const { data: fav } = await supabase
      .from('favorites')
      .select('id')
      .eq('experiment_id', id)
      .eq('user_id', userId)
      .maybeSingle();
    experiment.is_favorited = !!fav;
  }
  return experiment;
}

async function loadBlocks(experimentId: string): Promise<ExperimentBlock[]> {
  const { data, error } = await supabase
    .from('experiment_blocks')
    .select('*')
    .eq('experiment_id', experimentId)
    .order('order_key', { ascending: true });
  if (error) throw error;
  return (data ?? []) as ExperimentBlock[];
}

interface MetadataResult {
  metadata_version: number;
  title: string;
  experiment_date: string | null;
  notebook_id: string;
  folder_id: string | null;
  updated_at: string;
}

type MetadataUpdates = Partial<Pick<Experiment, 'title' | 'notebook_id' | 'folder_id' | 'experiment_date'>>;

async function applyMetadataUpdate(id: string, updates: MetadataUpdates): Promise<void> {
  const store = useExperimentStore.getState();
  const current = store.currentExperiment;
  let expectedVersion = current?.id === id ? current.metadata_version : undefined;
  if (expectedVersion == null) {
    const { data: row, error: versionError } = await supabase
      .from('experiments')
      .select('metadata_version')
      .eq('id', id)
      .maybeSingle();
    if (versionError) throw versionError;
    if (!row) throw new Error('Experiment not found');
    expectedVersion = row.metadata_version as number;
  }

  const { data, error } = await supabase.rpc('update_experiment_metadata', {
    p_experiment_id: id,
    p_expected_version: expectedVersion,
    p_title: updates.title ?? null,
    p_experiment_date: updates.experiment_date ?? null,
    p_notebook_id: updates.notebook_id ?? null,
    p_folder_id: updates.folder_id ?? null,
    p_clear_folder: 'folder_id' in updates && updates.folder_id === null,
  });
  if (error) {
    if (isConflictError(error)) {
      await store.refreshExperiment(id, { blocks: false });
      throw new Error(METADATA_CONFLICT_MESSAGE);
    }
    throw error;
  }

  const result = data as MetadataResult | null;
  if (!result || typeof result.metadata_version !== 'number') {
    await store.refreshExperiment(id, { blocks: false });
    return;
  }

  const patch = {
    metadata_version: result.metadata_version,
    title: result.title,
    experiment_date: result.experiment_date,
    notebook_id: result.notebook_id,
    folder_id: result.folder_id,
    updated_at: result.updated_at,
  } as Partial<Experiment>;
  const notebookChanged = current?.id === id && current.notebook_id !== result.notebook_id;

  useExperimentStore.setState((state) => ({
    currentExperiment:
      state.currentExperiment?.id === id ? { ...state.currentExperiment, ...patch } : state.currentExperiment,
    experiments: state.experiments.map((e) => (e.id === id ? { ...e, ...patch } : e)),
  }));

  if (notebookChanged) await store.refreshExperiment(id, { blocks: false });
}

function handleBeforeUnload(e: BeforeUnloadEvent) {
  if (pendingBlockChanges.size > 0 || activeSavePromise) {
    e.preventDefault();
  }
}

async function startAutosaveSession(experimentId: string) {
  if (activeExperimentId === experimentId) return;
  if (activeExperimentId) await stopAutosaveSession();
  activeExperimentId = experimentId;
  window.addEventListener('beforeunload', handleBeforeUnload);
}

async function stopAutosaveSession(): Promise<void> {
  clearAutosaveTimer();
  await waitForActiveSave();
  if (pendingBlockChanges.size > 0) {
    await flushPendingBlocks({ throwOnError: true });
  }
  activeExperimentId = null;
  window.removeEventListener('beforeunload', handleBeforeUnload);
}

// ──────────────────────────────────────────────
// Store types
// ──────────────────────────────────────────────

export type SaveState = 'clean' | 'dirty' | 'saving' | 'saved' | 'error' | 'conflict';

interface ExperimentState {
  experiments: Experiment[];
  currentExperiment: Experiment | null;
  blocks: ExperimentBlock[];
  loading: boolean;
  saving: boolean;
  saveState: SaveState;
  lastSaved: Date | null;
  filters: ExperimentFilters;
}

interface ExperimentActions {
  _setSaving: (saving: boolean) => void;
  _setSaveState: (state: SaveState) => void;
  _setLastSaved: (date: Date) => void;

  fetchExperiments: (workspaceId: string, filters?: ExperimentFilters) => Promise<void>;
  createExperiment: (
    workspaceId: string,
    notebookId: string,
    title?: string,
    folderId?: string,
    templateVersionId?: string
  ) => Promise<Experiment>;
  fetchExperiment: (id: string) => Promise<void>;
  refreshExperiment: (id: string, opts?: { blocks?: boolean }) => Promise<void>;
  updateExperiment: (id: string, updates: MetadataUpdates) => Promise<void>;
  duplicateExperiment: (
    id: string,
    options?: { includeBlocks?: boolean; includeProtocols?: boolean }
  ) => Promise<Experiment>;
  archiveExperiment: (id: string) => Promise<void>;
  restoreExperiment: (id: string) => Promise<void>;

  startExperiment: (id: string) => Promise<void>;
  completeExperiment: (id: string) => Promise<void>;
  reopenExperiment: (id: string) => Promise<void>;
  submitForReview: (id: string, reviewerId: string) => Promise<void>;
  resubmitForReview: (id: string, reviewId: string) => Promise<void>;
  approveExperiment: (id: string, reviewId: string) => Promise<void>;
  requestChanges: (id: string, reviewId: string, comment?: string) => Promise<void>;
  signAndLock: (id: string) => Promise<void>;
  createAmendment: (id: string, reason: string) => Promise<{ id: string } | null>;
  restoreRevision: (experimentId: string, revisionId: string) => Promise<void>;

  fetchBlocks: (experimentId: string) => Promise<void>;
  addBlock: (
    experimentId: string,
    type: BlockType,
    content: BlockContent,
    afterBlockId?: string
  ) => Promise<ExperimentBlock>;
  updateBlock: (blockId: string, content: BlockContent) => void;
  deleteBlock: (blockId: string) => Promise<void>;
  reorderBlocks: (experimentId: string, blockId: string, newOrderKey: string) => Promise<void>;
  saveBlocks: () => Promise<void>;
  drainPendingSaves: () => Promise<void>;

  toggleFavorite: (experimentId: string) => Promise<void>;
  addTag: (experimentId: string, tagName: string) => Promise<void>;
  removeTag: (experimentId: string, tagId: string) => Promise<void>;

  createRevision: (
    experimentId: string,
    changeSummary: string
  ) => Promise<{ revision_number: number } | null>;

  setFilters: (filters: Partial<ExperimentFilters>) => void;
  clearFilters: () => void;

  retryPendingSave: () => Promise<void>;
  discardAndReload: () => Promise<void>;
  hasPendingChanges: () => boolean;
  getUnsavedBlocks: () => ExperimentBlock[];
  initSession: (experimentId: string) => void;
  teardownSession: () => Promise<void>;
}

const DEFAULT_FILTERS: ExperimentFilters = {
  status: null,
  notebook_id: null,
  tag_ids: [],
  search: '',
  created_by: null,
  date_from: null,
  date_to: null,
  sort_by: 'updated_at',
  sort_order: 'desc',
};

export const useExperimentStore = create<ExperimentState & ExperimentActions>((set, get) => ({
  experiments: [],
  currentExperiment: null,
  blocks: [],
  loading: false,
  saving: false,
  saveState: 'clean' as SaveState,
  lastSaved: null,
  filters: { ...DEFAULT_FILTERS },

  _setSaving: (saving) => set({ saving }),
  _setSaveState: (saveState) => set({ saveState, saving: saveState === 'saving' }),
  _setLastSaved: (date) => set({ lastSaved: date }),

  retryPendingSave: async () => {
    if (pendingBlockChanges.size === 0 && !activeSavePromise) return;
    try {
      await flushPendingBlocks({ throwOnError: true });
    } catch {
      // State already set by flushPendingBlocks
    }
  },

  // The only path (besides "Discard and leave") that drops unsaved local edits; callers must confirm first.
  discardAndReload: async () => {
    const expId = activeExperimentId ?? get().currentExperiment?.id;
    clearAutosaveTimer();
    await waitForActiveSave();
    pendingBlockChanges.clear();
    get()._setSaveState('clean');
    if (expId) await get().refreshExperiment(expId);
  },

  hasPendingChanges: () => pendingBlockChanges.size > 0 || activeSavePromise !== null,

  getUnsavedBlocks: () => {
    const { blocks } = get();
    const visible = blocks.filter((b) => hasLocalChange(b.id));
    const visibleIds = new Set(visible.map((b) => b.id));
    const orphaned = Array.from(pendingBlockChanges.values()).filter((b) => !visibleIds.has(b.id));
    return [...visible, ...orphaned];
  },

  initSession: (experimentId) => { void startAutosaveSession(experimentId); },
  teardownSession: async () => {
    const sessionId = activeExperimentId;
    try {
      await stopAutosaveSession();
    } catch {
      if (pendingBlockChanges.size > 0) return;
    }
    if (sessionId && get().currentExperiment?.id !== sessionId) return;
    set({ currentExperiment: null, blocks: [], saveState: 'clean' });
  },

  // ── Experiments ───────────────────────────────

  fetchExperiments: async (workspaceId, filters) => {
    set({ loading: true });
    try {
      const active = filters ?? get().filters;

      let query = supabase
        .from('experiments')
        .select(EXPERIMENT_LIST_SELECT)
        .eq('workspace_id', workspaceId)
        .eq('is_archived', false);

      if (active.status) query = query.eq('status', active.status);
      if (active.notebook_id) query = query.eq('notebook_id', active.notebook_id);
      if (active.created_by) query = query.eq('created_by', active.created_by);
      if (active.date_from) query = query.gte('experiment_date', active.date_from);
      if (active.date_to) query = query.lte('experiment_date', active.date_to);
      if (active.search) {
        const sanitized = active.search.replace(/[%_,()]/g, '');
        if (sanitized) {
          query = query.or(`title.ilike.%${sanitized}%,experiment_id.ilike.%${sanitized}%`);
        }
      }

      const sortBy = active.sort_by ?? 'updated_at';
      const sortOrder = active.sort_order ?? 'desc';
      query = query.order(sortBy, { ascending: sortOrder === 'asc' });

      const { data, error } = await query;
      if (error) throw error;

      let experiments = (data ?? []) as Experiment[];

      if (active.tag_ids && active.tag_ids.length > 0) {
        const { data: taggedRows } = await supabase
          .from('experiment_tags')
          .select('experiment_id')
          .in('tag_id', active.tag_ids);
        const taggedIds = new Set((taggedRows ?? []).map((r) => r.experiment_id));
        experiments = experiments.filter((e) => taggedIds.has(e.id));
      }

      const { data: userData } = await supabase.auth.getUser();
      const userId = userData.user?.id;
      if (userId) {
        const { data: favs } = await supabase
          .from('favorites')
          .select('experiment_id')
          .eq('user_id', userId);
        const favSet = new Set((favs ?? []).map((f) => f.experiment_id));
        experiments = experiments.map((e) => ({ ...e, is_favorited: favSet.has(e.id) }));
      }

      set({ experiments });
    } catch (error) {
      console.error('Failed to fetch experiments:', error);
    } finally {
      set({ loading: false });
    }
  },

  createExperiment: async (workspaceId, notebookId, title, folderId, templateVersionId) => {
    const { data, error } = await supabase.rpc('create_experiment_rpc', {
      p_workspace_id: workspaceId,
      p_notebook_id: notebookId,
      p_title: title ?? 'Untitled Experiment',
      p_folder_id: folderId ?? null,
      p_template_version_id: templateVersionId ?? null,
    });
    if (error) throw error;

    const result = data as { id: string; experiment_number: number; experiment_id: string };
    const { data: experiment, error: fetchError } = await supabase
      .from('experiments')
      .select(EXPERIMENT_LIST_SELECT)
      .eq('id', result.id)
      .single();
    if (fetchError) throw fetchError;

    const exp = experiment as Experiment;
    set((state) => ({ experiments: [exp, ...state.experiments] }));
    return exp;
  },

  // Initial page load only; post-mutation updates use refreshExperiment so the editor stays mounted.
  fetchExperiment: async (id) => {
    set({ loading: true });
    try {
      const experiment = await loadExperimentRecord(id);
      const serverBlocks = await loadBlocks(id);
      set((state) => ({
        currentExperiment: experiment,
        blocks: activeExperimentId === id ? mergeServerBlocks(state.blocks, serverBlocks) : serverBlocks,
      }));
    } catch (error) {
      console.error('Failed to fetch experiment:', error);
      if (get().currentExperiment?.id !== id) set({ currentExperiment: null, blocks: [] });
    } finally {
      set({ loading: false });
    }
  },

  refreshExperiment: async (id, opts) => {
    try {
      const experiment = await loadExperimentRecord(id);
      const current = get().currentExperiment;
      if (current && current.id !== id) return;
      set({ currentExperiment: experiment });
      if (opts?.blocks === false) return;

      const serverBlocks = await loadBlocks(id);
      if (get().currentExperiment?.id !== id) return;
      set((state) => ({ blocks: mergeServerBlocks(state.blocks, serverBlocks) }));
    } catch (error) {
      console.error('Failed to refresh experiment:', error);
    }
  },

  updateExperiment: (id, updates) => {
    const run = metadataQueue.then(() => applyMetadataUpdate(id, updates));
    metadataQueue = run.catch(() => undefined);
    return run;
  },

  // ── Domain status RPCs ─────────────────────

  startExperiment: async (id) => {
    await runTransition(id, 'start_experiment', { p_experiment_id: id });
  },

  completeExperiment: async (id) => {
    await runTransition(id, 'complete_experiment', { p_experiment_id: id });
  },

  reopenExperiment: async (id) => {
    await runTransition(id, 'reopen_experiment', { p_experiment_id: id });
  },

  submitForReview: async (id, reviewerId) => {
    await runTransition(id, 'submit_for_review', {
      p_experiment_id: id,
      p_reviewer_id: reviewerId,
    });
  },

  resubmitForReview: async (id, reviewId) => {
    await runTransition(id, 'resubmit_for_review', {
      p_experiment_id: id,
      p_review_id: reviewId,
    });
  },

  approveExperiment: async (id, reviewId) => {
    await runTransition(id, 'approve_experiment', {
      p_experiment_id: id,
      p_review_id: reviewId,
    });
  },

  requestChanges: async (id, reviewId, comment) => {
    await runTransition(id, 'request_experiment_changes', {
      p_experiment_id: id,
      p_review_id: reviewId,
      p_comment: comment ?? null,
    });
  },

  signAndLock: async (id) => {
    await runTransition(id, 'sign_and_lock_experiment', { p_experiment_id: id });
  },

  createAmendment: async (id, reason) => {
    const { data, error } = await supabase.rpc('create_amendment', {
      p_experiment_id: id,
      p_reason: reason,
    });
    if (error) throw error;
    return data as { id: string } | null;
  },

  restoreRevision: async (experimentId, revisionId) => {
    await prepareTransition();
    if (get().hasPendingChanges()) throw new Error(TRANSITION_UNSAVED_MESSAGE);
    const { error } = await supabase.rpc('restore_experiment_revision', {
      p_experiment_id: experimentId,
      p_revision_id: revisionId,
    });
    if (error) throw error;
    await get().refreshExperiment(experimentId);
  },

  // ── Blocks ────────────────────────────────────

  fetchBlocks: async (experimentId) => {
    const serverBlocks = await loadBlocks(experimentId);
    set((state) => ({ blocks: mergeServerBlocks(state.blocks, serverBlocks) }));
  },

  addBlock: async (experimentId, type, content, afterBlockId) => {
    const sorted = sortBlocks(get().blocks);
    let newOrderKey: string;

    if (afterBlockId) {
      const afterIndex = sorted.findIndex((b) => b.id === afterBlockId);
      const afterKey = afterIndex >= 0 ? sorted[afterIndex].order_key : null;
      const nextKey =
        afterIndex >= 0 && afterIndex + 1 < sorted.length
          ? sorted[afterIndex + 1].order_key
          : null;
      newOrderKey = generateKeyBetween(afterKey, nextKey);
    } else {
      const lastKey = sorted.length > 0 ? sorted[sorted.length - 1].order_key : null;
      newOrderKey = generateKeyBetween(lastKey, null);
    }

    const { data, error } = await supabase.rpc('insert_experiment_block', {
      p_experiment_id: experimentId,
      p_type: type,
      p_content: content,
      p_order_key: newOrderKey,
    });
    if (error) throw error;

    const newBlock = data as unknown as ExperimentBlock;
    set((state) => ({ blocks: sortBlocks([...state.blocks, newBlock]) }));
    return newBlock;
  },

  updateBlock: (blockId, content) => {
    set((state) => ({
      blocks: state.blocks.map((b) => {
        if (b.id !== blockId) return b;
        const updated = { ...b, content, updated_at: new Date().toISOString() };
        pendingBlockChanges.set(blockId, updated);
        return updated;
      }),
    }));
    // A conflict needs an explicit user decision; never auto-retry the stale write.
    if (get().saveState === 'conflict') return;
    get()._setSaveState('dirty');
    scheduleSave();
  },

  deleteBlock: async (blockId) => {
    await runExclusive(async () => {
      const block = get().blocks.find((b) => b.id === blockId);
      if (!block) {
        pendingBlockChanges.delete(blockId);
        return;
      }
      const expectedVersion = pendingBlockChanges.get(blockId)?.row_version ?? block.row_version;
      const { error } = await supabase.rpc('delete_experiment_block', {
        p_experiment_id: block.experiment_id,
        p_block_id: blockId,
        p_expected_version: expectedVersion,
      });
      if (error) {
        if (isConflictError(error)) {
          get()._setSaveState('conflict');
          throw conflictError(BLOCK_CONFLICT_MESSAGE);
        }
        throw error;
      }
      pendingBlockChanges.delete(blockId);
      set((state) => ({ blocks: state.blocks.filter((b) => b.id !== blockId) }));
      const { saveState } = get();
      if (pendingBlockChanges.size === 0 && (saveState === 'dirty' || saveState === 'error')) {
        clearAutosaveTimer();
        get()._setSaveState('saved');
      }
    });
  },

  reorderBlocks: async (experimentId, blockId, newOrderKey) => {
    const original = get().blocks.find((b) => b.id === blockId);
    if (!original || original.order_key === newOrderKey) return;
    const previousOrderKey = original.order_key;
    setBlockOrderKey(blockId, newOrderKey);

    await runExclusive(async () => {
      const latest = pendingBlockChanges.get(blockId) ?? get().blocks.find((b) => b.id === blockId);
      if (!latest) return;

      const { data, error } = await supabase.rpc('upsert_experiment_blocks', {
        p_experiment_id: experimentId,
        p_blocks: [{
          id: blockId,
          type: latest.type,
          content: latest.content,
          order_key: newOrderKey,
          row_version: latest.row_version,
        }],
      });

      if (error) {
        if (get().blocks.find((b) => b.id === blockId)?.order_key === newOrderKey) {
          setBlockOrderKey(blockId, previousOrderKey);
        }
        if (isConflictError(error)) {
          get()._setSaveState('conflict');
          throw conflictError(BLOCK_CONFLICT_MESSAGE);
        }
        throw error;
      }
      applyServerVersions(data);
    });
  },

  saveBlocks: async () => {
    await drainPendingSaves();
  },

  drainPendingSaves: () => drainPendingSaves(),

  duplicateExperiment: async (id, options = {}) => {
    const { includeBlocks = true, includeProtocols = false } = options;

    const { data, error } = await supabase.rpc('duplicate_experiment_rpc', {
      p_experiment_id: id,
      p_include_blocks: includeBlocks,
      p_include_protocols: includeProtocols,
    });
    if (error) throw error;

    const result = data as { id: string };
    const { data: experiment, error: fetchError } = await supabase
      .from('experiments')
      .select(EXPERIMENT_LIST_SELECT)
      .eq('id', result.id)
      .single();
    if (fetchError) throw fetchError;

    const duplicated = experiment as Experiment;
    set((state) => ({ experiments: [duplicated, ...state.experiments] }));
    return duplicated;
  },

  archiveExperiment: async (id) => {
    await prepareTransition();
    const { error } = await supabase.rpc('archive_experiment_rpc', {
      p_experiment_id: id,
    });
    if (error) throw error;
    set((state) => ({
      experiments: state.experiments.filter((e) => e.id !== id),
      currentExperiment: state.currentExperiment?.id === id ? null : state.currentExperiment,
    }));
  },

  restoreExperiment: async (id) => {
    const { error } = await supabase.rpc('restore_experiment_rpc', {
      p_experiment_id: id,
    });
    if (error) throw error;
    const restored = await loadExperimentRecord(id);
    set((state) => ({
      experiments: [restored, ...state.experiments.filter((e) => e.id !== id)],
      currentExperiment: state.currentExperiment?.id === id ? restored : state.currentExperiment,
    }));
  },

  // ── Favorites ─────────────────────────────────

  toggleFavorite: async (experimentId) => {
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id;
    if (!userId) throw new Error('Not authenticated');

    const { currentExperiment, experiments } = get();
    const isFavorited =
      currentExperiment?.id === experimentId
        ? currentExperiment.is_favorited
        : experiments.find((e) => e.id === experimentId)?.is_favorited;

    if (isFavorited) {
      const { error } = await supabase
        .from('favorites')
        .delete()
        .eq('experiment_id', experimentId)
        .eq('user_id', userId);
      if (error) throw error;
    } else {
      const { error } = await supabase.from('favorites').insert({
        experiment_id: experimentId,
        user_id: userId,
      });
      if (error) throw error;
    }

    const newFavorited = !isFavorited;
    set((state) => ({
      experiments: state.experiments.map((e) =>
        e.id === experimentId ? { ...e, is_favorited: newFavorited } : e
      ),
      currentExperiment:
        state.currentExperiment?.id === experimentId
          ? { ...state.currentExperiment, is_favorited: newFavorited }
          : state.currentExperiment,
    }));
  },

  // ── Tags ──────────────────────────────────────

  addTag: async (experimentId, tagName) => {
    const { currentExperiment } = get();
    const workspaceId = currentExperiment?.workspace_id;
    if (!workspaceId) throw new Error('No workspace context');

    let { data: existingTag } = await supabase
      .from('tags')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('name', tagName)
      .maybeSingle();

    if (!existingTag) {
      const { data: newTag, error: tagError } = await supabase
        .from('tags')
        .insert({ workspace_id: workspaceId, name: tagName })
        .select()
        .single();
      if (tagError) throw tagError;
      existingTag = newTag;
    }

    const tag = existingTag as Tag;

    const { error } = await supabase
      .from('experiment_tags')
      .insert({ experiment_id: experimentId, tag_id: tag.id });
    if (error) throw error;

    set((state) => ({
      currentExperiment:
        state.currentExperiment?.id === experimentId
          ? {
              ...state.currentExperiment,
              tags: [...(state.currentExperiment.tags ?? []), tag],
            }
          : state.currentExperiment,
    }));
  },

  removeTag: async (experimentId, tagId) => {
    const { error } = await supabase
      .from('experiment_tags')
      .delete()
      .eq('experiment_id', experimentId)
      .eq('tag_id', tagId);
    if (error) throw error;

    set((state) => ({
      currentExperiment:
        state.currentExperiment?.id === experimentId
          ? {
              ...state.currentExperiment,
              tags: (state.currentExperiment.tags ?? []).filter((t) => t.id !== tagId),
            }
          : state.currentExperiment,
    }));
  },

  // ── Revisions (server-side RPC) ──────────────

  createRevision: async (experimentId, changeSummary) => {
    await prepareTransition();
    const { data, error } = await supabase.rpc('create_checkpoint', {
      p_experiment_id: experimentId,
      p_change_summary: changeSummary,
    });
    if (error) throw error;

    const revisionData = data as { revision_number: number } | null;
    const revisionNumber = revisionData?.revision_number;
    if (revisionNumber) {
      set((state) => ({
        currentExperiment:
          state.currentExperiment?.id === experimentId
            ? { ...state.currentExperiment, current_revision: revisionNumber }
            : state.currentExperiment,
      }));
    }
    return revisionData;
  },

  // ── Filters ───────────────────────────────────

  setFilters: (filters) => {
    set((state) => ({ filters: { ...state.filters, ...filters } }));
  },

  clearFilters: () => {
    set({ filters: { ...DEFAULT_FILTERS } });
  },
}));
