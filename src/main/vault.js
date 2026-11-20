const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

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
    this.shortcutMappingsPath = path.join(this.baseDir, 'shortcut_mappings.json');
    this.shortcutMappings = {};
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
      if (fs.existsSync(this.shortcutMappingsPath)) {
        const mRaw = fs.readFileSync(this.shortcutMappingsPath, 'utf8');
        this.shortcutMappings = JSON.parse(mRaw);
      } else {
        this.saveShortcutMappings();
      }
    } catch (err) {
      console.error('[Vault] Error initializing vault directories:', err.message);
    }
  }

  saveShortcutMappings() {
    try {
      fs.writeFileSync(this.shortcutMappingsPath, JSON.stringify(this.shortcutMappings, null, 2), 'utf8');
    } catch (err) {
      console.error('[Vault] Error saving shortcut mappings:', err.message);
    }
  }

  // Generate a persistent, deduplicated key for non-Steam custom shortcuts
  // based on sanitized title and a deterministic hash of target executable path
  getPersistentCustomKey(title, targetPathOrInstallLocation) {
    const safeTitle = (title || 'custom')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '') || 'app';

    const normPath = (targetPathOrInstallLocation || '')
      .toLowerCase()
      .trim()
      .replace(/\\/g, '/');

    const pathHash = crypto
      .createHash('md5')
      .update(normPath || safeTitle)
      .digest('hex')
      .substring(0, 10);

    return `custom_${safeTitle}_${pathHash}`;
  }

  // Map transient Xbox shortcut instance ID or GUID to a persistent Vault key
  registerShortcutMapping(instanceId, persistentKey, details = {}) {
    if (!instanceId || !persistentKey) return;
    const safeInst = this.sanitizeIdentifier(instanceId);
    this.shortcutMappings[safeInst] = {
      persistentKey,
      title: details.title || null,
      installPath: details.installPath || null,
      updatedAt: new Date().toISOString()
    };
    this.saveShortcutMappings();
  }

  // Resolve whether game or ID maps to a persistent Vault key
  resolveVaultKey(gameOrId) {
    if (!gameOrId) return 'unknown';

    if (typeof gameOrId === 'object') {
      const game = gameOrId;
      if (game.vaultKey) return this.sanitizeIdentifier(game.vaultKey);

      const safeId = this.sanitizeIdentifier(game.id || game.title);
      if (this.shortcutMappings[safeId]) {
        return this.shortcutMappings[safeId].persistentKey;
      }
      if (game.originalId) {
        const safeOrig = this.sanitizeIdentifier(game.originalId);
        if (this.shortcutMappings[safeOrig]) {
          return this.shortcutMappings[safeOrig].persistentKey;
        }
      }

      const launcher = (game.launcher || '').toUpperCase();
      const source = (game.source || '').toLowerCase();
      const isCustomShortcut = (launcher === 'SHORTCUT' || source === 'xbox_shortcut' || source === 'user_custom' || source === 'custom_manifest') && !game.appId;

      if (isCustomShortcut) {
        const pKey = this.getPersistentCustomKey(game.title, game.installPath || game.targetImagePath);
        if (game.id) this.registerShortcutMapping(game.id, pKey, game);
        if (game.originalId) this.registerShortcutMapping(game.originalId, pKey, game);
        return pKey;
      }

      return safeId;
    }

    const safeId = this.sanitizeIdentifier(gameOrId);
    if (this.shortcutMappings[safeId]) {
      return this.shortcutMappings[safeId].persistentKey;
    }

    // Check if any mapping targets this exact persistent key
    for (const [mId, mapped] of Object.entries(this.shortcutMappings)) {
      if (mapped.persistentKey === safeId) {
        return safeId;
      }
    }

    return safeId;
  }

  sanitizeIdentifier(id) {
    if (!id) return 'unknown';
    // Allow alphanumeric, dashes, underscores
    return String(id).replace(/[^a-zA-Z0-9_\-\.]/g, '_').toLowerCase();
  }

  getGameVaultDir(gameIdOrGame) {
    const key = this.resolveVaultKey(gameIdOrGame);
    return path.join(this.vaultDir, key);
  }

  getCoverPath(gameIdOrGame) {
    const dir = this.getGameVaultDir(gameIdOrGame);
    const pngPath = path.join(dir, 'cover.png');
    if (fs.existsSync(pngPath)) return pngPath;
    const jpgPath = path.join(dir, 'cover.jpg');
    if (fs.existsSync(jpgPath)) return jpgPath;

    // Fallback 1: check raw unmapped gameId folder in case it was saved before normalization
    const rawId = typeof gameIdOrGame === 'object' ? (gameIdOrGame.id || gameIdOrGame.title) : gameIdOrGame;
    if (rawId) {
      const rawDir = path.join(this.vaultDir, this.sanitizeIdentifier(rawId));
      if (rawDir !== dir) {
        const rawPng = path.join(rawDir, 'cover.png');
        if (fs.existsSync(rawPng)) return rawPng;
        const rawJpg = path.join(rawDir, 'cover.jpg');
        if (fs.existsSync(rawJpg)) return rawJpg;
      }
    }

    // Fallback 2: check game.vaultKey if passed directly in object
    if (typeof gameIdOrGame === 'object' && gameIdOrGame.vaultKey) {
      const vkDir = path.join(this.vaultDir, this.sanitizeIdentifier(gameIdOrGame.vaultKey));
      if (vkDir !== dir) {
        const vkPng = path.join(vkDir, 'cover.png');
        if (fs.existsSync(vkPng)) return vkPng;
        const vkJpg = path.join(vkDir, 'cover.jpg');
        if (fs.existsSync(vkJpg)) return vkJpg;
      }
    }

    // Fallback 3: Title-based fuzzy / directory matching fallback:
    // If the title is known, search the Vault directory for any existing folder for this title!
    const title = typeof gameIdOrGame === 'object' ? gameIdOrGame.title : (rawId && this.shortcutMappings[this.sanitizeIdentifier(rawId)]?.title ? this.shortcutMappings[this.sanitizeIdentifier(rawId)].title : null);
    if (title) {
      const safeTitle = title.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (safeTitle.length >= 2 && !['game', 'custom', 'shortcut', 'app'].includes(safeTitle)) {
        try {
          if (fs.existsSync(this.vaultDir)) {
            const dirs = fs.readdirSync(this.vaultDir, { withFileTypes: true });
            for (const d of dirs) {
              if (d.isDirectory()) {
                const dNameLower = d.name.toLowerCase();
                // Match custom_<safeTitle>_* or shortcut_<safeTitle> or <safeTitle>
                if (dNameLower.startsWith(`custom_${safeTitle}_`    ) ||
                    dNameLower.startsWith(`shortcut_${safeTitle}`) ||
                    dNameLower === safeTitle ||
                    dNameLower.includes(safeTitle)) {
                  const candidateDir = path.join(this.vaultDir, d.name);
                  const cPng = path.join(candidateDir, 'cover.png');
                  if (fs.existsSync(cPng)) {
                    try {
                      if (fs.statSync(cPng).size > 500) {
                        if (rawId) this.registerShortcutMapping(rawId, d.name, { title });
                        return cPng;
                      }
                    } catch (e) {}
                  }
                  const cJpg = path.join(candidateDir, 'cover.jpg');
                  if (fs.existsSync(cJpg)) {
                    try {
                      if (fs.statSync(cJpg).size > 500) {
                        if (rawId) this.registerShortcutMapping(rawId, d.name, { title });
                        return cJpg;
                      }
                    } catch (e) {}
                  }
                }
              }
            }
          }
        } catch (e) {}
      }
    }

    // Fallback 4: check if the game has an active targetImagePath or currentThumbnail already on disk!
    if (typeof gameIdOrGame === 'object') {
      const activeThumbnail = gameIdOrGame.currentThumbnail || gameIdOrGame.targetImagePath;
      if (activeThumbnail && typeof activeThumbnail === 'string' && fs.existsSync(activeThumbnail) && !activeThumbnail.toLowerCase().endsWith('.exe')) {
        try {
          const stats = fs.statSync(activeThumbnail);
          if (stats.size > 500) {
            // Auto-ingest into Vault under the resolved directory so future lookups find it instantly!
            try {
              const buf = fs.readFileSync(activeThumbnail);
              if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
              fs.writeFileSync(pngPath, buf);
              fs.writeFileSync(jpgPath, buf);
              return pngPath;
            } catch (ingestErr) {}
            return activeThumbnail;
          }
        } catch (e) {}
      }
    }

    return pngPath;
  }

  hasCover(gameIdOrGame) {
    try {
      const coverPath = this.getCoverPath(gameIdOrGame);
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
        // If already a PNG buffer, return directly without expensive synchronous re-encoding
        if (buffer.length > 8 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) {
          return buffer;
        }
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

  saveCover(gameIdOrGame, imageBuffer, metadata = {}) {
    try {
      const targetObj = typeof gameIdOrGame === 'object'
        ? gameIdOrGame
        : { id: gameIdOrGame, ...metadata };

      const vKey = this.resolveVaultKey(metadata.vaultKey ? metadata.vaultKey : targetObj);
      const dir = path.join(this.vaultDir, vKey);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const rawId = typeof gameIdOrGame === 'object' ? gameIdOrGame.id : gameIdOrGame;
      const combinedTitle = metadata.title || (typeof gameIdOrGame === 'object' ? gameIdOrGame.title : null);
      const combinedInstallPath = metadata.installPath || (typeof gameIdOrGame === 'object' ? gameIdOrGame.installPath : null);
      const combinedTargetImage = metadata.targetImagePath || (typeof gameIdOrGame === 'object' ? gameIdOrGame.targetImagePath : null);
      const originalId = metadata.originalId || (typeof gameIdOrGame === 'object' ? gameIdOrGame.originalId : null);

      if (rawId && rawId !== vKey) {
        this.registerShortcutMapping(rawId, vKey, { title: combinedTitle, installPath: combinedInstallPath });
      }
      if (originalId && originalId !== vKey) {
        this.registerShortcutMapping(originalId, vKey, { title: combinedTitle, installPath: combinedInstallPath });
      }

      // Convert to 1:1 Square PNG unless explicitly bypassed
      const pngBuffer = metadata.isPreCropped ? imageBuffer : this.convertToSquarePng(imageBuffer);

      const coverPngPath = path.join(dir, 'cover.png');
      const coverJpgPath = path.join(dir, 'cover.jpg');
      const metaPath = path.join(dir, 'metadata.json');

      const meta = {
        gameId: rawId,
        vaultKey: vKey,
        originalId: originalId || null,
        savedAt: new Date().toISOString(),
        size: pngBuffer.length,
        format: 'png',
        aspectRatio: '1:1',
        title: combinedTitle,
        installPath: combinedInstallPath,
        targetImagePath: combinedTargetImage,
        ...(typeof gameIdOrGame === 'object' ? gameIdOrGame : {}),
        ...metadata
      };
      // Never persist huge base64 coverUrl strings inside metadata.json
      delete meta.coverUrl;

      fs.writeFileSync(coverPngPath, pngBuffer);
      fs.writeFileSync(coverJpgPath, pngBuffer);
      fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf8');
      console.log(`[Vault] Stored 1:1 square PNG cover in ${vKey} (${pngBuffer.length} bytes)`);
      return coverPngPath;
    } catch (err) {
      console.error(`[Vault] Failed to save cover:`, err.message);
      throw err;
    }
  }

  getCoverBuffer(gameIdOrGame) {
    try {
      const coverPath = this.getCoverPath(gameIdOrGame);
      if (fs.existsSync(coverPath)) {
        return fs.readFileSync(coverPath);
      }
    } catch (err) {
      console.error(`[Vault] Error reading cover buffer:`, err.message);
    }
    return null;
  }

  getCoverAsDataUrl(gameIdOrGame) {
    try {
      const coverPath = this.getCoverPath(gameIdOrGame);
      if (coverPath && fs.existsSync(coverPath)) {
        const { pathToFileURL } = require('url');
        const stat = fs.statSync(coverPath);
        return `${pathToFileURL(coverPath).href}?t=${Math.floor(stat.mtimeMs)}`;
      }
    } catch (err) {
      console.error(`[Vault] Error resolving cover URL:`, err.message);
    }
    return null;
  }

  getMetadata(gameIdOrGame) {
    try {
      const dir = this.getGameVaultDir(gameIdOrGame);
      const metaPath = path.join(dir, 'metadata.json');
      if (fs.existsSync(metaPath)) {
        return JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      }
      // Fallback to raw folder
      const rawId = typeof gameIdOrGame === 'object' ? gameIdOrGame.id : gameIdOrGame;
      if (rawId) {
        const rawMeta = path.join(this.vaultDir, this.sanitizeIdentifier(rawId), 'metadata.json');
        if (fs.existsSync(rawMeta)) {
          return JSON.parse(fs.readFileSync(rawMeta, 'utf8'));
        }
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

  // Prune cached artwork folders in Vault whose corresponding games/shortcuts
  // no longer exist in any active launcher, config, or Xbox App cache
  cleanOrphanedVaultFolders(activeGames = null) {
    let prunedCount = 0;
    let freedBytes = 0;
    const prunedFolders = [];

    if (!fs.existsSync(this.vaultDir)) {
      return { prunedCount, freedBytes, prunedFolders };
    }

    // Build authoritative set of active keys, IDs, titles, and target paths
    const activeKeys = new Set();
    const activePaths = new Set();
    const activeTitles = new Set();

    let games = activeGames;
    if (!games || !Array.isArray(games) || games.length === 0) {
      try {
        const scanner = require('./scanner');
        games = scanner.getCachedLibrary() || [];
      } catch (e) {
        games = [];
      }
    }

    for (const g of games) {
      if (g.id) activeKeys.add(this.sanitizeIdentifier(g.id));
      if (g.originalId) activeKeys.add(this.sanitizeIdentifier(g.originalId));
      if (g.vaultKey) activeKeys.add(this.sanitizeIdentifier(g.vaultKey));
      if (g.appId) activeKeys.add(`steam_${g.appId}`);
      if (g.title) {
        activeTitles.add(g.title.toLowerCase().trim());
        activeTitles.add(g.title.toLowerCase().replace(/[^a-z0-9]/g, ''));
      }
      if (g.installPath) {
        activePaths.add(path.resolve(g.installPath).toLowerCase());
      }
    }

    // Include registered persistent keys from shortcut mappings
    for (const [sId, mapped] of Object.entries(this.shortcutMappings)) {
      activeKeys.add(this.sanitizeIdentifier(sId));
      if (mapped.persistentKey) {
        activeKeys.add(this.sanitizeIdentifier(mapped.persistentKey));
      }
      if (mapped.installPath) {
        activePaths.add(path.resolve(mapped.installPath).toLowerCase());
      }
      if (mapped.title) {
        activeTitles.add(mapped.title.toLowerCase().trim());
      }
    }

    try {
      const subdirs = fs.readdirSync(this.vaultDir, { withFileTypes: true });
      for (const d of subdirs) {
        if (!d.isDirectory()) continue;
        const folderName = d.name;
        const folderPath = path.join(this.vaultDir, folderName);
        const folderKey = this.sanitizeIdentifier(folderName);

        // Check 1: Is folder directly matched to an active key?
        if (activeKeys.has(folderKey)) {
          continue;
        }

        // Check 2: Inspect metadata.json if present
        let isReferenced = false;
        const metaPath = path.join(folderPath, 'metadata.json');
        if (fs.existsSync(metaPath)) {
          try {
            const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
            const mId = meta.gameId ? this.sanitizeIdentifier(meta.gameId) : null;
            const mVKey = meta.vaultKey ? this.sanitizeIdentifier(meta.vaultKey) : null;
            const mTitle = meta.title ? meta.title.toLowerCase().trim() : null;
            const mTitleNorm = meta.title ? meta.title.toLowerCase().replace(/[^a-z0-9]/g, '') : null;
            const mPath = meta.installPath ? path.resolve(meta.installPath).toLowerCase() : null;

            if (mId && activeKeys.has(mId)) isReferenced = true;
            if (mVKey && activeKeys.has(mVKey)) isReferenced = true;
            if (mTitle && (activeTitles.has(mTitle) || (mTitleNorm && activeTitles.has(mTitleNorm)))) isReferenced = true;
            if (mPath && (activePaths.has(mPath) || fs.existsSync(mPath))) isReferenced = true;
          } catch (e) {}
        }

        if (isReferenced) continue;

        // Folder is confirmed orphaned -> prune it
        let folderSize = 0;
        try {
          const files = fs.readdirSync(folderPath);
          for (const f of files) {
            try {
              const stat = fs.statSync(path.join(folderPath, f));
              folderSize += stat.size;
            } catch (e) {}
          }
          fs.rmSync(folderPath, { recursive: true, force: true });
          prunedCount++;
          freedBytes += folderSize;
          prunedFolders.push(folderName);
          console.log(`[Vault] Pruned orphaned vault folder: ${folderName} (${folderSize} bytes)`);
        } catch (rmErr) {
          console.warn(`[Vault] Could not prune folder ${folderName}:`, rmErr.message);
        }
      }

      // Also clean dead mappings from shortcut_mappings.json
      let mappingsChanged = false;
      for (const [sId, mapped] of Object.entries(this.shortcutMappings)) {
        if (!activeKeys.has(this.sanitizeIdentifier(sId)) && (!mapped.installPath || !fs.existsSync(mapped.installPath))) {
          delete this.shortcutMappings[sId];
          mappingsChanged = true;
        }
      }
      if (mappingsChanged) this.saveShortcutMappings();

    } catch (err) {
      console.error('[Vault] Error in cleanOrphanedVaultFolders:', err.message);
    }

    console.log(`[Vault] Orphan cleanup completed: ${prunedCount} folders pruned, ${(freedBytes / (1024 * 1024)).toFixed(2)} MB freed.`);
    return { prunedCount, freedBytes, prunedFolders };
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

    try {
      this.shortcutMappings = {};
      this.saveShortcutMappings();
    } catch (err) {}

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

