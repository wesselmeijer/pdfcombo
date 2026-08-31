'use strict';

const { contextBridge, ipcRenderer, webUtils } = require('electron');

const on = (channel, handler) => {
  const listener = () => handler();
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};

contextBridge.exposeInMainWorld('pdfcombo', {
  platform: process.platform,

  /** Opens the file picker; resolves to [{ path, name, size, bytes }]. */
  openPdfs: () => ipcRenderer.invoke('dialog:openPdfs'),

  /**
   * Reads a dropped file. Electron >= 32 no longer puts .path on File, so the
   * path has to be resolved here in the preload via webUtils.
   */
  readDroppedFile: (file) => {
    const filePath = webUtils.getPathForFile(file);
    if (!filePath) throw new Error('Could not resolve the dropped file on disk.');
    return ipcRenderer.invoke('file:readPdf', filePath);
  },

  savePdf: (bytes, suggestedName) =>
    ipcRenderer.invoke('dialog:savePdf', { bytes, suggestedName }),

  openAbout: () => ipcRenderer.invoke('window:openAbout'),
  closeAbout: () => ipcRenderer.invoke('window:closeAbout'),
  appInfo: () => ipcRenderer.invoke('app:info'),

  showItemInFolder: (filePath) => ipcRenderer.invoke('shell:showItem', filePath),
  openPath: (filePath) => ipcRenderer.invoke('shell:openPath', filePath),

  onMenu: {
    add: (fn) => on('menu:add', fn),
    save: (fn) => on('menu:save', fn),
    clear: (fn) => on('menu:clear', fn),
    selectAll: (fn) => on('menu:selectAll', fn),
    delete: (fn) => on('menu:delete', fn),
    restoreAll: (fn) => on('menu:restoreAll', fn),
    rotateLeft: (fn) => on('menu:rotateLeft', fn),
    rotateRight: (fn) => on('menu:rotateRight', fn),
  },
});
