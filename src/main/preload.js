const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Discovery & Library
  getAppVersion: () => ipcRenderer.invoke('app:version'),
  scanAll: (options) => ipcRenderer.invoke('scanner:scanAll', options),

  // Artwork & Sync
  resolveArtwork: (game, options) => ipcRenderer.invoke('art:resolve', game, options),
  resolveAll: (games, options) => ipcRenderer.invoke('art:resolveAll', games, options),
  searchAlternatives: (title, appId) => ipcRenderer.invoke('art:searchAlternatives', title, appId),
  fetchImageAsDataUrl: (urlOrPath) => ipcRenderer.invoke('art:fetchAsDataUrl', urlOrPath),
  applyCustomCover: (gameId, dataUrlOrPath, metadata) =>
    ipcRenderer.invoke('art:applyCustomCover', gameId, dataUrlOrPath, metadata),

  // Xbox App Injection & Repair
  restartXboxApp: () => ipcRenderer.invoke('xbox:restart'),
  restoreVaultToXbox: () => ipcRenderer.invoke('xbox:restoreVault'),
  clearAllData: () => ipcRenderer.invoke('vault:clearAll'),
  clearXboxCache: () => ipcRenderer.invoke('vault:clearXboxCache'),
  openVaultFolder: () => ipcRenderer.invoke('shell:openVault'),
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),

  // Config & Custom Games
  getConfig: () => ipcRenderer.invoke('config:get'),
  setConfig: (settings) => ipcRenderer.invoke('config:set', settings),
  addCustomGame: (game) => ipcRenderer.invoke('games:addCustom', game),
  removeCustomGame: (gameId) => ipcRenderer.invoke('games:removeCustom', gameId),
  selectExecutableFile: () => ipcRenderer.invoke('dialog:selectExecutable'),
  selectImageFile: () => ipcRenderer.invoke('dialog:selectImage'),

  // Task Scheduler & Watcher
  getSchedulerStatus: () => ipcRenderer.invoke('scheduler:status'),
  setSchedulerEnabled: (enabled, allowElevation = false) => ipcRenderer.invoke('scheduler:setEnabled', enabled, allowElevation),
  testSchedulerTrigger: () => ipcRenderer.invoke('scheduler:test'),
  openTaskSchedulerGui: () => ipcRenderer.invoke('scheduler:openGui'),
  createStartShortcut: () => ipcRenderer.invoke('app:createStartShortcut'),

  // Window Controls
  minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
  maximizeWindow: () => ipcRenderer.invoke('window:maximize'),
  closeWindow: () => ipcRenderer.invoke('window:close'),

  // Event Listeners from Main Process
  onSyncProgress: (callback) => {
    const handler = (event, data) => callback(data);
    ipcRenderer.on('sync:progress', handler);
    return () => ipcRenderer.removeListener('sync:progress', handler);
  },
  onAutoRestoreEvent: (callback) => {
    const handler = (event, data) => callback(data);
    ipcRenderer.on('watcher:autoRestore', handler);
    return () => ipcRenderer.removeListener('watcher:autoRestore', handler);
  },
  onConfigChanged: (callback) => {
    const handler = (event, data) => callback(data);
    ipcRenderer.on('config:changed', handler);
    return () => ipcRenderer.removeListener('config:changed', handler);
  }
});
