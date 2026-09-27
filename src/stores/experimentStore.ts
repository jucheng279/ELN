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
// Debounced autosave helpers
// ──────────────────────────────────────────────

const pendingBlockChanges = new Map<string, ExperimentBlock>();
let autosaveTimer: ReturnType<typeof setTimeout> | null = null;
let activeExperimentId: string | null = null;
let activeEditorSessionId: string | null = null;
const AUTOSAVE_DELAY_MS = 2000;

function scheduleSave() {
  if (autosaveTimer) clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => {
    flushPendingBlocks();
  }, AUTOSAVE_DELAY_MS);
}

async function flushPendingBlocks(options?: { throwOnError?: boolean }) {
  if (pendingBlockChanges.size === 0) return;

  const blocksToSave = Array.from(pendingBlockChanges.values());
  pendingBlockChanges.clear();

  const state = useExperimentStore.getState();
  state._setSaving(true);

  try {
    const expId = activeExperimentId;
    if (!expId) throw new Error('No active experiment session');

    const { error } = await supabase.rpc('upsert_experiment_blocks', {
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

    // Increment row_version for each saved block in state
    const savedIds = new Set(blocksToSave.map((b) => b.id));
    const currentBlocks = useExperimentStore.getState().blocks;
    useExperimentStore.setState({
      blocks: currentBlocks.map((b) =>
        savedIds.has(b.id) ? { ...b, row_version: (b.row_version ?? 0) + 1 } : b
      ),
    });

    state._setSaving(false);
    state._setLastSaved(new Date());
  } catch (error) {
    console.error('Autosave failed:', error);
    for (const b of blocksToSave) {
      if (!pendingBlockChanges.has(b.id)) {
        pendingBlockChanges.set(b.id, b);
      }
    }
    state._setSaving(false);
    if (options?.throwOnError) {
      throw error;
    }
    scheduleSave();
  }
}

// beforeunload handler — flush on navigate/close
function handleBeforeUnload(e: BeforeUnloadEvent) {
  if (pendingBlockChanges.size > 0) {
    e.preventDefault();
    flushPendingBlocks();
  }
}

async function startAutosaveSession(experimentId: string) {
  if (activeExperimentId === experimentId) return;
  await stopAutosaveSession();
  activeExperimentId = experimentId;

  try {
    const { data, error } = await supabase.rpc('claim_editor_session', {
      p_experiment_id: experimentId,
    });
    if (!error && data) {
      activeEditorSessionId = (data as { session_id: string }).session_id;
    }
  } catch {
    // Non-fatal: session claim may fail for read-only experiments
  }

  window.addEventListener('beforeunload', handleBeforeUnload);
}

async function stopAutosaveSession() {
  if (autosaveTimer) clearTimeout(autosaveTimer);
  autosaveTimer = null;
  await flushPendingBlocks();

  if (activeExperimentId && activeEditorSessionId) {
    try {
      await supabase.rpc('release_editor_session', {
        p_experiment_id: activeExperimentId,
      });
    } catch {
      // Non-fatal
    }
  }

  activeExperimentId = null;
  activeEditorSessionId = null;
  window.removeEventListener('beforeunload', handleBeforeUnload);
}

// ──────────────────────────────────────────────
// Store
// ──────────────────────────────────────────────

interface ExperimentState {
  experiments: Experiment[];
  currentExperiment: Experiment | null;
  blocks: ExperimentBlock[];
  loading: boolean;
  saving: boolean;
  lastSaved: Date | null;
  filters: ExperimentFilters;
}

interface ExperimentActions {
  _setSaving: (saving: boolean) => void;
  _setLastSaved: (date: Date) => void;

  fetchExperiments: (workspaceId: string, filters?: ExperimentFilters) => Promise<void>;
  createExperiment: (
    workspaceId: string,
    notebookId: string,
    title?: string,
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

  // Domain status actions (server-side RPCs)
  startExperiment: (id: string) => Promise<void>;
  completeExperiment: (id: string) => Promise<void>;
  reopenExperiment: (id: string) => Promise<void>;
  submitForReview: (id: string, reviewerId: string) => Promise<void>;
  approveExperiment: (id: string, reviewId: string) => Promise<void>;
  requestChanges: (id: string, reviewId: string, comment?: string) => Promise<void>;
  signAndLock: (id: string) => Promise<void>;
  createAmendment: (id: string, reason: string) => Promise<{ id: string } | null>;

  // Blocks
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

  // Favorites & Tags
  toggleFavorite: (experimentId: string) => Promise<void>;
  addTag: (experimentId: string, tagName: string) => Promise<void>;
  removeTag: (experimentId: string, tagId: string) => Promise<void>;

  // Revisions (server-side RPC)
  createRevision: (
    experimentId: string,
    changeSummary: string
  ) => Promise<{ revision_number: number } | null>;

  // Filters
  setFilters: (filters: Partial<ExperimentFilters>) => void;
  clearFilters: () => void;

  // Session lifecycle
  initSession: (experimentId: string) => void;
  teardownSession: () => void;
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
  lastSaved: null,
  filters: { ...DEFAULT_FILTERS },

  _setSaving: (saving) => set({ saving }),
  _setLastSaved: (date) => set({ lastSaved: date }),

  // ── Session lifecycle ────────────────────────
  initSession: (experimentId) => { startAutosaveSession(experimentId); },
  teardownSession: () => {
    stopAutosaveSession();
    set({ currentExperiment: null, blocks: [] });
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

  createExperiment: async (workspaceId, notebookId, title, templateVersionId) => {
    const { data, error } = await supabase.rpc('create_experiment_rpc', {
      p_workspace_id: workspaceId,
      p_notebook_id: notebookId,
      p_title: title ?? 'Untitled Experiment',
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
    await flushPendingBlocks({ throwOnError: true });
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
    await flushPendingBlocks({ throwOnError: true });
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
    await flushPendingBlocks({ throwOnError: true });
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
          const updated = { ...b, content, updated_at: new Date().toISOString(), row_version: b.row_version };
          pendingBlockChanges.set(blockId, updated);
          return updated;
        }
        return b;
      });
      return { blocks: updatedBlocks };
    });
    scheduleSave();
  },

  deleteBlock: async (blockId) => {
    pendingBlockChanges.delete(blockId);
    const block = get().blocks.find((b) => b.id === blockId);
    if (!block) return;
    const { error } = await supabase.rpc('delete_experiment_block', {
      p_experiment_id: block.experiment_id,
      p_block_id: blockId,
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
    const { error } = await supabase.rpc('upsert_experiment_blocks', {
      p_experiment_id: experimentId,
      p_blocks: [{
        id: blockId,
        type: block?.type ?? 'paragraph',
        content: block?.content ?? {},
        order_key: newOrderKey,
      }],
    });

    if (error) {
      console.error('Failed to reorder block:', error);
      await get().fetchBlocks(experimentId);
    }
  },

  saveBlocks: async () => {
    if (autosaveTimer) clearTimeout(autosaveTimer);
    await flushPendingBlocks({ throwOnError: true });
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
    await flushPendingBlocks({ throwOnError: true });
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
