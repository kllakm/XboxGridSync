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

  // Update or insert into CustomLibraryManagement.manifest
  updateManifestGame(game, injectedImagePath) {
    try {
      this.ensureDirectories();
      let manifest = {
        version: 1,
        provider: { version: 1, enabled: true },
        gameCache: { version: 1, games: [] }
      };

      if (fs.existsSync(this.clmManifestPath)) {
        try {
          const raw = fs.readFileSync(this.clmManifestPath, 'utf8');
          manifest = JSON.parse(raw);
          if (!manifest.gameCache) manifest.gameCache = { version: 1, games: [] };
          if (!Array.isArray(manifest.gameCache.games)) manifest.gameCache.games = [];
        } catch (e) {
          // ignore corrupted manifest
        }
      }

      const games = manifest.gameCache.games;
      const safeId = vault.sanitizeIdentifier(game.id || game.originalId || game.title);
      const cleanTitle = game.title || 'Game';

      const existingIdx = games.findIndex(g =>
        (g.id && g.id === safeId) ||
        (g.title && g.title.toLowerCase() === cleanTitle.toLowerCase())
      );

      const gameEntry = {
        id: safeId,
        title: cleanTitle,
        provider: (game.launcher || 'CUSTOM').toLowerCase(),
        installPath: game.installPath || '',
        launchUri: game.installPath || '',
        imageUri: injectedImagePath,
        thumbnailPath: injectedImagePath,
        iconUri: injectedImagePath,
        lastUpdated: new Date().toISOString()
      };

      if (existingIdx >= 0) {
        games[existingIdx] = { ...games[existingIdx], ...gameEntry };
      } else {
        games.push(gameEntry);
      }

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

  // Inject a single game cover from Vault into Xbox App
  injectGame(game) {
    if (!vault.hasCover(game.id)) {
      throw new Error(`Vault does not contain a cover for game: ${game.title} (${game.id})`);
    }

    this.ensureDirectories();
    const coverBuffer = vault.getCoverBuffer(game.id);
    const safeId = vault.sanitizeIdentifier(game.id);

    // 1. Target inside CustomLibraryManagement
    const targetJpg = path.join(this.customLibraryDir, `${safeId}.jpg`);
    const targetPng = path.join(this.customLibraryDir, `${safeId}.png`);
    const targetCoverJpg = path.join(this.customLibraryDir, `${safeId}_cover.jpg`);

    this.writeFileWithRetry(targetJpg, coverBuffer);
    this.writeFileWithRetry(targetPng, coverBuffer);
    this.writeFileWithRetry(targetCoverJpg, coverBuffer);

    // 2. If launcher is steam/epic/gog, also place inside their respective subfolder
    const launcherFolder = (game.launcher || '').toLowerCase();
    if (['steam', 'epic', 'gog', 'bnet', 'ea', 'ubi'].includes(launcherFolder)) {
      const provDir = path.join(this.thirdPartyDir, launcherFolder);
      if (fs.existsSync(provDir)) {
        try {
          const provTarget = path.join(provDir, `${safeId}.jpg`);
          this.writeFileWithRetry(provTarget, coverBuffer);
        } catch (e) {
          // ignore
        }
      }
    }

    // 3. Update CustomLibraryManagement.manifest
    this.updateManifestGame(game, targetJpg);

    console.log(`[Injector] Successfully injected artwork for "${game.title}" -> ${targetJpg}`);
    return {
      success: true,
      injectedPath: targetJpg,
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
    const entries = vault.getAllVaultEntries();
    console.log(`[Injector] Restoring ${entries.length} covers from Vault to Xbox App...`);
    let restored = 0;

    for (const entry of entries) {
      try {
        const coverBuffer = vault.getCoverBuffer(entry.gameId);
        if (coverBuffer) {
          const targetJpg = path.join(this.customLibraryDir, `${entry.gameId}.jpg`);
          const targetCoverJpg = path.join(this.customLibraryDir, `${entry.gameId}_cover.jpg`);
          this.writeFileWithRetry(targetJpg, coverBuffer);
          this.writeFileWithRetry(targetCoverJpg, coverBuffer);

          this.updateManifestGame({
            id: entry.gameId,
            title: entry.title,
            launcher: entry.launcher
          }, targetJpg);

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
