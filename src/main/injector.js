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
    this.lastWriteTime = Date.now();

    const coverBuffer = vault.getCoverBuffer(game.id);
    const safeId = vault.sanitizeIdentifier(game.id);

    // 1. Primary target inside CustomLibraryManagement is .png
    const targetPng = path.join(this.customLibraryDir, `${safeId}.png`);
    const targetCoverPng = path.join(this.customLibraryDir, `${safeId}_cover.png`);
    const targetJpg = path.join(this.customLibraryDir, `${safeId}.jpg`);

    this.writeFileWithRetry(targetPng, coverBuffer);
    this.writeFileWithRetry(targetCoverPng, coverBuffer);
    this.writeFileWithRetry(targetJpg, coverBuffer);

    // If game has appId (e.g. 1091500), also write by appId
    if (game.appId) {
      const appIdPng = path.join(this.customLibraryDir, `${game.appId}.png`);
      this.writeFileWithRetry(appIdPng, coverBuffer);
    }

    // 2. If launcher is steam/epic/gog/bnet/ea/ubi, place inside their respective subfolder as .png
    const launcherFolder = (game.launcher || '').toLowerCase();
    if (['steam', 'epic', 'gog', 'bnet', 'ea', 'ubi'].includes(launcherFolder)) {
      const provDir = path.join(this.thirdPartyDir, launcherFolder);
      if (fs.existsSync(provDir)) {
        try {
          // Write primary launcher filename e.g. steam_1091500.png
          const provTargetPng = path.join(provDir, `${safeId}.png`);
          this.writeFileWithRetry(provTargetPng, coverBuffer);

          // If game has appId, also write appId.png (e.g. 1091500.png)
          if (game.appId) {
            const provAppIdPng = path.join(provDir, `${game.appId}.png`);
            this.writeFileWithRetry(provAppIdPng, coverBuffer);
          }

          // Clean up old .jpg in provider folder so Xbox App doesn't grab stale jpg
          const oldProvJpg = path.join(provDir, `${safeId}.jpg`);
          if (fs.existsSync(oldProvJpg)) {
            try { fs.unlinkSync(oldProvJpg); } catch (e) {}
          }
          if (game.appId) {
            const oldAppIdJpg = path.join(provDir, `${game.appId}.jpg`);
            if (fs.existsSync(oldAppIdJpg)) {
              try { fs.unlinkSync(oldAppIdJpg); } catch (e) {}
            }
          }
        } catch (e) {
          console.warn(`[Injector] Warning writing to ${provDir}:`, e.message);
        }
      }
    }

    // 3. Update CustomLibraryManagement.manifest with targetPng
    this.updateManifestGame(game, targetPng);

    console.log(`[Injector] Successfully injected PNG artwork for "${game.title}" -> ${targetPng}`);
    return {
      success: true,
      injectedPath: targetPng,
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
    console.log(`[Injector] Restoring ${entries.length} PNG covers from Vault to Xbox App...`);
    let restored = 0;

    for (const entry of entries) {
      try {
        const coverBuffer = vault.getCoverBuffer(entry.gameId);
        if (coverBuffer) {
          const safeId = vault.sanitizeIdentifier(entry.gameId);
          const targetPng = path.join(this.customLibraryDir, `${safeId}.png`);
          const targetCoverPng = path.join(this.customLibraryDir, `${safeId}_cover.png`);
          const targetJpg = path.join(this.customLibraryDir, `${safeId}.jpg`);

          this.writeFileWithRetry(targetPng, coverBuffer);
          this.writeFileWithRetry(targetCoverPng, coverBuffer);
          this.writeFileWithRetry(targetJpg, coverBuffer);

          const launcherFolder = (entry.launcher || '').toLowerCase();
          if (['steam', 'epic', 'gog', 'bnet', 'ea', 'ubi'].includes(launcherFolder)) {
            const provDir = path.join(this.thirdPartyDir, launcherFolder);
            if (fs.existsSync(provDir)) {
              try {
                const provTargetPng = path.join(provDir, `${safeId}.png`);
                this.writeFileWithRetry(provTargetPng, coverBuffer);

                // Clean old jpg
                const oldJpg = path.join(provDir, `${safeId}.jpg`);
                if (fs.existsSync(oldJpg)) {
                  try { fs.unlinkSync(oldJpg); } catch (e) {}
                }
              } catch (e) {}
            }
          }

          this.updateManifestGame({
            id: entry.gameId,
            title: entry.title,
            launcher: entry.launcher
          }, targetPng);

          restored++;
        }
      } catch (err) {
        console.warn(`[Injector] Failed restoring ${entry.gameId}:`, err.message);
      }
    }

    console.log(`[Injector] Restored ${restored}/${entries.length} covers as .png.`);
    return { total: entries.length, restored };
  }
}

module.exports = new XboxAppInjector();
