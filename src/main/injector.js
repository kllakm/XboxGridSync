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
    if (!fs.existsSync(this.imageCacheDir)) {
      fs.mkdirSync(this.imageCacheDir, { recursive: true });
    }
  }

  // Update or insert into CustomLibraryManagement.manifest for Custom / Shortcut games only
  updateCustomManifestGame(game, injectedImagePath) {
    try {
      this.ensureDirectories();
      let manifest = {
        version: 1,
        provider: { version: 1, enabled: true },
        gameCache: {}
      };

      if (fs.existsSync(this.clmManifestPath)) {
        try {
          const raw = fs.readFileSync(this.clmManifestPath, 'utf8');
          manifest = JSON.parse(raw);
          if (!manifest.gameCache || typeof manifest.gameCache !== 'object') {
            manifest.gameCache = {};
          }
        } catch (e) {
          // ignore corrupted manifest
        }
      }

      const safeId = game.originalId || vault.sanitizeIdentifier(game.id || game.title);
      const cleanTitle = game.title || 'Game';

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

      fs.writeFileSync(this.clmManifestPath, JSON.stringify(manifest, null, 2), 'utf8');
      console.log(`[Injector] Updated CustomLibraryManagement.manifest for "${cleanTitle}"`);
    } catch (err) {
      console.warn('[Injector] Could not update manifest:', err.message);
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

    // Default to CustomLibraryManagement
    return path.join(this.customLibraryDir, `${safeId}.png`);
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

    // 5. Update CustomLibraryManagement.manifest ONLY if this is a custom game
    const isCustom = (game.launcher || '').toLowerCase() === 'custom' ||
                     (game.launcher || '').toLowerCase() === 'shortcut' ||
                     targetImagePath.includes('CustomLibraryManagement');

    if (isCustom) {
      this.updateCustomManifestGame(game, targetImagePath);
    }

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
            targetImagePath: entry.targetImagePath || null
          };

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

          const isCustom = (entry.launcher || '').toLowerCase() === 'custom' ||
                           (entry.launcher || '').toLowerCase() === 'shortcut' ||
                           targetImagePath.includes('CustomLibraryManagement');
          if (isCustom) {
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
