import { create } from 'zustand';
import { generateKeyBetween } from 'fractional-indexing';
import { supabase } from '@/lib/supabase';
import type {
  Experiment,
  ExperimentBlock,
  ExperimentStatus,
  ExperimentFilters,
  BlockType,
  Tag,
} from '@/lib/types';

// ──────────────────────────────────────────────
// Debounced autosave helpers
// ──────────────────────────────────────────────

const pendingBlockChanges = new Map<string, ExperimentBlock>();
let autosaveTimer: ReturnType<typeof setTimeout> | null = null;
let activeExperimentId: string | null = null;
const AUTOSAVE_DELAY_MS = 2000;

function scheduleSave() {
  if (autosaveTimer) clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(() => {
    flushPendingBlocks();
  }, AUTOSAVE_DELAY_MS);
}

async function flushPendingBlocks() {
  if (pendingBlockChanges.size === 0) return;

  const blocksToSave = Array.from(pendingBlockChanges.values());
  pendingBlockChanges.clear();

  const state = useExperimentStore.getState();
  state._setSaving(true);

  try {
    const { error } = await supabase.from('experiment_blocks').upsert(
      blocksToSave.map((b) => ({
        id: b.id,
        experiment_id: b.experiment_id,
        type: b.type,
        content: b.content,
        order_key: b.order_key,
      })),
      { onConflict: 'id' }
    );

    if (error) throw error;

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

function startAutosaveSession(experimentId: string) {
  if (activeExperimentId === experimentId) return;
  stopAutosaveSession();
  activeExperimentId = experimentId;
  window.addEventListener('beforeunload', handleBeforeUnload);
}

function stopAutosaveSession() {
  if (autosaveTimer) clearTimeout(autosaveTimer);
  autosaveTimer = null;
  flushPendingBlocks();
  activeExperimentId = null;
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
  submitForReview: (id: string, reviewerId: string) => Promise<any>;
  approveExperiment: (id: string, reviewId: string) => Promise<void>;
  requestChanges: (id: string, reviewId: string, comment?: string) => Promise<void>;
  signAndLock: (id: string) => Promise<any>;
  createAmendment: (id: string, reason: string) => Promise<void>;

  // Blocks
  fetchBlocks: (experimentId: string) => Promise<void>;
  addBlock: (
    experimentId: string,
    type: BlockType,
    content: any,
    afterBlockId?: string
  ) => Promise<ExperimentBlock>;
  updateBlock: (blockId: string, content: any) => void;
  deleteBlock: (blockId: string) => Promise<void>;
  reorderBlocks: (experimentId: string, blockId: string, newOrderKey: string) => Promise<void>;
  saveBlocks: () => void;

  // Favorites & Tags
  toggleFavorite: (experimentId: string) => Promise<void>;
  addTag: (experimentId: string, tagName: string) => Promise<void>;
  removeTag: (experimentId: string, tagId: string) => Promise<void>;

  // Revisions (server-side RPC)
  createRevision: (
    experimentId: string,
    changeSummary: string,
    changeType: string
  ) => Promise<any>;

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
  initSession: (experimentId) => startAutosaveSession(experimentId),
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
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id;
    if (!userId) throw new Error('Not authenticated');

    const insertPayload: Record<string, any> = {
      workspace_id: workspaceId,
      notebook_id: notebookId,
      title: title ?? 'Untitled Experiment',
      status: 'draft' as ExperimentStatus,
      experiment_date: new Date().toISOString().split('T')[0],
    };
    if (templateVersionId) insertPayload.template_version_id = templateVersionId;

    const { data, error } = await supabase
      .from('experiments')
      .insert(insertPayload)
      .select()
      .single();
    if (error) throw error;
    const experiment = data as Experiment;

    if (templateVersionId) {
      const { data: tv } = await supabase
        .from('template_versions')
        .select('content')
        .eq('id', templateVersionId)
        .single();

      if (tv?.content && Array.isArray(tv.content)) {
        let prevKey: string | null = null;
        const templateBlocks = (tv.content as Array<{ type: BlockType; content: any }>).map(
          (block) => {
            const key = generateKeyBetween(prevKey, null);
            prevKey = key;
            return {
              experiment_id: experiment.id,
              type: block.type,
              content: block.content,
              order_key: key,
            };
          }
        );
        if (templateBlocks.length > 0) {
          await supabase.from('experiment_blocks').insert(templateBlocks);
        }
      }
    }

    set((state) => ({ experiments: [experiment, ...state.experiments] }));
    return experiment;
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

      let experiment = data as Experiment;

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
    const { data, error } = await supabase
      .from('experiments')
      .update(updates)
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;

    const updated = data as Experiment;
    set((state) => ({
      experiments: state.experiments.map((e) => (e.id === id ? { ...e, ...updated } : e)),
      currentExperiment:
        state.currentExperiment?.id === id
          ? { ...state.currentExperiment, ...updated }
          : state.currentExperiment,
    }));
  },

  // ── Domain status RPCs ─────────────────────

  startExperiment: async (id) => {
    const { error } = await supabase.rpc('start_experiment', { p_experiment_id: id });
    if (error) throw error;
    await get().fetchExperiment(id);
  },

  completeExperiment: async (id) => {
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
    await flushPendingBlocks();
    const { data, error } = await supabase.rpc('submit_for_review', {
      p_experiment_id: id,
      p_reviewer_id: reviewerId,
    });
    if (error) throw error;
    await get().fetchExperiment(id);
    return data;
  },

  approveExperiment: async (id, reviewId) => {
    const { data, error } = await supabase.rpc('approve_experiment', {
      p_experiment_id: id,
      p_review_id: reviewId,
    });
    if (error) throw error;
    await get().fetchExperiment(id);
  },

  requestChanges: async (id, reviewId, comment) => {
    const { data, error } = await supabase.rpc('request_experiment_changes', {
      p_experiment_id: id,
      p_review_id: reviewId,
      p_comment: comment ?? null,
    });
    if (error) throw error;
    await get().fetchExperiment(id);
  },

  signAndLock: async (id) => {
    await flushPendingBlocks();
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
    await get().fetchExperiment(id);
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

    const { data, error } = await supabase
      .from('experiment_blocks')
      .insert({
        experiment_id: experimentId,
        type,
        content,
        order_key: newOrderKey,
      })
      .select()
      .single();
    if (error) throw error;

    const newBlock = data as ExperimentBlock;
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
    scheduleSave();
  },

  deleteBlock: async (blockId) => {
    pendingBlockChanges.delete(blockId);
    const { error } = await supabase.from('experiment_blocks').delete().eq('id', blockId);
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

    const { error } = await supabase
      .from('experiment_blocks')
      .update({ order_key: newOrderKey })
      .eq('id', blockId);

    if (error) {
      console.error('Failed to reorder block:', error);
      await get().fetchBlocks(experimentId);
    }
  },

  saveBlocks: () => {
    if (autosaveTimer) clearTimeout(autosaveTimer);
    flushPendingBlocks();
  },

  duplicateExperiment: async (id, options = {}) => {
    const { includeBlocks = true, includeProtocols = false } = options;

    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id;
    if (!userId) throw new Error('Not authenticated');

    const { data: source, error: fetchError } = await supabase
      .from('experiments')
      .select('*')
      .eq('id', id)
      .single();
    if (fetchError) throw fetchError;
    const src = source as Experiment;

    const { data: dup, error: dupError } = await supabase
      .from('experiments')
      .insert({
        workspace_id: src.workspace_id,
        notebook_id: src.notebook_id,
        folder_id: src.folder_id,
        title: `${src.title} (Copy)`,
        status: 'draft' as ExperimentStatus,
        experiment_date: new Date().toISOString().split('T')[0],
        template_id: src.template_id,
        template_version_id: src.template_version_id,
      })
      .select()
      .single();
    if (dupError) throw dupError;
    const duplicated = dup as Experiment;

    if (includeBlocks) {
      const { data: srcBlocks } = await supabase
        .from('experiment_blocks')
        .select('*')
        .eq('experiment_id', id)
        .order('order_key', { ascending: true });

      if (srcBlocks && srcBlocks.length > 0) {
        const newBlocks = srcBlocks.map((b) => ({
          experiment_id: duplicated.id,
          type: b.type,
          content: b.content,
          order_key: b.order_key,
        }));
        await supabase.from('experiment_blocks').insert(newBlocks);
      }
    }

    if (includeProtocols) {
      const { data: srcProtocols } = await supabase
        .from('experiment_protocols')
        .select('*')
        .eq('experiment_id', id);

      if (srcProtocols && srcProtocols.length > 0) {
        const newProtocols = srcProtocols.map((p) => ({
          experiment_id: duplicated.id,
          protocol_id: p.protocol_id,
          protocol_version_id: p.protocol_version_id,
          snapshot: p.snapshot,
        }));
        await supabase.from('experiment_protocols').insert(newProtocols);
      }
    }

    set((state) => ({ experiments: [duplicated, ...state.experiments] }));
    return duplicated;
  },

  archiveExperiment: async (id) => {
    const { error } = await supabase
      .from('experiments')
      .update({ is_archived: true, status: 'archived' as ExperimentStatus })
      .eq('id', id);
    if (error) throw error;
    set((state) => ({
      experiments: state.experiments.filter((e) => e.id !== id),
      currentExperiment: state.currentExperiment?.id === id ? null : state.currentExperiment,
    }));
  },

  restoreExperiment: async (id) => {
    const { data, error } = await supabase
      .from('experiments')
      .update({ is_archived: false, status: 'draft' as ExperimentStatus })
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    const restored = data as Experiment;
    set((state) => ({ experiments: [restored, ...state.experiments] }));
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

  createRevision: async (experimentId, changeSummary, changeType) => {
    await flushPendingBlocks();
    const { data, error } = await supabase.rpc('create_revision', {
      p_experiment_id: experimentId,
      p_change_summary: changeSummary,
      p_change_type: changeType,
    });
    if (error) throw error;

    const revisionNumber = (data as any)?.revision_number;
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
