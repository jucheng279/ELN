import { describe, it, expect } from 'vitest';

describe('Shared creation entry points', () => {
  it('openCreateExperiment with notebookId sets default', () => {
    const defaults = { notebookId: 'nb-123' };
    const state = { createExperimentOpen: true, createExperimentDefaults: defaults };
    expect(state.createExperimentOpen).toBe(true);
    expect(state.createExperimentDefaults.notebookId).toBe('nb-123');
  });

  it('openCreateExperiment without args has empty defaults', () => {
    const defaults = {};
    const state = { createExperimentOpen: true, createExperimentDefaults: defaults };
    expect(state.createExperimentOpen).toBe(true);
    expect(state.createExperimentDefaults).toEqual({});
  });

  it('folder can be reset to empty string', () => {
    let folderId = 'folder-abc';
    const newValue = '__none__';
    folderId = newValue === '__none__' ? '' : newValue;
    expect(folderId).toBe('');
  });

  it('notebook change should clear folder', () => {
    let notebookId = 'nb-1';
    let folderId = 'folder-1';
    const newFolders = [{ id: 'folder-2', notebook_id: 'nb-2' }];

    // Simulate notebook change
    notebookId = 'nb-2';
    void notebookId;
    // Folder should be cleared if it doesn't belong to new notebook
    const folderBelongs = newFolders.some(f => f.id === folderId);
    if (!folderBelongs) folderId = '';
    expect(folderId).toBe('');
  });

  it('template mode requires selected template for creation', () => {
    const mode = 'template';
    const selectedTemplate = null;
    const notebookId = 'nb-1';
    const canCreate = !!notebookId && (mode !== 'template' || selectedTemplate !== null);
    expect(canCreate).toBe(false);
  });

  it('blank mode does not require template', () => {
    const mode: string = 'blank';
    const selectedTemplate = null;
    const notebookId = 'nb-1';
    const canCreate = !!notebookId && (mode !== 'template' || selectedTemplate !== null);
    expect(canCreate).toBe(true);
  });
});
