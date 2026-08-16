'use strict';
// preload:通过 contextBridge 暴露安全的 IPC API

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // 条目
  entriesList: (opts) => ipcRenderer.invoke('entries:list', opts),
  entriesCreate: (data) => ipcRenderer.invoke('entries:create', data),
  entriesUpdate: (id, data) => ipcRenderer.invoke('entries:update', id, data),
  entriesDelete: (id) => ipcRenderer.invoke('entries:delete', id),
  entriesTagIndex: (opts) => ipcRenderer.invoke('entries:tagIndex', opts),

  // 预设
  presetsList: () => ipcRenderer.invoke('presets:list'),
  presetsSave: (data) => ipcRenderer.invoke('presets:save', data),
  presetsHistory: (id) => ipcRenderer.invoke('presets:history', id),
  presetsDelete: (id) => ipcRenderer.invoke('presets:delete', id),
  presetsPickImages: () => ipcRenderer.invoke('presets:pickImages'),
  presetsRemoveImage: (name) => ipcRenderer.invoke('presets:removeImage', name),
  presetsTypeLabels: () => ipcRenderer.invoke('presets:typeLabels'),

  // 词库
  wordlibEnsure: () => ipcRenderer.invoke('wordlib:ensure'),
  wordlibTree: () => ipcRenderer.invoke('wordlib:tree'),
  wordlibSearchTags: (opts) => ipcRenderer.invoke('wordlib:searchTags', opts),
  wordlibSearchArtists: (opts) => ipcRenderer.invoke('wordlib:searchArtists', opts),
  wordlibSearchWorks: (opts) => ipcRenderer.invoke('wordlib:searchWorks', opts),
  wordlibTagsOfWork: (id, opts) => ipcRenderer.invoke('wordlib:tagsOfWork', id, opts),
  wordlibSlotsOfTags: (ens) => ipcRenderer.invoke('wordlib:slotsOfTags', ens),
  wordlibMeta: () => ipcRenderer.invoke('wordlib:meta'),
  wordlibUpdate: (opts) => ipcRenderer.invoke('wordlib:update', opts),
  wordlibUpdateStatus: () => ipcRenderer.invoke('wordlib:updateStatus'),
  onWordlibUpdateProgress: (cb) => {
    const listener = (_e, p) => cb(p);
    ipcRenderer.on('wordlib:update-progress', listener);
    return () => ipcRenderer.removeListener('wordlib:update-progress', listener);
  },

  // 通用
  clipboardWrite: (text) => ipcRenderer.invoke('app:clipboardWrite', text),
  dataDir: () => ipcRenderer.invoke('app:dataDir'),
  version: () => ipcRenderer.invoke('app:version'),
  openPath: (p) => ipcRenderer.invoke('app:openPath', p),
});

// 供渲染层读取:打包后为 file://,开发为 http://localhost:5173
contextBridge.exposeInMainWorld('env', {
  isDev: !!process.env.VITE_DEV_SERVER_URL,
});
