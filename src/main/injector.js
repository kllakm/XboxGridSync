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
      const out = execSync('powershell.exe -NoProfile -Command "Get-Process XboxPcApp, Xbox -ErrorAction SilentlyContinue | Select-Object -ExpandProperty ProcessName"', {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'ignore']
      });
      return out.trim().length > 0;
    } catch (err) {
      return false;
    }
  }

  async restartXboxApp() {
    console.log('[Injector] Restarting Xbox PC App...');
    try {
      execSync('powershell.exe -NoProfile -Command "Stop-Process -Name XboxPcApp, Xbox -Force -ErrorAction SilentlyContinue"', {
        stdio: ['pipe', 'pipe', 'ignore']
      });
      await new Promise(r => setTimeout(r, 1200));
      spawn('cmd.exe', ['/c', 'start', 'xbox:'], {
        detached: true,
        stdio: 'ignore'
      }).unref();
      return { success: true, message: 'Xbox App restarted successfully.' };
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
    if (!fs.existsSync(this.externalShortcutDir)) {
      fs.mkdirSync(this.externalShortcutDir, { recursive: true });
    }
    if (!fs.existsSync(this.imageCacheDir)) {
      fs.mkdirSync(this.imageCacheDir, { recursive: true });
    }
  }

  // Invalidate Xbox App's internal image thumbnail cache
  clearImageCache() {
    try {
      if (fs.existsSync(this.imageCacheDir)) {
        const files = fs.readdirSync(this.imageCacheDir);
        for (const file of files) {
          try {
            fs.unlinkSync(path.join(this.imageCacheDir, file));
          } catch (e) {}
        }
      }
    } catch (err) {
      console.warn('[Injector] Could not purge ImageCache:', err.message);
    }
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

  // Write file with retry logic in case Xbox App has a temporary read handle
  writeFileWithRetry(filePath, buffer, maxRetries = 3) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        fs.writeFileSync(filePath, buffer);
        return true;
      } catch (err) {
        if (attempt === maxRetries) {
          throw err;
        }
        // Small wait before retry
        const end = Date.now() + 300 * attempt;
        while (Date.now() < end) {}
      }
    }
    return false;
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
        return path.join(this.altCustomLibraryDir, `${safeId}.png`);
      }
      return game.targetImagePath;
    }

    const launcher = (game.launcher || 'custom').toLowerCase();
    const safeId = vault.sanitizeIdentifier(game.id);

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

    // Default to native Xbox App CustomLibraryManagement
    return path.join(this.altCustomLibraryDir, `${safeId}.png`);
  }

  // Inject a single game cover from Vault into Xbox App
  injectGame(game) {
    if (!vault.hasCover(game.id)) {
      throw new Error(`Vault does not contain a cover for game: ${game.title} (${game.id})`);
    }

    this.ensureDirectories();
    this.lastWriteTime = Date.now();

    const coverBuffer = vault.getCoverBuffer(game.id);
    const targetImagePath = this.resolveTargetImagePath(game);
    const targetDir = path.dirname(targetImagePath);

    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    // 1. Create .bak backup of original Xbox artwork if it exists and backup doesn't already exist
    const backupPath = targetImagePath.replace(/\.png$/i, '.bak');
    if (!fs.existsSync(backupPath) && fs.existsSync(targetImagePath)) {
      try {
        fs.copyFileSync(targetImagePath, backupPath);
        console.log(`[Injector] Backed up original artwork to ${backupPath}`);
      } catch (e) {
        console.warn('[Injector] Could not create .bak backup:', e.message);
      }
    }

    // 2. Write the new image directly to targetImagePath
    this.writeFileWithRetry(targetImagePath, coverBuffer);

    // 3. Write companion .new file (compatible with SteamGridDB widget)
    const newPath = targetImagePath.replace(/\.png$/i, '.new');
    this.writeFileWithRetry(newPath, coverBuffer);

    // 4. Clean up any stale legacy duplicate files in the target directory (e.g. .jpg, _cover.png)
    const baseName = path.parse(targetImagePath).name;
    const strayPatterns = [
      path.join(targetDir, `${baseName}.jpg`),
      path.join(targetDir, `${baseName}_cover.png`),
      path.join(targetDir, `${baseName}_cover.jpg`)
    ];
    for (const sf of strayPatterns) {
      if (fs.existsSync(sf)) {
        try { fs.unlinkSync(sf); } catch (e) {}
      }
    }

    // 5. Update manifests based on game source (Shortcuts stay in ExternalAppShortcut)
    const isShortcut = (game.launcher || '').toLowerCase() === 'shortcut' ||
                       game.source === 'xbox_shortcut';
    const isCustom = !isShortcut && (
                     (game.launcher || '').toLowerCase() === 'custom' ||
                     game.source === 'user_custom' ||
                     game.source === 'custom_manifest' ||
                     targetImagePath.includes('CustomLibraryManagement'));

    if (isShortcut) {
      this.updateShortcutManifestIcon(game, targetImagePath);
    } else if (isCustom) {
      this.updateCustomManifestGame(game, targetImagePath);

      // Ensure a mirror copy exists in native CustomLibraryManagement so all Xbox subsystems see it
      const safeId = vault.sanitizeIdentifier(game.id);
      const mirrorPng = path.join(this.altCustomLibraryDir, `${safeId}.png`);
      if (mirrorPng.toLowerCase() !== targetImagePath.toLowerCase()) {
        try {
          fs.copyFileSync(targetImagePath, mirrorPng);
        } catch (e) {}
      }
    }

    // 6. Purge Xbox App internal thumbnail ImageCache so new artwork refreshes immediately
    this.clearImageCache();

    console.log(`[Injector] Successfully injected artwork for "${game.title}" -> ${targetImagePath}`);
    return {
      success: true,
      injectedPath: targetImagePath,
      gameId: game.id,
      title: game.title
    };
  }

  // Inject all games that exist in the Vault
  injectAll(games) {
    this.ensureDirectories();
    const results = {
      total: 0,
      succeeded: 0,
      failed: 0,
      errors: []
    };

    for (const game of games) {
      if (vault.hasCover(game.id)) {
        results.total++;
        try {
          this.injectGame(game);
          results.succeeded++;
        } catch (err) {
          results.failed++;
          results.errors.push({ gameId: game.id, title: game.title, error: err.message });
          console.error(`[Injector] Failed to inject "${game.title}":`, err.message);
        }
      }
    }

    return results;
  }

  // Restore all games directly from Vault directory entries
  restoreAllFromVault() {
    this.ensureDirectories();
    this.lastWriteTime = Date.now();

    const entries = vault.getAllVaultEntries();
    console.log(`[Injector] Restoring ${entries.length} covers from Vault to Xbox App...`);
    let restored = 0;

    for (const entry of entries) {
      try {
        const coverBuffer = vault.getCoverBuffer(entry.gameId);
        if (coverBuffer) {
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

          // If this was an ExternalAppShortcut, verify the shortcut is still registered in Xbox App!
          // If the user deleted the shortcut in the Xbox App, do NOT recreate dead files or ghosts!
          if (isShortcut) {
            const shortcutPath = this.findShortcutManifest(gameStub);
            if (!shortcutPath) {
              console.log(`[Injector] Skipping restore for deleted Xbox App shortcut "${gameStub.title}" (${gameStub.id})`);
              continue;
            }
          }

          const targetImagePath = this.resolveTargetImagePath(gameStub);
          const targetDir = path.dirname(targetImagePath);
          if (!fs.existsSync(targetDir)) {
            fs.mkdirSync(targetDir, { recursive: true });
          }

          // Backup if not yet backed up
          const backupPath = targetImagePath.replace(/\.png$/i, '.bak');
          if (!fs.existsSync(backupPath) && fs.existsSync(targetImagePath)) {
            try { fs.copyFileSync(targetImagePath, backupPath); } catch (e) {}
          }

          this.writeFileWithRetry(targetImagePath, coverBuffer);
          const newPath = targetImagePath.replace(/\.png$/i, '.new');
          this.writeFileWithRetry(newPath, coverBuffer);

          const isCustom = !isShortcut && (
                           (entry.launcher || '').toLowerCase() === 'custom' ||
                           targetImagePath.includes('CustomLibraryManagement'));

          if (isShortcut) {
            this.updateShortcutManifestIcon(gameStub, targetImagePath);
          } else if (isCustom) {
            this.updateCustomManifestGame(gameStub, targetImagePath);
          }

          restored++;
        }
      } catch (err) {
        console.warn(`[Injector] Failed restoring ${entry.gameId}:`, err.message);
      }
    }

    console.log(`[Injector] Restored ${restored}/${entries.length} covers.`);
    return { total: entries.length, restored };
  }
}

module.exports = new XboxAppInjector();
