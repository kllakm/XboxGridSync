const fs = require('fs');
const path = require('path');
const os = require('os');
const injector = require('./injector');
const config = require('./config');
const vault = require('./vault');

class BackgroundWatcher {
  constructor() {
    this.localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    this.targetDir = path.join(
      this.localAppData,
      'Packages',
      'Microsoft.GamingApp_8wekyb3d8bbwe',
      'LocalState',
      'ThirdPartyLibraries'
    );
    this.customLibraryDir = path.join(this.targetDir, 'CustomLibraryManagement');
    this.watcher = null;
    this.debounceTimer = null;
    this.isRestoring = false;
    this.onRestoreCallback = null;
  }

  setRestoreCallback(cb) {
    this.onRestoreCallback = cb;
  }

  start() {
    const enabled = config.get('watchEnabled');
    if (!enabled) {
      console.log('[Watcher] File watcher is disabled in config.');
      return;
    }

    try {
      if (!fs.existsSync(this.targetDir)) {
        fs.mkdirSync(this.targetDir, { recursive: true });
      }

      this.stop(); // ensure clean state

      console.log(`[Watcher] Starting live FileSystemWatcher on: ${this.targetDir}`);
      this.watcher = fs.watch(this.targetDir, { recursive: true }, (eventType, filename) => {
        this.handleFileChange(eventType, filename);
      });

      this.watcher.on('error', (err) => {
        console.warn('[Watcher] Watcher error:', err.message);
      });
    } catch (err) {
      console.warn('[Watcher] Could not start live file watcher:', err.message);
    }
  }

  stop() {
    if (this.watcher) {
      try {
        this.watcher.close();
      } catch (e) {}
      this.watcher = null;
      console.log('[Watcher] File watcher stopped.');
    }
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }

  handleFileChange(eventType, filename) {
    // Ignore if autoRestore is disabled or restore is currently in flight
    if (!config.get('autoRestore')) return;
    if (this.isRestoring) return;

    // Ignore temporary files, locks, or log files
    if (filename && (filename.endsWith('.tmp') || filename.endsWith('.log') || filename.startsWith('~'))) {
      return;
    }

    // Ignore events caused by our own recent writes (cooldown 8s)
    if (injector.lastWriteTime && (Date.now() - injector.lastWriteTime < 8000)) {
      return;
    }

    console.log(`[Watcher] Detected external filesystem event (${eventType}) on: ${filename}`);

    // Debounce to allow package updates / deletions to settle
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(() => {
      this.executeSilentRestore('filesystem_event');
    }, 2500);
  }

  async executeSilentRestore(reason = 'unknown') {
    if (this.isRestoring) return;
    this.isRestoring = true;

    try {
      // 1. Verify if ANY vault covers are actually missing on disk
      const entries = vault.getAllVaultEntries();
      if (!entries || entries.length === 0) {
        return;
      }

      let missingCount = 0;
      for (const entry of entries) {
        const safeId = vault.sanitizeIdentifier(entry.gameId);
        const targetPng = path.join(this.customLibraryDir, `${safeId}.png`);

        if (!fs.existsSync(targetPng)) {
          missingCount++;
          continue;
        }

        const launcherFolder = (entry.launcher || '').toLowerCase();
        if (['steam', 'epic', 'gog', 'bnet', 'ea', 'ubi'].includes(launcherFolder)) {
          const provDir = path.join(this.targetDir, launcherFolder);
          if (fs.existsSync(provDir)) {
            const provTargetPng = path.join(provDir, `${safeId}.png`);
            if (!fs.existsSync(provTargetPng)) {
              missingCount++;
            }
          }
        }
      }

      if (missingCount === 0) {
        // No covers are missing; do NOT rewrite and do NOT spam toasts
        console.log(`[Watcher] Verification complete: All ${entries.length} covers intact. No restore needed.`);
        return;
      }

      console.log(`[Watcher] Detected ${missingCount} missing covers. Shielding and restoring from Vault...`);
      const result = injector.restoreAllFromVault();

      if (result.restored > 0 && this.onRestoreCallback) {
        this.onRestoreCallback({ reason, result, timestamp: new Date().toISOString() });
      }
    } catch (err) {
      console.error('[Watcher] Error during auto-restore:', err.message);
    } finally {
      this.isRestoring = false;
    }
  }
}

module.exports = new BackgroundWatcher();
