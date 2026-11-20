const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync, spawn } = require('child_process');
const vault = require('./vault');

class XboxAppInjector {
  constructor() {
    this.localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    this.packagePath = path.join(
      this.localAppData,
      'Packages',
      'Microsoft.GamingApp_8wekyb3d8bbwe'
    );
    this.customLibraryDir = path.join(
      this.packagePath,
      'LocalState',
      'ThirdPartyLibraries',
      'CustomLibraryManagement'
    );
    this.altCustomLibraryDir = path.join(
      this.packagePath,
      'LocalState',
      'CustomLibraryManagement'
    );
    this.clmImagesDir = path.join(
      this.packagePath,
      'LocalState',
      'CustomLibraryManagement',
      'images'
    );
    this.externalShortcutDir = path.join(
      this.packagePath,
      'LocalState',
      'ExternalAppShortcut'
    );
    this.thirdPartyDir = path.join(
      this.packagePath,
      'LocalState',
      'ThirdPartyLibraries'
    );
    this.imageCacheDir = path.join(
      this.packagePath,
      'LocalCache',
      'ImageCache'
    );
    this.ebWebViewCacheDir = path.join(
      this.packagePath,
      'LocalState',
      'EBWebView',
      'Default',
      'Cache'
    );
    this.ebWebViewCodeCacheDir = path.join(
      this.packagePath,
      'LocalState',
      'EBWebView',
      'Default',
      'Code Cache'
    );
    this.wcfWebViewCacheDir = path.join(
      this.packagePath,
      'LocalState',
      'wcf.data',
      'webview.data',
      'EBWebView',
      'Default',
      'Cache'
    );
    this.wcfWebViewCodeCacheDir = path.join(
      this.packagePath,
      'LocalState',
      'wcf.data',
      'webview.data',
      'EBWebView',
      'Default',
      'Code Cache'
    );
    this.asyncCachePath = path.join(
      this.packagePath,
      'LocalState',
      'AsyncCache.db'
    );
    this.clmManifestPath = path.join(
      this.customLibraryDir,
      'CustomLibraryManagement.manifest'
    );
    this.altClmManifestPath = path.join(
      this.altCustomLibraryDir,
      'CustomLibraryManagement.manifest'
    );
    this.lastWriteTime = 0;
  }

  isXboxAppRunning() {
    try {
      const { spawnSync } = require('child_process');
      const res = spawnSync('tasklist.exe', ['/FI', 'IMAGENAME eq XboxPcApp.exe', '/NH'], {
        encoding: 'utf8',
        windowsHide: true
      });
      return !!(res.stdout && res.stdout.toLowerCase().includes('xboxpcapp.exe'));
    } catch (err) {
      return false;
    }
  }

  async isXboxAppRunningAsync() {
    return new Promise((resolve) => {
      const { execFile } = require('child_process');
      execFile('tasklist.exe', ['/FI', 'IMAGENAME eq XboxPcApp.exe', '/NH'], { windowsHide: true }, (err, stdout) => {
        if (err || !stdout) return resolve(false);
        resolve(stdout.toLowerCase().includes('xboxpcapp.exe'));
      });
    });
  }

  getRunningXboxProcesses() {
    try {
      const { spawnSync } = require('child_process');
      const targets = ['XboxPcApp.exe', 'XboxAppServices.exe', 'XboxPcTray.exe', 'XboxPcAppCE.exe'];
      const res = spawnSync('tasklist.exe', ['/FO', 'CSV', '/NH'], {
        encoding: 'utf8',
        windowsHide: true
      });
      if (!res.stdout) return [];
      const outLower = res.stdout.toLowerCase();
      return targets.filter(t => outLower.includes(t.toLowerCase())).map(t => t.replace(/\.exe$/i, ''));
    } catch (err) {
      return [];
    }
  }

  terminateXboxProcesses() {
    console.log('[Injector] Terminating Xbox app processes and background services...');
    try {
      const { spawnSync } = require('child_process');
      spawnSync('taskkill.exe', [
        '/F',
        '/IM', 'XboxPcApp.exe',
        '/IM', 'Xbox.exe',
        '/IM', 'XboxAppServices.exe',
        '/IM', 'XboxPcTray.exe',
        '/IM', 'XboxPcAppCE.exe'
      ], { stdio: 'ignore', windowsHide: true });
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }

  async terminateXboxProcessesAsync() {
    console.log('[Injector] Terminating Xbox app processes and background services (async)...');
    return new Promise((resolve) => {
      const { execFile } = require('child_process');
      execFile('taskkill.exe', [
        '/F',
        '/IM', 'XboxPcApp.exe',
        '/IM', 'Xbox.exe',
        '/IM', 'XboxAppServices.exe',
        '/IM', 'XboxPcTray.exe',
        '/IM', 'XboxPcAppCE.exe'
      ], { windowsHide: true }, () => {
        resolve({ success: true });
      });
    });
  }

  async restartXboxApp() {
    console.log('[Injector] Restarting Xbox PC App & background services...');
    try {
      await this.terminateXboxProcessesAsync();
      await new Promise(r => setTimeout(r, 1000));
      spawn('cmd.exe', ['/c', 'start', 'xbox:'], {
        detached: true,
        stdio: 'ignore'
      }).unref();
      return { success: true, message: 'Xbox App and background services restarted successfully.' };
    } catch (err) {
      console.error('[Injector] Error restarting Xbox App:', err.message);
      return { success: false, error: err.message };
    }
  }

  ensureDirectories() {
    if (!fs.existsSync(this.customLibraryDir)) {
      fs.mkdirSync(this.customLibraryDir, { recursive: true });
    }
    if (!fs.existsSync(this.altCustomLibraryDir)) {
      fs.mkdirSync(this.altCustomLibraryDir, { recursive: true });
    }
    if (!fs.existsSync(this.clmImagesDir)) {
      fs.mkdirSync(this.clmImagesDir, { recursive: true });
    }
    if (!fs.existsSync(this.externalShortcutDir)) {
      fs.mkdirSync(this.externalShortcutDir, { recursive: true });
    }
    if (!fs.existsSync(this.imageCacheDir)) {
      fs.mkdirSync(this.imageCacheDir, { recursive: true });
    }
  }

  // Invalidate Xbox App's internal image thumbnail cache, WebView2 caches, and database caches (async, non-blocking)
  async clearImageCache(terminateFirst = false) {
    const running = terminateFirst || await this.isXboxAppRunningAsync();
    if (running) {
      await this.terminateXboxProcessesAsync();
      await new Promise(r => setTimeout(r, 300));
    }

    // 1. Purge LocalCache\ImageCache (all files + ImageCache.db)
    try {
      if (fs.existsSync(this.imageCacheDir)) {
        const files = await fs.promises.readdir(this.imageCacheDir);
        for (const file of files) {
          try {
            await fs.promises.unlink(path.join(this.imageCacheDir, file));
          } catch (e) {}
        }
      }
    } catch (err) {
      console.warn('[Injector] Could not purge ImageCache:', err.message);
    }

    // 2. Purge Edge WebView2 disk caches asynchronously
    const webViewDirs = [
      this.ebWebViewCacheDir,
      this.ebWebViewCodeCacheDir,
      this.wcfWebViewCacheDir,
      this.wcfWebViewCodeCacheDir
    ];
    for (const wDir of webViewDirs) {
      if (fs.existsSync(wDir)) {
        try {
          const files = await fs.promises.readdir(wDir);
          for (const f of files) {
            try {
              const fullF = path.join(wDir, f);
              await fs.promises.rm(fullF, { recursive: true, force: true });
            } catch (e) {}
          }
        } catch (e) {}
      }
    }

    // 3. Invalidate AsyncCache.db if present
    try {
      const dbFiles = [
        this.asyncCachePath,
        `${this.asyncCachePath}-shm`,
        `${this.asyncCachePath}-wal`
      ];
      for (const dbf of dbFiles) {
        if (fs.existsSync(dbf)) {
          try { await fs.promises.unlink(dbf); } catch (e) {}
        }
      }
    } catch (e) {}
  }

  // Locate an existing shortcut manifest file in ExternalAppShortcut for a game
  findShortcutManifest(game) {
    if (!fs.existsSync(this.externalShortcutDir)) return null;
    try {
      if (game.shortcutManifestPath && fs.existsSync(game.shortcutManifestPath)) {
        return game.shortcutManifestPath;
      }
      const cleanTitle = (game.title || '').toLowerCase().trim();
      const origId = String(game.originalId || game.id || '').toLowerCase().trim();
      const safeId = vault.sanitizeIdentifier(game.id || game.title).toLowerCase();
      const targetInstallPath = (game.installPath || '').toLowerCase().trim();

      const files = fs.readdirSync(this.externalShortcutDir);
      for (const sFile of files) {
        if (!sFile.endsWith('.json') && !sFile.endsWith('.manifest')) continue;
        const fullSPath = path.join(this.externalShortcutDir, sFile);
        try {
          const sRaw = fs.readFileSync(fullSPath, 'utf8');
          const sParsed = JSON.parse(sRaw);
          const pId = String(sParsed.id || '').toLowerCase().trim();
          const pTitle = String(sParsed.title || sParsed.name || '').toLowerCase().trim();
          const pTarget = String(sParsed.targetPath || sParsed.installPath || sParsed.executablePath || '').toLowerCase().trim();

          if ((pId && (pId === origId || pId === safeId || `shortcut_${pId}` === safeId)) ||
              (cleanTitle && pTitle === cleanTitle) ||
              (targetInstallPath && pTarget && pTarget === targetInstallPath)) {
            return fullSPath;
          }
        } catch (e) {}
      }
    } catch (e) {}
    return null;
  }

  // Update only the ExternalAppShortcut manifest iconPath without polluting CustomLibraryManagement
  updateShortcutManifestIcon(game, injectedImagePath) {
    try {
      this.ensureDirectories();
      const manifestPath = this.findShortcutManifest(game);
      if (manifestPath && fs.existsSync(manifestPath)) {
        try {
          const sRaw = fs.readFileSync(manifestPath, 'utf8');
          const sParsed = JSON.parse(sRaw);
          sParsed.iconPath = injectedImagePath;
          if (sParsed.imagePath) sParsed.imagePath = injectedImagePath;
          fs.writeFileSync(manifestPath, JSON.stringify(sParsed, null, 2), 'utf8');
          console.log(`[Injector] Updated ExternalAppShortcut icon for "${game.title}" -> ${manifestPath}`);
        } catch (e) {
          console.warn(`[Injector] Could not update shortcut manifest ${manifestPath}:`, e.message);
        }
      }
    } catch (err) {
      console.warn('[Injector] Could not update shortcut icon:', err.message);
    }
  }

  // Update or insert into CustomLibraryManagement.manifest ONLY for non-shortcut custom games
  updateCustomManifestGame(game, injectedImagePath) {
    try {
      this.ensureDirectories();
      const safeId = game.originalId || vault.sanitizeIdentifier(game.id || game.title);
      const cleanTitle = game.title || 'Game';

      // Update CustomLibraryManagement.manifest in BOTH locations (native LocalState and ThirdPartyLibraries)
      const manifestTargets = [this.altClmManifestPath, this.clmManifestPath];
      for (const mPath of manifestTargets) {
        try {
          let manifest = {
            version: 1,
            provider: { version: 1, enabled: true },
            gameCache: {}
          };

          if (fs.existsSync(mPath)) {
            try {
              const raw = fs.readFileSync(mPath, 'utf8');
              manifest = JSON.parse(raw);
              if (!manifest.gameCache || typeof manifest.gameCache !== 'object') {
                manifest.gameCache = {};
              }
            } catch (e) {}
          }

          manifest.gameCache[safeId] = {
            id: safeId,
            title: cleanTitle,
            provider: (game.launcher || 'CUSTOM').toLowerCase(),
            installLocation: game.installPath || '',
            executableName: game.executableName || '',
            imagePath: injectedImagePath,
            addedDate: Date.now().toString(),
            lastUpdated: new Date().toISOString()
          };

          const mDir = path.dirname(mPath);
          if (!fs.existsSync(mDir)) fs.mkdirSync(mDir, { recursive: true });
          fs.writeFileSync(mPath, JSON.stringify(manifest, null, 2), 'utf8');
        } catch (mErr) {
          console.warn(`[Injector] Warning updating manifest at ${mPath}:`, mErr.message);
        }
      }

      console.log(`[Injector] Updated CustomLibraryManagement metadata for "${cleanTitle}"`);
    } catch (err) {
      console.warn('[Injector] Could not update custom manifest:', err.message);
    }
  }

  // Write file with retry logic without busy-wait blocking the main thread
  writeFileWithRetry(filePath, buffer, maxRetries = 2) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        fs.writeFileSync(filePath, buffer);
        return true;
      } catch (err) {
        if (attempt === maxRetries) {
          throw err;
        }
      }
    }
    return false;
  }

  // Resolves the exact active thumbnail cache path registered in CustomLibraryManagement
  resolveClmActiveThumbnailPath(game) {
    const candidateDirs = [this.customLibraryDir, this.altCustomLibraryDir];
    const targetTitle = (game.title || '').toLowerCase().trim();
    const targetInstall = (game.installPath || '').toLowerCase().trim();
    const origId = String(game.originalId || '').toLowerCase().trim();
    const gameId = String(game.id || '').toLowerCase().trim();
    const safeId = vault.sanitizeIdentifier(game.id || game.title);

    for (const dir of candidateDirs) {
      const manifestCandidates = [
        path.join(dir, 'CustomLibraryManagement.manifest'),
        path.join(dir, 'CustomLibraryManagement.json')
      ];

      for (const mPath of manifestCandidates) {
        if (!fs.existsSync(mPath)) continue;
        try {
          const raw = fs.readFileSync(mPath, 'utf8').trim().replace(/^\uFEFF/, '');
          if (!raw) continue;
          const root = JSON.parse(raw);
          if (!root || !root.gameCache) continue;

          let entries = [];
          if (Array.isArray(root.gameCache.games)) {
            entries = root.gameCache.games;
          } else if (typeof root.gameCache === 'object') {
            for (const [k, v] of Object.entries(root.gameCache)) {
              if (k === 'version') continue;
              if (v && typeof v === 'object') entries.push({ ...v, _mapKey: k });
            }
          }

          for (const item of entries) {
            const itemKey = String(item._mapKey || item.id || '').toLowerCase().trim();
            const itemTitle = (item.title || item.name || '').toLowerCase().trim();
            const itemInstall = (item.installLocation || item.installPath || '').toLowerCase().trim();
            const itemExec = (item.executableName || '').toLowerCase().trim();
            const itemCombined = itemExec ? path.join(itemInstall, itemExec).toLowerCase() : itemInstall;

            const isMatch = (itemKey && (itemKey === origId || itemKey === gameId || itemKey === safeId)) ||
                            (targetTitle && itemTitle === targetTitle) ||
                            (targetInstall && (itemInstall === targetInstall || itemCombined === targetInstall));

            if (isMatch) {
              if (item.imagePath) {
                const resPath = path.isAbsolute(item.imagePath) ? item.imagePath : path.resolve(dir, item.imagePath);
                return resPath;
              }
              const keyName = item._mapKey || item.id || safeId;
              return path.join(this.customLibraryDir, `${vault.sanitizeIdentifier(keyName)}.png`);
            }
          }
        } catch (e) {}
      }
    }

    return null;
  }

  // Resolve the exact filesystem path that Xbox App expects for a game cover
  resolveTargetImagePath(game) {
    if (game.targetImagePath) {
      // Guard: Never write artwork directly into an executable file (.exe)
      if (game.targetImagePath.toLowerCase().endsWith('.exe')) {
        const safeId = vault.sanitizeIdentifier(game.id);
        if (game.source === 'xbox_shortcut' || game.launcher === 'SHORTCUT') {
          return path.join(this.externalShortcutDir, `${safeId}.png`);
        }
        return path.join(this.customLibraryDir, `${safeId}.png`);
      }
      return game.targetImagePath;
    }

    const launcher = (game.launcher || 'custom').toLowerCase();
    const safeId = vault.sanitizeIdentifier(game.id);

    const isCustomOrShortcut = launcher === 'shortcut' ||
                               game.source === 'xbox_shortcut' ||
                               game.source === 'user_custom' ||
                               game.source === 'custom_manifest' ||
                               (game.targetImagePath && game.targetImagePath.includes('CustomLibraryManagement'));

    if (isCustomOrShortcut) {
      const activeClmPath = this.resolveClmActiveThumbnailPath(game);
      if (activeClmPath) {
        return activeClmPath;
      }
    }

    if (launcher === 'steam') {
      const appId = game.appId || safeId.replace(/^steam_/i, '');
      return path.join(this.thirdPartyDir, 'steam', `steam_${appId}.png`);
    }
    if (launcher === 'epic') {
      const epicId = game.originalId ? game.originalId.replace(/:/g, '_') : safeId;
      return path.join(this.thirdPartyDir, 'epic', epicId.startsWith('epic_') ? `${epicId}.png` : `epic_${epicId}.png`);
    }
    if (launcher === 'gog') {
      const gogId = game.appId || safeId.replace(/^gog_/i, '');
      return path.join(this.thirdPartyDir, 'gog', `gog_${gogId}.png`);
    }
    if (launcher === 'ubi' || launcher === 'ubisoft') {
      const ubiId = game.appId || safeId.replace(/^ubi_/i, '');
      return path.join(this.thirdPartyDir, 'ubi', `ubi_${ubiId}.png`);
    }
    if (launcher === 'ea') {
      const eaId = game.appId || safeId.replace(/^ea_/i, '');
      return path.join(this.thirdPartyDir, 'ea', `ea_${eaId}.png`);
    }
    if (launcher === 'shortcut' || game.source === 'xbox_shortcut') {
      return path.join(this.externalShortcutDir, `${safeId}.png`);
    }

    // Default to active Xbox App ThirdPartyLibraries CustomLibraryManagement
    return path.join(this.customLibraryDir, `${safeId}.png`);
  }

  // Inject a single game cover from Vault into Xbox App
  injectGame(game, options = {}) {
    const { skipCacheClear = false } = options;
    if (!vault.hasCover(game)) {
      throw new Error(`Vault does not contain a cover for game: ${game.title} (${game.id})`);
    }

    this.ensureDirectories();
    this.lastWriteTime = Date.now();

    const coverBuffer = vault.getCoverBuffer(game);
    const targetImagePath = this.resolveTargetImagePath(game);
    const targetDir = path.dirname(targetImagePath);

    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    // Prepare JPEG buffer variant (reuse cached real JPEG in Vault if already converted)
    let jpgBuffer = coverBuffer;
    try {
      const vaultCoverPath = vault.getCoverPath(game);
      const vaultJpgPath = vaultCoverPath ? path.join(path.dirname(vaultCoverPath), 'cover.jpg') : null;
      let loadedCachedJpg = false;
      if (vaultJpgPath && fs.existsSync(vaultJpgPath)) {
        const rawJpg = fs.readFileSync(vaultJpgPath);
        // Check JPEG SOI marker (0xFF 0xD8)
        if (rawJpg.length > 4 && rawJpg[0] === 0xFF && rawJpg[1] === 0xD8) {
          jpgBuffer = rawJpg;
          loadedCachedJpg = true;
        }
      }
      if (!loadedCachedJpg) {
        const { nativeImage } = require('electron');
        const nImg = nativeImage.createFromBuffer(coverBuffer);
        if (!nImg.isEmpty()) {
          jpgBuffer = nImg.toJPEG(95);
          if (vaultJpgPath) {
            try { fs.writeFileSync(vaultJpgPath, jpgBuffer); } catch (e) {}
          }
        }
      }
    } catch (e) {
      jpgBuffer = coverBuffer;
    }

    const basePathWithoutExt = targetImagePath.replace(/\.(png|jpg|jpeg)$/i, '');
    const pngPath = `${basePathWithoutExt}.png`;
    const v2Path = `${basePathWithoutExt}_v2.png`;
    const jpgPath = `${basePathWithoutExt}.jpg`;
    const newPath = `${basePathWithoutExt}.new`;

    // 1. Create .bak backup of original Xbox artwork if it exists and backup doesn't already exist
    const backupPath = `${basePathWithoutExt}.bak`;
    if (!fs.existsSync(backupPath) && fs.existsSync(pngPath)) {
      try {
        fs.copyFileSync(pngPath, backupPath);
        console.log(`[Injector] Backed up original artwork to ${backupPath}`);
      } catch (e) {
        console.warn('[Injector] Could not create .bak backup:', e.message);
      }
    }

    // 2. Write PNG, _v2.png, JPG, and companion .new file with retry logic
    try {
      this.writeFileWithRetry(pngPath, coverBuffer);
      this.writeFileWithRetry(v2Path, coverBuffer);
      this.writeFileWithRetry(jpgPath, jpgBuffer);
      this.writeFileWithRetry(newPath, coverBuffer);
    } catch (writeErr) {
      // Check if file locking by Xbox process caused write error
      if (this.isXboxAppRunning()) {
        console.warn('[Injector] Xbox App process locked artwork file. Attempting cleanup/refresh...');
        this.terminateXboxProcesses();
        this.writeFileWithRetry(pngPath, coverBuffer);
        this.writeFileWithRetry(v2Path, coverBuffer);
        this.writeFileWithRetry(jpgPath, jpgBuffer);
        this.writeFileWithRetry(newPath, coverBuffer);
      } else {
        throw writeErr;
      }
    }

    // 3. Touch files with current UTC timestamp for instant cache busting
    const now = new Date();
    try {
      fs.utimesSync(pngPath, now, now);
      fs.utimesSync(v2Path, now, now);
      fs.utimesSync(jpgPath, now, now);
      if (fs.existsSync(newPath)) fs.utimesSync(newPath, now, now);
    } catch (touchErr) {
      console.warn('[Injector] Warning updating utimes on injected covers:', touchErr.message);
    }

    // 4. Write mirror copies into LocalState\CustomLibraryManagement\images (New Xbox App Experience Requirement)
    const safeId = vault.sanitizeIdentifier(game.id);
    const clmCandidates = [
      path.join(this.clmImagesDir, `${safeId}.png`),
      path.join(this.clmImagesDir, `${safeId}_v2.png`),
      path.join(this.clmImagesDir, `${safeId}.jpg`)
    ];
    if (game.appId) {
      clmCandidates.push(
        path.join(this.clmImagesDir, `steam_${game.appId}.png`),
        path.join(this.clmImagesDir, `steam_${game.appId}_v2.png`),
        path.join(this.clmImagesDir, `steam_${game.appId}.jpg`)
      );
    }
    if (game.originalId) {
      const origSafe = vault.sanitizeIdentifier(game.originalId);
      clmCandidates.push(
        path.join(this.clmImagesDir, `${origSafe}.png`),
        path.join(this.clmImagesDir, `${origSafe}_v2.png`),
        path.join(this.clmImagesDir, `${origSafe}.jpg`)
      );
    }
    for (const cPath of clmCandidates) {
      try {
        const isJpg = cPath.endsWith('.jpg');
        this.writeFileWithRetry(cPath, isJpg ? jpgBuffer : coverBuffer);
        fs.utimesSync(cPath, now, now);
      } catch (e) {}
    }

    // 5. Update manifests based on game source (Shortcuts stay in ExternalAppShortcut)
    const isShortcut = (game.launcher || '').toLowerCase() === 'shortcut' ||
                       game.source === 'xbox_shortcut';
    const isCustom = !isShortcut && (
                     (game.launcher || '').toLowerCase() === 'custom' ||
                     game.source === 'user_custom' ||
                     game.source === 'custom_manifest' ||
                     targetImagePath.includes('CustomLibraryManagement'));

    const clmCanonicalImg = path.join(this.clmImagesDir, `${safeId}.png`);

    if (isShortcut) {
      this.updateShortcutManifestIcon(game, pngPath);
    } else if (isCustom) {
      this.updateCustomManifestGame(game, clmCanonicalImg);

      // Ensure mirror copies exist in both native and ThirdParty CustomLibraryManagement
      const mirrorPng = path.join(this.altCustomLibraryDir, `${safeId}.png`);
      const mirrorJpg = path.join(this.altCustomLibraryDir, `${safeId}.jpg`);
      if (mirrorPng.toLowerCase() !== pngPath.toLowerCase()) {
        try {
          fs.copyFileSync(pngPath, mirrorPng);
          fs.copyFileSync(jpgPath, mirrorJpg);
          fs.utimesSync(mirrorPng, now, now);
          fs.utimesSync(mirrorJpg, now, now);
        } catch (e) {}
      }
    }

    // 6. Purge Xbox App internal thumbnail ImageCache & WebView2 cache asynchronously (unless part of a batch that clears once at the end)
    if (!skipCacheClear) {
      this.clearImageCache().catch(() => {});
    }

    console.log(`[Injector] Successfully injected artwork for "${game.title}" -> ${pngPath} / ${v2Path}`);
    return {
      success: true,
      injectedPath: pngPath,
      gameId: game.id,
      title: game.title
    };
  }

  // Inject all games that exist in the Vault
  async injectAll(games) {
    this.ensureDirectories();
    const results = {
      total: 0,
      succeeded: 0,
      failed: 0,
      errors: []
    };

    for (const game of games) {
      if (vault.hasCover(game)) {
        results.total++;
        try {
          this.injectGame(game, { skipCacheClear: true });
          results.succeeded++;
        } catch (err) {
          results.failed++;
          results.errors.push({ gameId: game.id, title: game.title, error: err.message });
          console.error(`[Injector] Failed to inject "${game.title}":`, err.message);
        }
        await new Promise(r => setImmediate(r));
      }
    }

    await this.clearImageCache();
    return results;
  }

  // Restore all games directly from Vault directory entries (async, yields between games, clears cache once)
  async restoreAllFromVault() {
    this.ensureDirectories();
    this.lastWriteTime = Date.now();

    const entries = vault.getAllVaultEntries();
    console.log(`[Injector] Restoring ${entries.length} covers from Vault to Xbox App...`);
    let restored = 0;

    for (const entry of entries) {
      try {
        if (vault.hasCover(entry.gameId)) {
          const gameStub = {
            id: entry.gameId,
            title: entry.title,
            launcher: entry.launcher,
            appId: entry.appId,
            source: entry.source || ((entry.launcher || '').toLowerCase() === 'shortcut' ? 'xbox_shortcut' : null),
            targetImagePath: entry.targetImagePath || null
          };

          const isShortcut = (entry.launcher || '').toLowerCase() === 'shortcut' ||
                             gameStub.source === 'xbox_shortcut';

          if (isShortcut) {
            const shortcutPath = this.findShortcutManifest(gameStub);
            if (!shortcutPath) {
              console.log(`[Injector] Skipping restore for deleted Xbox App shortcut "${gameStub.title}" (${gameStub.id})`);
              continue;
            }
          }

          this.injectGame(gameStub, { skipCacheClear: true });
          restored++;
        }
      } catch (err) {
        console.warn(`[Injector] Failed restoring ${entry.gameId}:`, err.message);
      }
      await new Promise(r => setImmediate(r));
    }

    await this.clearImageCache();
    console.log(`[Injector] Restored ${restored}/${entries.length} covers.`);
    return { total: entries.length, restored };
  }
}

module.exports = new XboxAppInjector();
