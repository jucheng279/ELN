import { create } from 'zustand';
import { supabase } from '@/lib/supabase';
import type { Workspace, WorkspaceMember, WorkspaceMemberRole } from '@/lib/types';

interface WorkspaceState {
  workspaces: Workspace[];
  currentWorkspace: Workspace | null;
  members: WorkspaceMember[];
  loading: boolean;
}

interface WorkspaceActions {
  fetchWorkspaces: () => Promise<void>;
  createWorkspace: (name: string, description?: string) => Promise<Workspace>;
  selectWorkspace: (id: string) => Promise<void>;
  fetchMembers: () => Promise<void>;
  inviteMember: (email: string, role: WorkspaceMemberRole) => Promise<void>;
  removeMember: (memberId: string) => Promise<void>;
  updateMemberRole: (memberId: string, role: WorkspaceMemberRole) => Promise<void>;
}

export const useWorkspaceStore = create<WorkspaceState & WorkspaceActions>((set, get) => ({
  workspaces: [],
  currentWorkspace: null,
  members: [],
  loading: false,

  fetchWorkspaces: async () => {
    set({ loading: true });
    try {
      // Fetch workspaces the user is a member of
      const { data: memberRows, error: memberError } = await supabase
        .from('workspace_members')
        .select('workspace_id');

      if (memberError) throw memberError;

      const workspaceIds = memberRows?.map((r) => r.workspace_id) ?? [];

      if (workspaceIds.length === 0) {
        set({ workspaces: [], loading: false });
        return;
      }

      const { data, error } = await supabase
        .from('workspaces')
        .select('*')
        .in('id', workspaceIds)
        .order('created_at', { ascending: false });

      if (error) throw error;

      const workspaces = (data ?? []) as Workspace[];
      set({ workspaces });

      // Auto-select the first workspace if none is currently selected
      const { currentWorkspace } = get();
      if (!currentWorkspace && workspaces.length > 0) {
        set({ currentWorkspace: workspaces[0] });
      }
    } catch (error) {
      console.error('Failed to fetch workspaces:', error);
    } finally {
      set({ loading: false });
    }
  },

  createWorkspace: async (name, description) => {
    const { data, error } = await supabase
      .from('workspaces')
      .insert({ name, description: description ?? null })
      .select()
      .single();

    if (error) throw error;

    const workspace = data as Workspace;

    set((state) => ({
      workspaces: [workspace, ...state.workspaces],
      currentWorkspace: workspace,
    }));

    return workspace;
  },

  selectWorkspace: async (id) => {
    const { workspaces } = get();
    const found = workspaces.find((w) => w.id === id);

    if (found) {
      set({ currentWorkspace: found, members: [] });
    } else {
      // Workspace not in cache – fetch it directly
      const { data, error } = await supabase
        .from('workspaces')
        .select('*')
        .eq('id', id)
        .single();

      if (error) throw error;
      set({ currentWorkspace: data as Workspace, members: [] });
    }
  },

  fetchMembers: async () => {
    const { currentWorkspace } = get();
    if (!currentWorkspace) return;

    set({ loading: true });
    try {
      const { data, error } = await supabase
        .from('workspace_members')
        .select('*, profile:profiles(*)')
        .eq('workspace_id', currentWorkspace.id)
        .order('joined_at', { ascending: true });

      if (error) throw error;

      set({ members: (data ?? []) as WorkspaceMember[] });
    } catch (error) {
      console.error('Failed to fetch members:', error);
    } finally {
      set({ loading: false });
    }
  },

  inviteMember: async (email, role) => {
    const { currentWorkspace } = get();
    if (!currentWorkspace) throw new Error('No workspace selected');

    const { error } = await supabase.rpc('create_workspace_invitation', {
      p_workspace_id: currentWorkspace.id,
      p_email: email,
      p_role: role === 'owner' ? 'admin' : role,
    });

    if (error) throw error;
  },

  removeMember: async (memberId) => {
    const { error } = await supabase
      .from('workspace_members')
      .delete()
      .eq('id', memberId);

    if (error) throw error;

    set((state) => ({
      members: state.members.filter((m) => m.id !== memberId),
    }));
  },

  updateMemberRole: async (memberId, role) => {
    const { error } = await supabase
      .from('workspace_members')
      .update({ role })
      .eq('id', memberId);

    if (error) throw error;

    set((state) => ({
      members: state.members.map((m) =>
        m.id === memberId ? { ...m, role } : m
      ),
    }));
  },
}));
