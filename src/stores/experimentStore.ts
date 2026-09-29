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
let autosaveTimer: ReturnType<typeof setTimeout> | null = null;
let activeExperimentId: string | null = null;
const AUTOSAVE_DELAY_MS = 2000;

let activeSavePromise: Promise<void> | null = null;

function scheduleSave() {
  if (autosaveTimer) clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => {
    void flushPendingBlocks();
  }, AUTOSAVE_DELAY_MS);
}

async function flushPendingBlocks(options?: { throwOnError?: boolean }): Promise<void> {
  if (pendingBlockChanges.size === 0) {
    if (activeSavePromise) await activeSavePromise;
    return;
  }

  if (activeSavePromise) {
    await activeSavePromise;
    if (pendingBlockChanges.size === 0) return;
  }

  const blocksToSave = Array.from(pendingBlockChanges.values());
  pendingBlockChanges.clear();

  const state = useExperimentStore.getState();
  state._setSaveState('saving');

  let resolve: () => void;
  let reject: (e: unknown) => void;
  activeSavePromise = new Promise<void>((res, rej) => { resolve = res; reject = rej; });

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

    const serverVersions = new Map<string, number>();
    const result = data as { updated: Array<{ id: string; row_version: number }> };
    if (result?.updated) {
      for (const sv of result.updated) {
        serverVersions.set(sv.id, sv.row_version);
      }
    }

    const currentBlocks = useExperimentStore.getState().blocks;
    useExperimentStore.setState({
      blocks: currentBlocks.map((b) => {
        const newVersion = serverVersions.get(b.id);
        if (newVersion != null) {
          const pending = pendingBlockChanges.get(b.id);
          if (pending) {
            pendingBlockChanges.set(b.id, { ...pending, row_version: newVersion });
          }
          return { ...b, row_version: newVersion };
        }
        return b;
      }),
    });

    activeSavePromise = null;

    if (pendingBlockChanges.size > 0) {
      state._setSaveState('dirty');
      scheduleSave();
    } else {
      state._setSaveState('saved');
    }
    state._setLastSaved(new Date());
    resolve!();
  } catch (error) {
    activeSavePromise = null;
    const isConflict = error instanceof Object && 'code' in error && (error as { code: string }).code === '40001';
    state._setSaveState(isConflict ? 'conflict' : 'error');
    console.error('Autosave failed:', error);
    for (const b of blocksToSave) {
      if (!pendingBlockChanges.has(b.id)) {
        pendingBlockChanges.set(b.id, b);
      }
    }
    if (options?.throwOnError) {
      reject!(error);
      throw error;
    }
    resolve!();
    if (!isConflict) {
      scheduleSave();
    }
  }
}

async function drainPendingSaves(): Promise<void> {
  const MAX_DRAIN = 5;
  for (let i = 0; i < MAX_DRAIN; i++) {
    if (activeSavePromise) await activeSavePromise;
    if (pendingBlockChanges.size === 0) return;
    await flushPendingBlocks({ throwOnError: true });
  }
  if (pendingBlockChanges.size > 0) {
    throw new Error('Could not drain pending saves after multiple attempts');
  }
}

function handleBeforeUnload(e: BeforeUnloadEvent) {
  if (pendingBlockChanges.size > 0 || activeSavePromise) {
    e.preventDefault();
  }
}

async function startAutosaveSession(experimentId: string) {
  if (activeExperimentId === experimentId) return;
  await stopAutosaveSession();
  activeExperimentId = experimentId;
  window.addEventListener('beforeunload', handleBeforeUnload);
}

async function stopAutosaveSession(): Promise<void> {
  if (autosaveTimer) clearTimeout(autosaveTimer);
  autosaveTimer = null;

  if (activeSavePromise) {
    await activeSavePromise;
  }

  if (pendingBlockChanges.size > 0) {
    await flushPendingBlocks({ throwOnError: true });
  }

  activeExperimentId = null;
  window.removeEventListener('beforeunload', handleBeforeUnload);
}

async function discardPendingAndReload(): Promise<void> {
  if (autosaveTimer) clearTimeout(autosaveTimer);
  autosaveTimer = null;

  if (activeSavePromise) {
    try { await activeSavePromise; } catch { /* already-running write settled */ }
  }

  pendingBlockChanges.clear();

  const expId = activeExperimentId;
  if (!expId) return;

  const state = useExperimentStore.getState();
  state._setSaveState('clean');
  await state.fetchExperiment(expId);
}

// ──────────────────────────────────────────────
// Store types
// ──────────────────────────────────────────────

type SaveState = 'clean' | 'dirty' | 'saving' | 'saved' | 'error' | 'conflict';

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
  updateExperiment: (
    id: string,
    updates: Partial<Pick<Experiment, 'title' | 'notebook_id' | 'folder_id' | 'experiment_date'>>
  ) => Promise<void>;
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
  approveExperiment: (id: string, reviewId: string) => Promise<void>;
  requestChanges: (id: string, reviewId: string, comment?: string) => Promise<void>;
  signAndLock: (id: string) => Promise<void>;
  createAmendment: (id: string, reason: string) => Promise<{ id: string } | null>;

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
  reloadFromServer: () => Promise<void>;
  discardAndReload: () => Promise<void>;
  hasPendingChanges: () => boolean;
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

  reloadFromServer: async () => {
    const expId = activeExperimentId;
    if (!expId) return;
    pendingBlockChanges.clear();
    if (autosaveTimer) clearTimeout(autosaveTimer);
    autosaveTimer = null;
    if (activeSavePromise) {
      try { await activeSavePromise; } catch { /* settle in-flight write */ }
    }
    activeSavePromise = null;
    const state = useExperimentStore.getState();
    state._setSaveState('clean');
    await state.fetchExperiment(expId);
  },

  discardAndReload: async () => {
    await discardPendingAndReload();
  },

  hasPendingChanges: () => {
    return pendingBlockChanges.size > 0 || activeSavePromise !== null;
  },

  initSession: (experimentId) => { void startAutosaveSession(experimentId); },
  teardownSession: async () => {
    try {
      await stopAutosaveSession();
    } catch {
      if (pendingBlockChanges.size > 0) return;
    }
    set({ currentExperiment: null, blocks: [], saveState: 'clean' });
  },

  // ── Experiments ───────────────────────────────

  fetchExperiments: async (workspaceId, filters) => {
    set({ loading: true });
    try {
      const active = filters ?? get().filters;

      let query = supabase
        .from('experiments')
        .select(
          '*, notebook:notebooks(id, name), created_by_profile:profiles!experiments_created_by_fkey(id, display_name, avatar_url)'
        )
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
      .select(
        '*, notebook:notebooks(id, name), created_by_profile:profiles!experiments_created_by_fkey(id, display_name, avatar_url)'
      )
      .eq('id', result.id)
      .single();
    if (fetchError) throw fetchError;

    const exp = experiment as Experiment;
    set((state) => ({ experiments: [exp, ...state.experiments] }));
    return exp;
  },

  fetchExperiment: async (id) => {
    set({ loading: true });
    try {
      const { data, error } = await supabase
        .from('experiments')
        .select(
          '*, notebook:notebooks(id, name), created_by_profile:profiles!experiments_created_by_fkey(id, display_name, email, avatar_url)'
        )
        .eq('id', id)
        .single();
      if (error) throw error;

      const experiment = data as Experiment;

      const { data: tagRows } = await supabase
        .from('experiment_tags')
        .select('tag:tags(*)')
        .eq('experiment_id', id);
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

      set({ currentExperiment: experiment });
      await get().fetchBlocks(id);
    } catch (error) {
      console.error('Failed to fetch experiment:', error);
    } finally {
      set({ loading: false });
    }
  },

  updateExperiment: async (id, updates) => {
    const { error } = await supabase.rpc('update_experiment_metadata', {
      p_experiment_id: id,
      p_title: updates.title ?? null,
      p_experiment_date: updates.experiment_date ?? null,
      p_notebook_id: updates.notebook_id ?? null,
      p_folder_id: updates.folder_id ?? null,
    });
    if (error) throw error;

    await get().fetchExperiment(id);
  },

  // ── Domain status RPCs ─────────────────────

  startExperiment: async (id) => {
    const { error } = await supabase.rpc('start_experiment', { p_experiment_id: id });
    if (error) throw error;
    await get().fetchExperiment(id);
  },

  completeExperiment: async (id) => {
    await drainPendingSaves();
    const { error } = await supabase.rpc('complete_experiment', { p_experiment_id: id });
    if (error) throw error;
    await get().fetchExperiment(id);
  },

  reopenExperiment: async (id) => {
    const { error } = await supabase.rpc('reopen_experiment', { p_experiment_id: id });
    if (error) throw error;
    await get().fetchExperiment(id);
  },

  submitForReview: async (id, reviewerId) => {
    await drainPendingSaves();
    const { data, error } = await supabase.rpc('submit_for_review', {
      p_experiment_id: id,
      p_reviewer_id: reviewerId,
    });
    if (error) throw error;
    await get().fetchExperiment(id);
    return data;
  },

  approveExperiment: async (id, reviewId) => {
    const { error } = await supabase.rpc('approve_experiment', {
      p_experiment_id: id,
      p_review_id: reviewId,
    });
    if (error) throw error;
    await get().fetchExperiment(id);
  },

  requestChanges: async (id, reviewId, comment) => {
    const { error } = await supabase.rpc('request_experiment_changes', {
      p_experiment_id: id,
      p_review_id: reviewId,
      p_comment: comment ?? null,
    });
    if (error) throw error;
    await get().fetchExperiment(id);
  },

  signAndLock: async (id) => {
    await drainPendingSaves();
    const { data, error } = await supabase.rpc('sign_and_lock_experiment', {
      p_experiment_id: id,
    });
    if (error) throw error;
    await get().fetchExperiment(id);
    return data;
  },

  createAmendment: async (id, reason) => {
    const { data, error } = await supabase.rpc('create_amendment', {
      p_experiment_id: id,
      p_reason: reason,
    });
    if (error) throw error;
    return data as { id: string } | null;
  },

  // ── Blocks ────────────────────────────────────

  fetchBlocks: async (experimentId) => {
    const { data, error } = await supabase
      .from('experiment_blocks')
      .select('*')
      .eq('experiment_id', experimentId)
      .order('order_key', { ascending: true });
    if (error) throw error;
    set({ blocks: (data ?? []) as ExperimentBlock[] });
  },

  addBlock: async (experimentId, type, content, afterBlockId) => {
    const { blocks } = get();
    const sorted = [...blocks].sort((a, b) => a.order_key.localeCompare(b.order_key));
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
    set((state) => {
      const updated = [...state.blocks, newBlock].sort((a, b) =>
        a.order_key.localeCompare(b.order_key)
      );
      return { blocks: updated };
    });

    return newBlock;
  },

  updateBlock: (blockId, content) => {
    set((state) => {
      const updatedBlocks = state.blocks.map((b) => {
        if (b.id === blockId) {
          const updated = { ...b, content, updated_at: new Date().toISOString() };
          pendingBlockChanges.set(blockId, updated);
          return updated;
        }
        return b;
      });
      return { blocks: updatedBlocks };
    });
    get()._setSaveState('dirty');
    scheduleSave();
  },

  deleteBlock: async (blockId) => {
    pendingBlockChanges.delete(blockId);
    const block = get().blocks.find((b) => b.id === blockId);
    if (!block) return;
    const { error } = await supabase.rpc('delete_experiment_block', {
      p_experiment_id: block.experiment_id,
      p_block_id: blockId,
      p_expected_version: block.row_version,
    });
    if (error) throw error;
    set((state) => ({ blocks: state.blocks.filter((b) => b.id !== blockId) }));
  },

  reorderBlocks: async (experimentId, blockId, newOrderKey) => {
    set((state) => {
      const updatedBlocks = state.blocks
        .map((b) => (b.id === blockId ? { ...b, order_key: newOrderKey } : b))
        .sort((a, b) => a.order_key.localeCompare(b.order_key));
      return { blocks: updatedBlocks };
    });

    const block = get().blocks.find((b) => b.id === blockId);
    if (!block) return;

    const { data, error } = await supabase.rpc('upsert_experiment_blocks', {
      p_experiment_id: experimentId,
      p_blocks: [{
        id: blockId,
        type: block.type,
        content: block.content,
        order_key: newOrderKey,
        row_version: block.row_version,
      }],
    });

    if (error) {
      console.error('Failed to reorder block:', error);
      await get().fetchBlocks(experimentId);
      return;
    }

    const result = data as { updated: Array<{ id: string; row_version: number }> } | null;
    if (result?.updated) {
      const serverVersions = new Map<string, number>();
      for (const sv of result.updated) {
        serverVersions.set(sv.id, sv.row_version);
      }
      set((state) => ({
        blocks: state.blocks.map((b) => {
          const newVersion = serverVersions.get(b.id);
          return newVersion != null ? { ...b, row_version: newVersion } : b;
        }),
      }));
    }
  },

  saveBlocks: async () => {
    if (autosaveTimer) clearTimeout(autosaveTimer);
    await drainPendingSaves();
  },

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
      .select(
        '*, notebook:notebooks(id, name), created_by_profile:profiles!experiments_created_by_fkey(id, display_name, avatar_url)'
      )
      .eq('id', result.id)
      .single();
    if (fetchError) throw fetchError;

    const duplicated = experiment as Experiment;
    set((state) => ({ experiments: [duplicated, ...state.experiments] }));
    return duplicated;
  },

  archiveExperiment: async (id) => {
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
    await get().fetchExperiment(id);
    const restored = get().currentExperiment;
    if (restored) {
      set((state) => ({ experiments: [restored, ...state.experiments] }));
    }
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
    await drainPendingSaves();
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
    return data;
  },

  // ── Filters ───────────────────────────────────

  setFilters: (filters) => {
    set((state) => ({ filters: { ...state.filters, ...filters } }));
  },

  clearFilters: () => {
    set({ filters: { ...DEFAULT_FILTERS } });
  },
}));
