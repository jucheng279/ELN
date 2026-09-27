import { create } from 'zustand';
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
// Order-key helpers
// ──────────────────────────────────────────────

/**
 * Generate an order key for the i-th position: "a0", "a1", …
 */
function orderKeyAt(index: number): string {
  return `a${index}`;
}

/**
 * Generate an order key between two existing keys.
 * Uses simple lexicographic midpoint by appending a character.
 */
function orderKeyBetween(before: string | null, after: string | null): string {
  if (!before && !after) return 'a0';
  if (!before) return (after ?? 'a0').slice(0, -1) + '0';
  if (!after) return before + '1';

  // Simple approach: concatenate before + midpoint character
  // This keeps lexicographic ordering: before < before+'8' < after
  return before + '8';
}

// ──────────────────────────────────────────────
// Debounced autosave helpers
// ──────────────────────────────────────────────

const pendingBlockChanges = new Map<string, ExperimentBlock>();
let autosaveTimer: ReturnType<typeof setTimeout> | null = null;
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
    // Re-queue the blocks for retry
    for (const b of blocksToSave) {
      if (!pendingBlockChanges.has(b.id)) {
        pendingBlockChanges.set(b.id, b);
      }
    }
    state._setSaving(false);
    // Retry after a delay
    scheduleSave();
  }
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
  // Internal helpers for autosave
  _setSaving: (saving: boolean) => void;
  _setLastSaved: (date: Date) => void;

  // Experiments
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
  updateExperimentStatus: (id: string, status: ExperimentStatus) => Promise<void>;
  duplicateExperiment: (
    id: string,
    options?: { includeBlocks?: boolean; includeProtocols?: boolean }
  ) => Promise<Experiment>;
  archiveExperiment: (id: string) => Promise<void>;
  restoreExperiment: (id: string) => Promise<void>;

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

  // Revisions
  createRevision: (
    experimentId: string,
    changeSummary: string,
    changeType: string
  ) => Promise<void>;

  // Filters
  setFilters: (filters: Partial<ExperimentFilters>) => void;
  clearFilters: () => void;
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

  // ── Internal helpers ──────────────────────────
  _setSaving: (saving) => set({ saving }),
  _setLastSaved: (date) => set({ lastSaved: date }),

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

      if (active.status) {
        query = query.eq('status', active.status);
      }
      if (active.notebook_id) {
        query = query.eq('notebook_id', active.notebook_id);
      }
      if (active.created_by) {
        query = query.eq('created_by', active.created_by);
      }
      if (active.date_from) {
        query = query.gte('experiment_date', active.date_from);
      }
      if (active.date_to) {
        query = query.lte('experiment_date', active.date_to);
      }
      if (active.search) {
        const sanitized = active.search.replace(/[%_,()]/g, '');
        if (sanitized) {
          query = query.or(
            `title.ilike.%${sanitized}%,experiment_id.ilike.%${sanitized}%`
          );
        }
      }

      const sortBy = active.sort_by ?? 'updated_at';
      const sortOrder = active.sort_order ?? 'desc';
      query = query.order(sortBy, { ascending: sortOrder === 'asc' });

      const { data, error } = await query;
      if (error) throw error;

      let experiments = (data ?? []) as Experiment[];

      // If tag filtering is requested, do it client-side via the join table
      if (active.tag_ids && active.tag_ids.length > 0) {
        const { data: taggedRows } = await supabase
          .from('experiment_tags')
          .select('experiment_id')
          .in('tag_id', active.tag_ids);

        const taggedIds = new Set((taggedRows ?? []).map((r) => r.experiment_id));
        experiments = experiments.filter((e) => taggedIds.has(e.id));
      }

      // Fetch favorites for the current user to set is_favorited
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData.user?.id;
      if (userId) {
        const { data: favs } = await supabase
          .from('favorites')
          .select('experiment_id')
          .eq('user_id', userId);
        const favSet = new Set((favs ?? []).map((f) => f.experiment_id));
        experiments = experiments.map((e) => ({
          ...e,
          is_favorited: favSet.has(e.id),
        }));
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

    if (templateVersionId) {
      insertPayload.template_version_id = templateVersionId;
    }

    const { data, error } = await supabase
      .from('experiments')
      .insert(insertPayload)
      .select()
      .single();

    if (error) throw error;

    const experiment = data as Experiment;

    // If a template version is provided, copy template blocks
    if (templateVersionId) {
      const { data: tv } = await supabase
        .from('template_versions')
        .select('content')
        .eq('id', templateVersionId)
        .single();

      if (tv?.content && Array.isArray(tv.content)) {
        const templateBlocks = (tv.content as Array<{ type: BlockType; content: any }>).map(
          (block, i) => ({
            experiment_id: experiment.id,
            type: block.type,
            content: block.content,
            order_key: orderKeyAt(i),
          })
        );

        if (templateBlocks.length > 0) {
          await supabase.from('experiment_blocks').insert(templateBlocks);
        }
      }
    }

    set((state) => ({
      experiments: [experiment, ...state.experiments],
    }));

    return experiment;
  },

  fetchExperiment: async (id) => {
    set({ loading: true });
    try {
      // Fetch experiment with joins
      const { data, error } = await supabase
        .from('experiments')
        .select(
          '*, notebook:notebooks(id, name), created_by_profile:profiles!experiments_created_by_fkey(id, display_name, email, avatar_url)'
        )
        .eq('id', id)
        .single();

      if (error) throw error;

      let experiment = data as Experiment;

      // Fetch tags for this experiment
      const { data: tagRows } = await supabase
        .from('experiment_tags')
        .select('tag:tags(*)')
        .eq('experiment_id', id);
      experiment.tags = (tagRows ?? []).map((r) => r.tag as unknown as Tag);

      // Check if favorited
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

      // Also fetch blocks
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

  updateExperimentStatus: async (id, status) => {
    const isLocked = status === 'locked';
    const { data, error } = await supabase
      .from('experiments')
      .update({
        status,
        is_locked: isLocked,
      })
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

  duplicateExperiment: async (id, options = {}) => {
    const { includeBlocks = true, includeProtocols = false } = options;

    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id;
    if (!userId) throw new Error('Not authenticated');

    // Fetch source experiment
    const { data: source, error: fetchError } = await supabase
      .from('experiments')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchError) throw fetchError;
    const src = source as Experiment;

    // Create duplicate
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

    // Copy blocks if requested
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

    // Copy protocol associations if requested
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

    set((state) => ({
      experiments: [duplicated, ...state.experiments],
    }));

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
      currentExperiment:
        state.currentExperiment?.id === id ? null : state.currentExperiment,
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
    set((state) => ({
      experiments: [restored, ...state.experiments],
    }));
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
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id;
    if (!userId) throw new Error('Not authenticated');

    const { blocks } = get();
    let newOrderKey: string;

    if (afterBlockId) {
      const afterIndex = blocks.findIndex((b) => b.id === afterBlockId);
      const afterKey = afterIndex >= 0 ? blocks[afterIndex].order_key : null;
      const nextKey =
        afterIndex >= 0 && afterIndex + 1 < blocks.length
          ? blocks[afterIndex + 1].order_key
          : null;
      newOrderKey = orderKeyBetween(afterKey, nextKey);
    } else {
      // Append at the end
      const lastKey = blocks.length > 0 ? blocks[blocks.length - 1].order_key : null;
      newOrderKey = orderKeyBetween(lastKey, null);
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
    // Optimistically update local state and queue for autosave
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
    // Remove from pending changes if queued
    pendingBlockChanges.delete(blockId);

    const { error } = await supabase
      .from('experiment_blocks')
      .delete()
      .eq('id', blockId);

    if (error) throw error;

    set((state) => ({
      blocks: state.blocks.filter((b) => b.id !== blockId),
    }));
  },

  reorderBlocks: async (experimentId, blockId, newOrderKey) => {
    // Optimistically update local state
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
      // Refetch to restore consistent state
      await get().fetchBlocks(experimentId);
    }
  },

  saveBlocks: () => {
    // Force an immediate flush of pending block changes
    if (autosaveTimer) clearTimeout(autosaveTimer);
    flushPendingBlocks();
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

    // Find or create the tag
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

    // Link tag to experiment
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

  // ── Revisions ─────────────────────────────────

  createRevision: async (experimentId, changeSummary, changeType) => {
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id;
    if (!userId) throw new Error('Not authenticated');

    // Flush any pending block changes first
    await flushPendingBlocks();

    // Fetch current blocks for the snapshot
    const { data: currentBlocks, error: blocksError } = await supabase
      .from('experiment_blocks')
      .select('*')
      .eq('experiment_id', experimentId)
      .order('order_key', { ascending: true });

    if (blocksError) throw blocksError;

    // Compute a simple hash of the content
    const snapshotJson = JSON.stringify(currentBlocks ?? []);
    const contentHash = await computeHash(snapshotJson);

    // Get the next revision number
    const { currentExperiment } = get();
    const nextRevision = (currentExperiment?.current_revision ?? 0) + 1;

    const { error } = await supabase.from('experiment_revisions').insert({
      experiment_id: experimentId,
      revision_number: nextRevision,
      snapshot: currentBlocks,
      content_hash: contentHash,
      change_summary: changeSummary,
      change_type: changeType,
      created_by: userId,
    });

    if (error) throw error;

    // Update the experiment's current_revision
    await supabase
      .from('experiments')
      .update({ current_revision: nextRevision, updated_at: new Date().toISOString() })
      .eq('id', experimentId);

    set((state) => ({
      currentExperiment:
        state.currentExperiment?.id === experimentId
          ? { ...state.currentExperiment, current_revision: nextRevision }
          : state.currentExperiment,
    }));
  },

  // ── Filters ───────────────────────────────────

  setFilters: (filters) => {
    set((state) => ({
      filters: { ...state.filters, ...filters },
    }));
  },

  clearFilters: () => {
    set({ filters: { ...DEFAULT_FILTERS } });
  },
}));

// ──────────────────────────────────────────────
// Utility: SHA-256 hash (browser crypto API)
// ──────────────────────────────────────────────
async function computeHash(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}
