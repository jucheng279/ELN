import { create } from 'zustand';
import { supabase } from '@/lib/supabase';
import type { Notebook, Folder } from '@/lib/types';

interface NotebookState {
  notebooks: Notebook[];
  currentNotebook: Notebook | null;
  folders: Folder[];
  loading: boolean;
}

interface NotebookActions {
  fetchNotebooks: (workspaceId: string) => Promise<void>;
  createNotebook: (workspaceId: string, name: string, description?: string) => Promise<Notebook>;
  updateNotebook: (id: string, updates: Partial<Pick<Notebook, 'name' | 'description'>>) => Promise<void>;
  archiveNotebook: (id: string) => Promise<void>;
  fetchFolders: (notebookId: string) => Promise<void>;
  createFolder: (notebookId: string, name: string, parentId?: string) => Promise<Folder>;
}

export const useNotebookStore = create<NotebookState & NotebookActions>((set, get) => ({
  notebooks: [],
  currentNotebook: null,
  folders: [],
  loading: false,

  fetchNotebooks: async (workspaceId) => {
    set({ loading: true });
    try {
      const { data, error } = await supabase
        .from('notebooks')
        .select('*')
        .eq('workspace_id', workspaceId)
        .eq('is_archived', false)
        .order('created_at', { ascending: false });

      if (error) throw error;
      set({ notebooks: (data ?? []) as Notebook[] });
    } catch (error) {
      console.error('Failed to fetch notebooks:', error);
    } finally {
      set({ loading: false });
    }
  },

  createNotebook: async (workspaceId, name, description) => {
    const { data, error } = await supabase
      .from('notebooks')
      .insert({
        workspace_id: workspaceId,
        name,
        description: description ?? null,
      })
      .select()
      .single();

    if (error) throw error;

    const notebook = data as Notebook;
    set((state) => ({ notebooks: [notebook, ...state.notebooks] }));
    return notebook;
  },

  updateNotebook: async (id, updates) => {
    const { data, error } = await supabase
      .from('notebooks')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    const updated = data as Notebook;
    set((state) => ({
      notebooks: state.notebooks.map((n) => (n.id === id ? updated : n)),
      currentNotebook:
        state.currentNotebook?.id === id ? updated : state.currentNotebook,
    }));
  },

  archiveNotebook: async (id) => {
    const { error } = await supabase
      .from('notebooks')
      .update({ is_archived: true })
      .eq('id', id);

    if (error) throw error;

    set((state) => ({
      notebooks: state.notebooks.filter((n) => n.id !== id),
      currentNotebook:
        state.currentNotebook?.id === id ? null : state.currentNotebook,
    }));
  },

  fetchFolders: async (notebookId) => {
    try {
      const { data, error } = await supabase
        .from('folders')
        .select('*')
        .eq('notebook_id', notebookId)
        .order('order_key', { ascending: true });

      if (error) throw error;
      set({ folders: (data ?? []) as Folder[] });
    } catch (error) {
      console.error('Failed to fetch folders:', error);
    }
  },

  createFolder: async (notebookId, name, parentId) => {
    const { data, error } = await supabase
      .from('folders')
      .insert({
        notebook_id: notebookId,
        parent_id: parentId ?? null,
        name,
      })
      .select()
      .single();

    if (error) throw error;

    const folder = data as Folder;
    set((state) => ({ folders: [...state.folders, folder] }));
    return folder;
  },
}));
