const fs = require('fs');
const path = require('path');
const os = require('os');
const injector = require('./injector');
const config = require('./config');

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
    // Ignore internal vault writes or if autoRestore is disabled
    if (!config.get('autoRestore')) return;
    if (this.isRestoring) return;

    console.log(`[Watcher] Detected filesystem event (${eventType}) on: ${filename}`);

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

    console.log(`[Watcher] Auto-Restore triggered by [${reason}]. Checking and shielding artwork...`);
    try {
      const result = injector.restoreAllFromVault();
      if (this.onRestoreCallback) {
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
