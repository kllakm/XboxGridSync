const fs = require('fs');
const path = require('path');
const os = require('os');

class VaultManager {
  constructor() {
    this.appDataDir = process.env.APPDATA || (
      process.platform === 'win32'
        ? path.join(os.homedir(), 'AppData', 'Roaming')
        : path.join(os.homedir(), '.config')
    );
    this.baseDir = path.join(this.appDataDir, 'XboxGridSync');
    this.vaultDir = path.join(this.baseDir, 'Vault');
    this.cacheDir = path.join(this.baseDir, 'cache');
    this.nameToAppIdPath = path.join(this.cacheDir, 'name_to_appid.json');
    this.nameToAppId = {};
    this.init();
  }

  init() {
    try {
      if (!fs.existsSync(this.vaultDir)) {
        fs.mkdirSync(this.vaultDir, { recursive: true });
      }
      if (!fs.existsSync(this.cacheDir)) {
        fs.mkdirSync(this.cacheDir, { recursive: true });
      }
      if (fs.existsSync(this.nameToAppIdPath)) {
        const raw = fs.readFileSync(this.nameToAppIdPath, 'utf8');
        this.nameToAppId = JSON.parse(raw);
      } else {
        this.saveNameToAppId();
      }
    } catch (err) {
      console.error('[Vault] Error initializing vault directories:', err.message);
    }
  }

  sanitizeIdentifier(id) {
    if (!id) return 'unknown';
    // Allow alphanumeric, dashes, underscores
    return String(id).replace(/[^a-zA-Z0-9_\-\.]/g, '_').toLowerCase();
  }

  getGameVaultDir(gameId) {
    const safeId = this.sanitizeIdentifier(gameId);
    return path.join(this.vaultDir, safeId);
  }

  getCoverPath(gameId) {
    const dir = this.getGameVaultDir(gameId);
    const pngPath = path.join(dir, 'cover.png');
    if (fs.existsSync(pngPath)) return pngPath;
    return path.join(dir, 'cover.jpg');
  }

  hasCover(gameId) {
    try {
      const coverPath = this.getCoverPath(gameId);
      if (fs.existsSync(coverPath)) {
        const stats = fs.statSync(coverPath);
        return stats.size > 500; // valid image size
      }
    } catch (err) {
      // ignore
    }
    return false;
  }

  // Convert buffer to 1:1 square PNG using Electron's nativeImage
  convertToSquarePng(buffer, cropRatioY = 0.35) {
    if (!buffer || buffer.length === 0) return buffer;
    try {
      const { nativeImage } = require('electron');
      const img = nativeImage.createFromBuffer(buffer);
      if (img.isEmpty()) return buffer;

      const size = img.getSize();
      if (!size.width || !size.height) return buffer;

      // If already square (within 2px tolerance)
      if (Math.abs(size.width - size.height) <= 2) {
        return img.toPNG();
      }

      if (size.height > size.width) {
        // Taller than wide (e.g. 600x900 vertical poster)
        const side = size.width;
        const excess = size.height - side;
        const y = Math.max(0, Math.min(excess, Math.round(excess * cropRatioY)));
        const cropped = img.crop({ x: 0, y, width: side, height: side });
        return cropped.toPNG();
      } else {
        // Wider than tall
        const side = size.height;
        const excess = size.width - side;
        const x = Math.max(0, Math.min(excess, Math.round(excess * 0.5)));
        const cropped = img.crop({ x, y: 0, width: side, height: side });
        return cropped.toPNG();
      }
    } catch (e) {
      console.warn('[Vault] Image conversion warning:', e.message);
      return buffer;
    }
  }

  saveCover(gameId, imageBuffer, metadata = {}) {
    try {
      const dir = this.getGameVaultDir(gameId);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // Convert to 1:1 Square PNG unless explicitly bypassed
      const pngBuffer = metadata.isPreCropped ? imageBuffer : this.convertToSquarePng(imageBuffer);

      const coverPngPath = path.join(dir, 'cover.png');
      const coverJpgPath = path.join(dir, 'cover.jpg');
      const metaPath = path.join(dir, 'metadata.json');

      const meta = {
        gameId,
        savedAt: new Date().toISOString(),
        size: pngBuffer.length,
        format: 'png',
        aspectRatio: '1:1',
        targetImagePath: metadata.targetImagePath || null,
        ...metadata
      };

      fs.writeFileSync(coverPngPath, pngBuffer);
      fs.writeFileSync(coverJpgPath, pngBuffer);
      fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf8');
      console.log(`[Vault] Stored 1:1 square PNG cover for ${gameId} (${pngBuffer.length} bytes)`);
      return coverPngPath;
    } catch (err) {
      console.error(`[Vault] Failed to save cover for ${gameId}:`, err.message);
      throw err;
    }
  }

  getCoverBuffer(gameId) {
    try {
      const coverPath = this.getCoverPath(gameId);
      if (fs.existsSync(coverPath)) {
        return fs.readFileSync(coverPath);
      }
    } catch (err) {
      console.error(`[Vault] Error reading cover buffer for ${gameId}:`, err.message);
    }
    return null;
  }

  getCoverAsDataUrl(gameId) {
    const buffer = this.getCoverBuffer(gameId);
    if (buffer) {
      return `data:image/png;base64,${buffer.toString('base64')}`;
    }
    return null;
  }

  getMetadata(gameId) {
    try {
      const dir = this.getGameVaultDir(gameId);
      const metaPath = path.join(dir, 'metadata.json');
      if (fs.existsSync(metaPath)) {
        return JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      }
    } catch (err) {
      // ignore
    }
    return null;
  }

  getAllVaultEntries() {
    const entries = [];
    try {
      if (!fs.existsSync(this.vaultDir)) return entries;
      const subdirs = fs.readdirSync(this.vaultDir, { withFileTypes: true });
      for (const d of subdirs) {
        if (d.isDirectory()) {
          const gameId = d.name;
          const coverPath = this.getCoverPath(gameId);
          if (fs.existsSync(coverPath)) {
            const meta = this.getMetadata(gameId) || {};
            entries.push({
              gameId,
              coverPath,
              savedAt: meta.savedAt || null,
              title: meta.title || gameId,
              launcher: meta.launcher || 'unknown',
              appId: meta.appId || null,
              targetImagePath: meta.targetImagePath || null
            });
          }
        }
      }
    } catch (err) {
      console.error('[Vault] Error listing vault entries:', err.message);
    }
    return entries;
  }

  getCachedAppId(cleanTitle) {
    if (!cleanTitle) return null;
    const key = cleanTitle.trim().toLowerCase();
    return this.nameToAppId[key] || null;
  }

  setCachedAppId(cleanTitle, appid) {
    if (!cleanTitle || !appid) return;
    const key = cleanTitle.trim().toLowerCase();
    this.nameToAppId[key] = appid;
    this.saveNameToAppId();
  }

  saveNameToAppId() {
    try {
      if (!fs.existsSync(this.cacheDir)) {
        fs.mkdirSync(this.cacheDir, { recursive: true });
      }
      fs.writeFileSync(this.nameToAppIdPath, JSON.stringify(this.nameToAppId, null, 2), 'utf8');
    } catch (err) {
      console.error('[Vault] Error saving name_to_appid cache:', err.message);
    }
  }

  // Full reset: delete all vault covers and local cache
  clearAllData() {
    let removedCovers = 0;
    let removedCache = 0;

    try {
      if (fs.existsSync(this.vaultDir)) {
        const entries = fs.readdirSync(this.vaultDir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory()) {
            const dirPath = path.join(this.vaultDir, entry.name);
            fs.rmSync(dirPath, { recursive: true, force: true });
            removedCovers++;
          }
        }
      }
    } catch (err) {
      console.error('[Vault] Error clearing vault:', err.message);
    }

    try {
      if (fs.existsSync(this.cacheDir)) {
        fs.rmSync(this.cacheDir, { recursive: true, force: true });
        fs.mkdirSync(this.cacheDir, { recursive: true });
        removedCache++;
      }
      this.nameToAppId = {};
      this.saveNameToAppId();
    } catch (err) {
      console.error('[Vault] Error clearing cache:', err.message);
    }

    // Clear user-added custom games from config
    try {
      const config = require('./config');
      config.set('customGames', []);
    } catch (err) {}

    console.log(`[Vault] Full reset complete. Removed ${removedCovers} vault entries, cleared cache.`);
    return { removedCovers, removedCache };
  }

  // Clear Xbox App's cached thumbnails from ThirdPartyLibraries, CustomLibraryManagement, ExternalAppShortcut, and ImageCache
  clearXboxAppCache() {
    const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    const xboxPackageDir = path.join(
      localAppData,
      'Packages',
      'Microsoft.GamingApp_8wekyb3d8bbwe'
    );
    const thirdPartyDir = path.join(xboxPackageDir, 'LocalState', 'ThirdPartyLibraries');
    const customLibDir = path.join(thirdPartyDir, 'CustomLibraryManagement');
    const altCustomLibDir = path.join(xboxPackageDir, 'LocalState', 'CustomLibraryManagement');
    const externalShortcutDir = path.join(xboxPackageDir, 'LocalState', 'ExternalAppShortcut');
    const roamingThirdPartyDir = path.join(
      xboxPackageDir,
      'LocalCache',
      'Roaming',
      'Microsoft',
      'XboxPCApp',
      'ThirdPartyLibraries'
    );
    const imageCacheDir = path.join(xboxPackageDir, 'LocalCache', 'ImageCache');

    let removedFiles = 0;
    let restoredFiles = 0;

    // Helper to clean a directory of injected files and restore .bak
    const cleanProviderDirectory = (dirPath, isCustom = false) => {
      if (!fs.existsSync(dirPath)) return;
      try {
        const files = fs.readdirSync(dirPath);

        // 1. Restore all .bak files to .png
        for (const file of files) {
          if (file.toLowerCase().endsWith('.bak')) {
            const bakPath = path.join(dirPath, file);
            const originalPngPath = path.join(dirPath, file.replace(/\.bak$/i, '.png'));
            try {
              fs.copyFileSync(bakPath, originalPngPath);
              fs.unlinkSync(bakPath);
              restoredFiles++;
            } catch (e) {}
          }
        }

        // 2. Remove .new, .tmp, stray duplicate files, and injected custom images
        const recheckFiles = fs.readdirSync(dirPath);
        let manifestContent = '';
        for (const mName of [path.basename(dirPath) + '.manifest', path.basename(dirPath) + '.json', 'CustomLibraryManagement.manifest']) {
          const mPath = path.join(dirPath, mName);
          if (fs.existsSync(mPath)) {
            try { manifestContent += fs.readFileSync(mPath, 'utf8'); } catch (e) {}
          }
        }

        for (const file of recheckFiles) {
          const lower = file.toLowerCase();
          const ext = path.extname(lower);
          const base = path.parse(file).name;
          const isImg = ['.png', '.jpg', '.jpeg', '.webp'].includes(ext);

          let isStray = lower.endsWith('.new') ||
                        lower.endsWith('.tmp') ||
                        lower.includes('_cover.') ||
                        (isCustom && isImg);

          if (!isStray && isImg && !isCustom) {
            const hasManifestMatch = manifestContent && manifestContent.includes(base);
            const hasBackup = fs.existsSync(path.join(dirPath, `${file}.bak`));
            if (!hasManifestMatch && !hasBackup && (!manifestContent || base.startsWith('steam_') || base.startsWith('epic_') || base.startsWith('gog_') || base.startsWith('shortcut_') || base.startsWith('custom_'))) {
              isStray = true;
            }
          }

          if (isStray) {
            try {
              fs.unlinkSync(path.join(dirPath, file));
              removedFiles++;
            } catch (e) {}
          }
        }
      } catch (err) {
        console.warn(`[Vault] Error cleaning ${dirPath}:`, err.message);
      }
    };

    // Clean all providers in ThirdPartyLibraries and Roaming
    const providers = ['steam', 'epic', 'gog', 'bnet', 'ea', 'ubi', 'CustomLibraryManagement'];
    for (const prov of providers) {
      cleanProviderDirectory(path.join(thirdPartyDir, prov), prov === 'CustomLibraryManagement');
      cleanProviderDirectory(path.join(roamingThirdPartyDir, prov), prov === 'CustomLibraryManagement');
    }

    // Clean native CustomLibraryManagement
    cleanProviderDirectory(altCustomLibDir, true);

    // Clean ExternalAppShortcut loose injected images
    if (fs.existsSync(externalShortcutDir)) {
      try {
        const sFiles = fs.readdirSync(externalShortcutDir);
        for (const sf of sFiles) {
          const lower = sf.toLowerCase();
          if (lower.endsWith('.new') || lower.endsWith('.tmp') || lower.endsWith('.bak') || (lower.endsWith('.png') && lower.startsWith('shortcut_'))) {
            try {
              fs.unlinkSync(path.join(externalShortcutDir, sf));
              removedFiles++;
            } catch (e) {}
          }
        }
      } catch (e) {}
    }

    // Reset CustomLibraryManagement manifests in all candidate locations to clean state
    const cleanManifestJson = JSON.stringify({
      version: 1,
      provider: { version: 1, enabled: true },
      gameCache: {}
    }, null, 2);

    const clmCandidates = [
      path.join(customLibDir, 'CustomLibraryManagement.manifest'),
      path.join(customLibDir, 'CustomLibraryManagement.json'),
      path.join(altCustomLibDir, 'CustomLibraryManagement.manifest'),
      path.join(altCustomLibDir, 'CustomLibraryManagement.json'),
      path.join(roamingThirdPartyDir, 'CustomLibraryManagement', 'CustomLibraryManagement.manifest'),
      path.join(roamingThirdPartyDir, 'CustomLibraryManagement', 'CustomLibraryManagement.json')
    ];

    for (const clmPath of clmCandidates) {
      if (fs.existsSync(clmPath)) {
        try {
          fs.writeFileSync(clmPath, cleanManifestJson, 'utf8');
        } catch (e) {}
      }
    }

    // Clean ExternalAppShortcut loose injected images and orphaned/dead shortcuts
    if (fs.existsSync(externalShortcutDir)) {
      try {
        const sFiles = fs.readdirSync(externalShortcutDir);
        for (const sf of sFiles) {
          const lower = sf.toLowerCase();
          const fullPath = path.join(externalShortcutDir, sf);
          if (lower.endsWith('.new') || lower.endsWith('.tmp') || lower.endsWith('.bak') || (lower.endsWith('.png') && lower.startsWith('shortcut_'))) {
            try {
              fs.unlinkSync(fullPath);
              removedFiles++;
            } catch (e) {}
          } else if (lower.endsWith('.json') || lower.endsWith('.manifest')) {
            try {
              const raw = fs.readFileSync(fullPath, 'utf8');
              const parsed = JSON.parse(raw);
              const target = parsed.targetPath || parsed.installPath || parsed.executablePath || '';
              if (!target || !fs.existsSync(target) || parsed.isDeleted || parsed.deleted || parsed.disabled || parsed.enabled === false) {
                fs.unlinkSync(fullPath);
                removedFiles++;
              }
            } catch (e) {}
          }
        }
      } catch (e) {}
    }

    // Purge Xbox App internal thumbnail ImageCache
    if (fs.existsSync(imageCacheDir)) {
      try {
        const icFiles = fs.readdirSync(imageCacheDir);
        for (const icFile of icFiles) {
          try {
            fs.unlinkSync(path.join(imageCacheDir, icFile));
            removedFiles++;
          } catch (e) {}
        }
      } catch (e) {}
    }

    console.log(`[Vault] Xbox App cache reset. Removed ${removedFiles} injected files, restored ${restoredFiles} original backups.`);
    return { removedFiles, restoredFiles };
  }

  // Delete a custom game or shortcut completely from Xbox App manifests, shortcut files, Vault, and cache
  deleteCustomGame(game) {
    if (!game) return { success: false, error: 'No game specified' };

    const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    const xboxPackageDir = path.join(
      localAppData,
      'Packages',
      'Microsoft.GamingApp_8wekyb3d8bbwe'
    );
    const thirdPartyDir = path.join(xboxPackageDir, 'LocalState', 'ThirdPartyLibraries');
    const customLibDir = path.join(thirdPartyDir, 'CustomLibraryManagement');
    const altCustomLibDir = path.join(xboxPackageDir, 'LocalState', 'CustomLibraryManagement');
    const externalShortcutDir = path.join(xboxPackageDir, 'LocalState', 'ExternalAppShortcut');
    const roamingThirdPartyDir = path.join(
      xboxPackageDir,
      'LocalCache',
      'Roaming',
      'Microsoft',
      'XboxPCApp',
      'ThirdPartyLibraries'
    );
    const imageCacheDir = path.join(xboxPackageDir, 'LocalCache', 'ImageCache');

    const safeId = this.sanitizeIdentifier(game.id || game.originalId || game.title);
    const targetTitle = (game.title || '').toLowerCase().trim();
    const targetInstallPath = (game.installPath || '').toLowerCase().trim();
    const origId = String(game.originalId || '').toLowerCase().trim();

    console.log(`[Vault] Permanently deleting custom game: "${game.title}" (${game.id})`);

    // 1. Delete matching shortcut files in ExternalAppShortcut
    if (fs.existsSync(externalShortcutDir)) {
      try {
        const sFiles = fs.readdirSync(externalShortcutDir);
        for (const sf of sFiles) {
          const fullSPath = path.join(externalShortcutDir, sf);
          if (game.shortcutManifestPath && path.resolve(game.shortcutManifestPath).toLowerCase() === path.resolve(fullSPath).toLowerCase()) {
            try { fs.unlinkSync(fullSPath); } catch (e) {}
            continue;
          }
          if (sf.endsWith('.json') || sf.endsWith('.manifest')) {
            try {
              const raw = fs.readFileSync(fullSPath, 'utf8');
              const parsed = JSON.parse(raw);
              const pId = String(parsed.id || '').toLowerCase();
              const pTitle = String(parsed.title || parsed.name || '').toLowerCase().trim();
              const pTarget = String(parsed.targetPath || parsed.installPath || parsed.executablePath || '').toLowerCase().trim();

              if ((pId && (pId === origId || pId === safeId || `shortcut_${pId}` === safeId)) ||
                  (targetTitle && pTitle === targetTitle) ||
                  (targetInstallPath && pTarget && pTarget === targetInstallPath)) {
                try { fs.unlinkSync(fullSPath); } catch (e) {}
              }
            } catch (e) {}
          }
          // Remove associated image files
          const lower = sf.toLowerCase();
          if (lower === `${safeId}.png` || lower === `shortcut_${safeId}.png` || (origId && lower.includes(origId))) {
            try { fs.unlinkSync(fullSPath); } catch (e) {}
          }
        }
      } catch (e) {}
    }

    // 2. Remove entry from CustomLibraryManagement manifests in all locations
    const manifestCandidates = [
      path.join(customLibDir, 'CustomLibraryManagement.manifest'),
      path.join(customLibDir, 'CustomLibraryManagement.json'),
      path.join(altCustomLibDir, 'CustomLibraryManagement.manifest'),
      path.join(altCustomLibDir, 'CustomLibraryManagement.json'),
      path.join(roamingThirdPartyDir, 'CustomLibraryManagement', 'CustomLibraryManagement.manifest'),
      path.join(roamingThirdPartyDir, 'CustomLibraryManagement', 'CustomLibraryManagement.json')
    ];

    for (const mPath of manifestCandidates) {
      if (!fs.existsSync(mPath)) continue;
      try {
        const raw = fs.readFileSync(mPath, 'utf8').trim().replace(/^\uFEFF/, '');
        if (!raw) continue;
        const parsed = JSON.parse(raw);
        if (parsed && parsed.gameCache) {
          let modified = false;
          if (Array.isArray(parsed.gameCache.games)) {
            const before = parsed.gameCache.games.length;
            parsed.gameCache.games = parsed.gameCache.games.filter(it => {
              const itId = String(it.id || it.title || '').toLowerCase();
              const itTitle = String(it.title || it.name || '').toLowerCase().trim();
              const itPath = String(it.installLocation || it.installPath || '').toLowerCase().trim();
              return !(itId === safeId || itId === origId || (targetTitle && itTitle === targetTitle) || (targetInstallPath && itPath === targetInstallPath));
            });
            if (parsed.gameCache.games.length !== before) modified = true;
          } else if (typeof parsed.gameCache === 'object') {
            for (const [key, val] of Object.entries(parsed.gameCache)) {
              if (key === 'version') continue;
              const kLower = key.toLowerCase();
              const vTitle = (val && (val.title || val.name) ? String(val.title || val.name).toLowerCase().trim() : '');
              const vPath = (val && (val.installLocation || val.installPath) ? String(val.installLocation || val.installPath).toLowerCase().trim() : '');
              if (kLower === safeId || kLower === origId || `shortcut_${kLower}` === safeId ||
                  (targetTitle && vTitle === targetTitle) ||
                  (targetInstallPath && vPath === targetInstallPath)) {
                delete parsed.gameCache[key];
                modified = true;
              }
            }
          }
          if (modified) {
            fs.writeFileSync(mPath, JSON.stringify(parsed, null, 2), 'utf8');
          }
        }
      } catch (e) {}
    }

    // 3. Remove loose artwork images in CustomLibraryManagement directories
    [customLibDir, altCustomLibDir, path.join(roamingThirdPartyDir, 'CustomLibraryManagement')].forEach(dir => {
      if (!fs.existsSync(dir)) return;
      try {
        const files = fs.readdirSync(dir);
        for (const f of files) {
          const fLower = f.toLowerCase();
          if (fLower === `${safeId}.png` || fLower === `${safeId}.jpg` || (origId && fLower.includes(origId))) {
            try { fs.unlinkSync(path.join(dir, f)); } catch (e) {}
          }
        }
      } catch (e) {}
    });

    // 4. Remove from Vault
    const vDir = this.getGameVaultDir(game.id);
    if (fs.existsSync(vDir)) {
      try { fs.rmSync(vDir, { recursive: true, force: true }); } catch (e) {}
    }
    if (game.originalId && game.originalId !== game.id) {
      const vDirAlt = this.getGameVaultDir(game.originalId);
      if (fs.existsSync(vDirAlt)) {
        try { fs.rmSync(vDirAlt, { recursive: true, force: true }); } catch (e) {}
      }
    }

    // 5. Remove from user customGames config if stored there
    try {
      const config = require('./config');
      config.removeCustomGame(game.id);
      if (game.originalId) config.removeCustomGame(game.originalId);
    } catch (e) {}

    // 6. Purge Xbox App internal thumbnail ImageCache
    if (fs.existsSync(imageCacheDir)) {
      try {
        const icFiles = fs.readdirSync(imageCacheDir);
        for (const ic of icFiles) {
          try { fs.unlinkSync(path.join(imageCacheDir, ic)); } catch (e) {}
        }
      } catch (e) {}
    }

    return { success: true };
  }
}

module.exports = new VaultManager();

