const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');

const config = require('./config');
const vault = require('./vault');
const scanner = require('./scanner');
const artResolver = require('./artResolver');
const injector = require('./injector');
const watcher = require('./watcher');
const scheduler = require('./scheduler');
const tray = require('./tray');

// 1. Check for CLI headless flags (--restore-silent or --headless)
const isSilentRestore = process.argv.includes('--restore-silent') || process.argv.includes('--headless');

if (isSilentRestore) {
  console.log('[CLI] Running in silent auto-restore mode...');
  try {
    vault.init();
    const result = injector.restoreAllFromVault();
    console.log(`[CLI] Silent restore complete: ${result.restored}/${result.total} covers restored.`);
  } catch (err) {
    console.error('[CLI] Error during silent restore:', err.message);
  }
  process.exit(0);
}

// 2. High-DPI display awareness & crisp text rendering
app.commandLine.appendSwitch('enable-features', 'OverlayScrollbar,Accelerated2dCanvas');
app.commandLine.appendSwitch('force-color-profile', 'srgb');
app.setAppUserModelId('Xbox Grid Sync');

function ensureStartMenuShortcut() {
  if (process.platform !== 'win32') return false;
  try {
    const programsPath = path.join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs');
    if (!fs.existsSync(programsPath)) return false;

    const officialShortcut = path.join(programsPath, 'Xbox Grid Sync.lnk');
    const legacyPortableShortcut = path.join(programsPath, 'XboxGridSync-portable.lnk');

    // Clean up legacy portable shortcut if it was created
    if (fs.existsSync(legacyPortableShortcut)) {
      try { fs.unlinkSync(legacyPortableShortcut); } catch (e) {}
    }

    const targetExe = process.execPath;
    shell.writeShortcutLink(officialShortcut, 'create', {
      target: targetExe,
      cwd: path.dirname(targetExe),
      description: 'Xbox Grid Sync',
      appUserModelId: 'Xbox Grid Sync'
    });
    return true;
  } catch (err) {
    console.warn('[StartMenu] Could not ensure shortcut:', err.message);
    return false;
  }
}

// 3. Single Instance Lock
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
  process.exit(0);
}

let mainWindow = null;

function createWindow() {
  const windowOpts = {
    width: 1120,
    height: 760,
    minWidth: 850,
    minHeight: 600,
    frame: false,
    show: false,
    backgroundColor: '#090b0e',
    icon: path.join(__dirname, '..', 'assets', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  };

  mainWindow = new BrowserWindow(windowOpts);

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  mainWindow.once('ready-to-show', () => {
    const startMinimized = config.get('startMinimized');
    if (!startMinimized) {
      mainWindow.show();
    }
  });

  // Handle minimize to tray
  mainWindow.on('close', (event) => {
    if (!app.isQuitting && config.get('closeToTray')) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  // Setup System Tray
  tray.init(mainWindow, {
    onSyncAll: async () => {
      mainWindow.webContents.send('sync:triggerAll');
    }
  });

  // Setup background watcher restore callback
  watcher.setRestoreCallback((info) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('watcher:autoRestore', info);
    }
  });

  watcher.start();

  // If Task Scheduler is enabled in config, register silently without UAC prompt
  if (config.get('taskSchedulerEnabled') && !scheduler.isRegistered()) {
    scheduler.register(process.execPath, { allowElevation: false });
  }

  // Ensure official Start Menu shortcut named "Xbox Grid Sync" exists
  ensureStartMenuShortcut();
}

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    if (!mainWindow.isVisible()) mainWindow.show();
    mainWindow.focus();
  }
});

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    } else if (mainWindow) {
      mainWindow.show();
    }
  });
});

app.on('before-quit', () => {
  app.isQuitting = true;
  watcher.stop();
  tray.destroy();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' && !config.get('closeToTray')) {
    app.quit();
  }
});

// ==========================================
// IPC HANDLERS
// ==========================================

// 0. App Info
ipcMain.handle('app:version', () => app.getVersion());

// 1. Scanner
ipcMain.handle('scanner:scanAll', async (event, options) => {
  return await scanner.scanAll(options);
});

// 2. Artwork Resolution & Injection
ipcMain.handle('art:resolve', async (event, game, options = {}) => {
  try {
    const resolveResult = await artResolver.resolveArtwork(game, options);
    // Inject directly to Xbox App
    const injectResult = injector.injectGame(game);
    const coverUrl = vault.getCoverAsDataUrl(game.id);

    return {
      success: true,
      gameId: game.id,
      coverUrl,
      source: resolveResult.source,
      injectedPath: injectResult.injectedPath
    };
  } catch (err) {
    console.error(`[IPC] Error resolving ${game.title}:`, err.message);
    return { success: false, gameId: game.id, error: err.message };
  }
});

ipcMain.handle('art:resolveAll', async (event, games, options = {}) => {
  const results = [];
  const total = games.length;

  for (let i = 0; i < games.length; i++) {
    const game = games[i];
    try {
      event.sender.send('sync:progress', {
        current: i + 1,
        total,
        currentGame: game.title,
        status: 'resolving'
      });

      const resolveResult = await artResolver.resolveArtwork(game, options);
      const injectResult = injector.injectGame(game);
      const coverUrl = vault.getCoverAsDataUrl(game.id);

      results.push({
        success: true,
        gameId: game.id,
        coverUrl,
        source: resolveResult.source,
        title: game.title
      });
    } catch (err) {
      results.push({
        success: false,
        gameId: game.id,
        error: err.message,
        title: game.title
      });
    }
  }

  event.sender.send('sync:progress', {
    current: total,
    total,
    currentGame: 'Completed',
    status: 'done'
  });

  return results;
});

ipcMain.handle('art:searchAlternatives', async (event, title, appId) => {
  return await artResolver.searchAlternatives(title, appId);
});

ipcMain.handle('art:applyCustomCover', async (event, gameId, dataUrlOrPath, metadata = {}) => {
  try {
    let buffer;
    if (dataUrlOrPath.startsWith('data:')) {
      const base64Data = dataUrlOrPath.replace(/^data:image\/\w+;base64,/, '');
      buffer = Buffer.from(base64Data, 'base64');
    } else if (dataUrlOrPath.startsWith('http://') || dataUrlOrPath.startsWith('https://')) {
      buffer = await artResolver.downloadBuffer(dataUrlOrPath);
    } else if (fs.existsSync(dataUrlOrPath)) {
      buffer = fs.readFileSync(dataUrlOrPath);
    } else {
      throw new Error('Invalid image source provided.');
    }

    const targetImagePath = metadata.targetImagePath || (vault.getMetadata(gameId) ? vault.getMetadata(gameId).targetImagePath : null);

    vault.saveCover(gameId, buffer, {
      ...metadata,
      targetImagePath,
      source: 'manual_override',
      appliedAt: new Date().toISOString()
    });

    // Inject to Xbox App
    injector.injectGame({
      id: gameId,
      title: metadata.title || gameId,
      launcher: metadata.launcher || 'CUSTOM',
      targetImagePath
    });

    const coverUrl = vault.getCoverAsDataUrl(gameId);
    return { success: true, coverUrl };
  } catch (err) {
    console.error(`[IPC] Error applying custom cover to ${gameId}:`, err.message);
    return { success: false, error: err.message };
  }
});

// 3. Xbox App Controls
ipcMain.handle('xbox:restart', async () => {
  return await injector.restartXboxApp();
});

ipcMain.handle('xbox:restoreVault', async () => {
  return injector.restoreAllFromVault();
});

ipcMain.handle('vault:clearAll', async () => {
  watcher.stop();
  const vaultResult = vault.clearAllData();
  const xboxResult = vault.clearXboxAppCache();
  // Restart watcher after clearing
  if (config.get('watchEnabled')) watcher.start();
  return {
    success: true,
    removedCovers: vaultResult.removedCovers,
    removedXboxFiles: xboxResult.removedFiles
  };
});

ipcMain.handle('vault:clearXboxCache', async () => {
  watcher.stop();
  const result = vault.clearXboxAppCache();
  if (config.get('watchEnabled')) watcher.start();
  return {
    success: true,
    removedFiles: result.removedFiles
  };
});

ipcMain.handle('shell:openVault', async () => {
  shell.openPath(vault.vaultDir);
  return true;
});

ipcMain.handle('shell:openExternal', async (event, url) => {
  if (url && (url.startsWith('https://') || url.startsWith('http://'))) {
    shell.openExternal(url);
    return true;
  }
  return false;
});

// 4. Configuration
ipcMain.handle('config:get', async () => {
  return config.get();
});

ipcMain.handle('config:set', async (event, newSettings) => {
  const updated = config.set(newSettings);
  if (typeof newSettings.watchEnabled !== 'undefined') {
    if (newSettings.watchEnabled) watcher.start();
    else watcher.stop();
  }
  tray.updateContextMenu();
  return updated;
});

ipcMain.handle('games:addCustom', async (event, game) => {
  return config.addCustomGame(game);
});

ipcMain.handle('games:removeCustom', async (event, gameId) => {
  return config.removeCustomGame(gameId);
});

// 5. File Dialogs
ipcMain.handle('dialog:selectExecutable', async () => {
  if (!mainWindow) return null;
  const res = await dialog.showOpenDialog(mainWindow, {
    title: 'Select Game Executable or Shortcut',
    filters: [
      { name: 'Executables and Shortcuts', extensions: ['exe', 'lnk', 'url'] },
      { name: 'All Files', extensions: ['*'] }
    ],
    properties: ['openFile']
  });
  if (!res.canceled && res.filePaths.length > 0) {
    const filePath = res.filePaths[0];
    const parsed = path.parse(filePath);
    return {
      filePath,
      name: parsed.name,
      ext: parsed.ext
    };
  }
  return null;
});

ipcMain.handle('art:fetchAsDataUrl', async (event, urlOrPath) => {
  try {
    if (!urlOrPath) return null;
    if (urlOrPath.startsWith('data:')) return urlOrPath;
    if (fs.existsSync(urlOrPath)) {
      const buf = fs.readFileSync(urlOrPath);
      const ext = path.extname(urlOrPath).toLowerCase().replace('.', '') || 'png';
      const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : (ext === 'webp' ? 'image/webp' : 'image/png');
      return `data:${mime};base64,${buf.toString('base64')}`;
    }
    const buf = await artResolver.downloadBuffer(urlOrPath);
    return `data:image/png;base64,${buf.toString('base64')}`;
  } catch (err) {
    console.error(`[IPC] Failed to fetch image as data URL:`, err.message);
    throw err;
  }
});

ipcMain.handle('dialog:selectImage', async () => {
  if (!mainWindow) return null;
  const res = await dialog.showOpenDialog(mainWindow, {
    title: 'Select Custom Artwork Image (1:1 square recommended)',
    filters: [
      { name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'webp', 'avif'] },
      { name: 'All Files', extensions: ['*'] }
    ],
    properties: ['openFile']
  });
  if (!res.canceled && res.filePaths.length > 0) {
    const filePath = res.filePaths[0];
    try {
      const buf = fs.readFileSync(filePath);
      const ext = path.extname(filePath).toLowerCase().replace('.', '') || 'png';
      const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : (ext === 'webp' ? 'image/webp' : 'image/png');
      const dataUrl = `data:${mime};base64,${buf.toString('base64')}`;
      return { filePath, dataUrl };
    } catch (e) {
      return { filePath, dataUrl: null };
    }
  }
  return null;
});

// 6. Windows Task Scheduler
ipcMain.handle('scheduler:status', async () => {
  return {
    registered: scheduler.isRegistered(),
    enabled: config.get('taskSchedulerEnabled')
  };
});

ipcMain.handle('scheduler:setEnabled', async (event, enabled, allowElevation = false) => {
  if (enabled) {
    return scheduler.register(process.execPath, { allowElevation });
  } else {
    return scheduler.unregister();
  }
});

ipcMain.handle('app:createStartShortcut', async () => {
  const success = ensureStartMenuShortcut();
  return {
    success,
    message: success ? 'Shortcut "Xbox Grid Sync" created in Windows Start Menu.' : 'Could not create Start Menu shortcut.'
  };
});

ipcMain.handle('scheduler:test', async () => {
  return scheduler.testTrigger();
});

ipcMain.handle('scheduler:openGui', async () => {
  return scheduler.openTaskSchedulerGui();
});

// 7. Window Controls
ipcMain.handle('window:minimize', () => {
  if (mainWindow) mainWindow.minimize();
});

ipcMain.handle('window:maximize', () => {
  if (!mainWindow) return;
  if (mainWindow.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow.maximize();
  }
});

ipcMain.handle('window:close', () => {
  if (!mainWindow) return;
  if (config.get('closeToTray')) {
    mainWindow.hide();
  } else {
    app.quit();
  }
});

