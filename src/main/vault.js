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
              appId: meta.appId || null
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
