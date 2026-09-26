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

  saveCover(gameId, imageBuffer, metadata = {}) {
    try {
      const dir = this.getGameVaultDir(gameId);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const coverPath = path.join(dir, 'cover.jpg');
      const metaPath = path.join(dir, 'metadata.json');

      const meta = {
        gameId,
        savedAt: new Date().toISOString(),
        size: imageBuffer.length,
        ...metadata
      };

      fs.writeFileSync(coverPath, imageBuffer);
      fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf8');
      console.log(`[Vault] Stored cover for ${gameId} (${imageBuffer.length} bytes)`);
      return coverPath;
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
      return `data:image/jpeg;base64,${buffer.toString('base64')}`;
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
          const coverPath = path.join(this.vaultDir, gameId, 'cover.jpg');
          if (fs.existsSync(coverPath)) {
            const meta = this.getMetadata(gameId) || {};
            entries.push({
              gameId,
              coverPath,
              savedAt: meta.savedAt || null,
              title: meta.title || gameId,
              launcher: meta.launcher || 'unknown'
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
}

module.exports = new VaultManager();
