import { create } from 'zustand';

interface UIState {
  createExperimentOpen: boolean;
  createExperimentDefaults: {
    notebookId?: string;
  };
}

interface UIActions {
  openCreateExperiment: (defaults?: { notebookId?: string }) => void;
  closeCreateExperiment: () => void;
}

export const useUIStore = create<UIState & UIActions>((set) => ({
  createExperimentOpen: false,
  createExperimentDefaults: {},

  openCreateExperiment: (defaults) =>
    set({ createExperimentOpen: true, createExperimentDefaults: defaults ?? {} }),

  closeCreateExperiment: () =>
    set({ createExperimentOpen: false, createExperimentDefaults: {} }),
}));
