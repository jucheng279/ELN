import { create } from 'zustand';
import { supabase } from '@/lib/supabase';
import type { Profile } from '@/lib/types';
import type { User } from '@supabase/supabase-js';

interface AuthState {
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  initialized: boolean;
}

interface AuthActions {
  initialize: () => void;
  signUp: (email: string, password: string, displayName: string) => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  updateProfile: (updates: Partial<Pick<Profile, 'display_name' | 'avatar_url' | 'timezone'>>) => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
}

async function fetchProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single();

  if (error) {
    console.error('Failed to fetch profile:', error.message);
    return null;
  }
  return data as Profile;
}

export const useAuthStore = create<AuthState & AuthActions>((set, get) => ({
  user: null,
  profile: null,
  loading: true,
  initialized: false,

  initialize: () => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        // Synchronously update user from the session payload
        const user = session?.user ?? null;
        set({ user });

        // Async profile fetch wrapped in an IIFE to avoid deadlocking
        // the auth state change callback (Supabase GoTrueClient requirement).
        if (user) {
          (async () => {
            try {
              const profile = await fetchProfile(user.id);
              set({ profile, loading: false, initialized: true });
            } catch {
              set({ profile: null, loading: false, initialized: true });
            }
          })();
        } else {
          set({ profile: null, loading: false, initialized: true });
        }
      }
    );

    // Return cleanup function (caller can invoke on unmount if desired)
    return () => {
      subscription.unsubscribe();
    };
  },

  signUp: async (email, password, displayName) => {
    set({ loading: true });
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { display_name: displayName },
      },
    });
    if (error) {
      set({ loading: false });
      throw error;
    }
    // onAuthStateChange will handle the rest
  },

  signIn: async (email, password) => {
    set({ loading: true });
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      set({ loading: false });
      throw error;
    }
    // onAuthStateChange will handle the rest
  },

  signOut: async () => {
    set({ loading: true });
    const { error } = await supabase.auth.signOut();
    if (error) {
      set({ loading: false });
      throw error;
    }
    set({ user: null, profile: null, loading: false });
  },

  updateProfile: async (updates) => {
    const { user } = get();
    if (!user) throw new Error('Not authenticated');

    const { data, error } = await supabase
      .from('profiles')
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq('id', user.id)
      .select()
      .single();

    if (error) throw error;
    set({ profile: data as Profile });
  },

  resetPassword: async (email) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email);
    if (error) throw error;
  },
}));
