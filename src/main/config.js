const fs = require('fs');
const path = require('path');
const os = require('os');

class ConfigManager {
  constructor() {
    this.appDataDir = process.env.APPDATA || (
      process.platform === 'win32'
        ? path.join(os.homedir(), 'AppData', 'Roaming')
        : path.join(os.homedir(), '.config')
    );
    this.baseDir = path.join(this.appDataDir, 'XboxGridSync');
    this.configPath = path.join(this.baseDir, 'config.json');
    this.defaultConfig = {
      autoRestore: true,
      watchEnabled: true,
      taskSchedulerEnabled: true,
      closeToTray: true,
      startMinimized: false,
      hasSeenTutorial: false,
      customGames: []
    };
    this.config = { ...this.defaultConfig };
    this.init();
  }

  init() {
    try {
      if (!fs.existsSync(this.baseDir)) {
        fs.mkdirSync(this.baseDir, { recursive: true });
      }
      if (fs.existsSync(this.configPath)) {
        const raw = fs.readFileSync(this.configPath, 'utf8');
        const parsed = JSON.parse(raw);
        this.config = { ...this.defaultConfig, ...parsed };
      } else {
        this.save();
      }
    } catch (err) {
      console.error('[Config] Error loading config:', err.message);
      this.config = { ...this.defaultConfig };
    }
  }

  get(key) {
    return key ? this.config[key] : { ...this.config };
  }

  set(key, value) {
    if (typeof key === 'object') {
      this.config = { ...this.config, ...key };
    } else {
      this.config[key] = value;
    }
    this.save();
    return this.config;
  }

  save() {
    try {
      if (!fs.existsSync(this.baseDir)) {
        fs.mkdirSync(this.baseDir, { recursive: true });
      }
      const tmpPath = `${this.configPath}.tmp`;
      fs.writeFileSync(tmpPath, JSON.stringify(this.config, null, 2), 'utf8');
      fs.renameSync(tmpPath, this.configPath);
    } catch (err) {
      console.error('[Config] Error saving config:', err.message);
    }
  }

  addCustomGame(game) {
    const games = this.config.customGames || [];
    const index = games.findIndex(g => g.id === game.id);
    if (index >= 0) {
      games[index] = { ...games[index], ...game };
    } else {
      games.push(game);
    }
    this.set('customGames', games);
    return games;
  }

  removeCustomGame(gameId) {
    const games = (this.config.customGames || []).filter(g => g.id !== gameId);
    this.set('customGames', games);
    return games;
  }
}

module.exports = new ConfigManager();
