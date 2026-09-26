const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');
const vault = require('./vault');
const config = require('./config');

class GameScanner {
  constructor() {
    this.localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    this.programData = process.env.PROGRAMDATA || 'C:\\ProgramData';
    this.xboxPackagePath = path.join(
      this.localAppData,
      'Packages',
      'Microsoft.GamingApp_8wekyb3d8bbwe'
    );
    this.xboxThirdPartyDir = path.join(
      this.xboxPackagePath,
      'LocalState',
      'ThirdPartyLibraries'
    );
    this.xboxCustomLibraryDir = path.join(
      this.xboxThirdPartyDir,
      'CustomLibraryManagement'
    );
    this.xboxImageCacheDir = path.join(
      this.xboxPackagePath,
      'LocalCache',
      'ImageCache'
    );
  }

  // 1. Scan Xbox App Cache and Registered Manifests
  scanXboxAppRegistry() {
    const xboxGames = [];
    try {
      if (!fs.existsSync(this.xboxThirdPartyDir)) {
        return xboxGames;
      }

      // Check CustomLibraryManagement.manifest
      const clmManifestPath = path.join(this.xboxCustomLibraryDir, 'CustomLibraryManagement.manifest');
      if (fs.existsSync(clmManifestPath)) {
        try {
          const raw = fs.readFileSync(clmManifestPath, 'utf8');
          const data = JSON.parse(raw);
          if (data && data.gameCache && Array.isArray(data.gameCache.games)) {
            for (const g of data.gameCache.games) {
              const gameId = g.id || g.productId || g.title;
              xboxGames.push({
                id: `xbox_${vault.sanitizeIdentifier(gameId)}`,
                originalId: gameId,
                title: g.title || g.displayName || 'Unknown Game',
                launcher: (g.provider || g.source || 'Shortcut').toUpperCase(),
                source: 'xbox_registry',
                installPath: g.installPath || g.launchUri || '',
                currentThumbnail: g.thumbnailPath || g.imageUri || null,
                rawManifest: g
              });
            }
          }
        } catch (err) {
          console.warn('[Scanner] Warning reading CustomLibraryManagement.manifest:', err.message);
        }
      }

      // Scan provider folders: steam, epic, gog, bnet, ea, ubi
      const providers = ['steam', 'epic', 'gog', 'bnet', 'ea', 'ubi'];
      for (const prov of providers) {
        const provDir = path.join(this.xboxThirdPartyDir, prov);
        if (fs.existsSync(provDir)) {
          const files = fs.readdirSync(provDir);
          for (const file of files) {
            if (file.endsWith('.manifest') || file.endsWith('.json')) {
              try {
                const content = fs.readFileSync(path.join(provDir, file), 'utf8');
                const parsed = JSON.parse(content);
                const items = Array.isArray(parsed) ? parsed : (parsed.games || [parsed]);
                for (const item of items) {
                  if (item && (item.title || item.name)) {
                    const title = item.title || item.name;
                    xboxGames.push({
                      id: `${prov}_${vault.sanitizeIdentifier(item.id || item.appId || title)}`,
                      originalId: item.id || item.appId || title,
                      appId: item.appId || (prov === 'steam' ? item.id : null),
                      title: title,
                      launcher: prov.toUpperCase(),
                      source: 'xbox_registry',
                      installPath: item.installPath || '',
                      currentThumbnail: item.thumbnailPath || null
                    });
                  }
                }
              } catch (e) {
                // skip malformed
              }
            }
          }
        }
      }

      // Scan ExternalAppShortcut folder if it exists
      const externalShortcutDir = path.join(this.xboxPackagePath, 'LocalState', 'ExternalAppShortcut');
      if (fs.existsSync(externalShortcutDir)) {
        const files = fs.readdirSync(externalShortcutDir);
        for (const file of files) {
          if (file.endsWith('.json') || file.endsWith('.manifest')) {
            try {
              const content = fs.readFileSync(path.join(externalShortcutDir, file), 'utf8');
              const parsed = JSON.parse(content);
              const title = parsed.title || parsed.name || path.parse(file).name;
              xboxGames.push({
                id: `shortcut_${vault.sanitizeIdentifier(parsed.id || title)}`,
                originalId: parsed.id || title,
                title: title,
                launcher: 'SHORTCUT',
                source: 'xbox_registry',
                installPath: parsed.targetPath || parsed.installPath || '',
                currentThumbnail: parsed.iconPath || null
              });
            } catch (e) {
              // skip
            }
          }
        }
      }
    } catch (err) {
      console.error('[Scanner] Error scanning Xbox App registry:', err.message);
    }
    return xboxGames;
  }

  // 2. Scan Steam Libraries & Manifests
  scanSteamLibraries() {
    const steamGames = [];
    const steamPaths = new Set();

    // Registry query
    try {
      const queries = [
        'reg query "HKCU\\Software\\Valve\\Steam" /v SteamPath',
        'reg query "HKLM\\Software\\WOW6432Node\\Valve\\Steam" /v InstallPath',
        'reg query "HKLM\\Software\\Valve\\Steam" /v InstallPath'
      ];
      for (const cmd of queries) {
        try {
          const out = execSync(cmd, { stdio: ['pipe', 'pipe', 'ignore'], encoding: 'utf8' });
          const match = out.match(/REG_SZ\s+(.+)$/m);
          if (match && match[1]) {
            const cleanPath = match[1].trim();
            if (fs.existsSync(cleanPath)) {
              steamPaths.add(cleanPath);
            }
          }
        } catch (e) {
          // ignore not found
        }
      }
    } catch (err) {
      // ignore
    }

    // Default paths fallback
    const defaultPaths = [
      'C:\\Program Files (x86)\\Steam',
      'C:\\Program Files\\Steam',
      'D:\\Steam',
      'D:\\SteamLibrary',
      'E:\\Steam',
      'E:\\SteamLibrary'
    ];
    for (const p of defaultPaths) {
      if (fs.existsSync(p)) {
        steamPaths.add(p);
      }
    }

    // Process all Steam root directories
    const allLibraryFolders = new Set();
    for (const sPath of steamPaths) {
      allLibraryFolders.add(sPath);
      const vdfPath = path.join(sPath, 'steamapps', 'libraryfolders.vdf');
      if (fs.existsSync(vdfPath)) {
        try {
          const content = fs.readFileSync(vdfPath, 'utf8');
          const regex = /"path"\s+"([^"]+)"/g;
          let m;
          while ((m = regex.exec(content)) !== null) {
            const libPath = m[1].replace(/\\\\/g, '\\');
            if (fs.existsSync(libPath)) {
              allLibraryFolders.add(libPath);
            }
          }
        } catch (err) {
          console.warn('[Scanner] Failed parsing libraryfolders.vdf:', err.message);
        }
      }
    }

    // Blacklist non-game Steam tool IDs
    const toolAppIds = new Set(['228980', '1391110', '1070560', '250820']);

    for (const libPath of allLibraryFolders) {
      const steamAppsDir = path.join(libPath, 'steamapps');
      if (!fs.existsSync(steamAppsDir)) continue;

      try {
        const files = fs.readdirSync(steamAppsDir);
        for (const file of files) {
          const match = file.match(/^appmanifest_(\d+)\.acf$/i);
          if (match) {
            const appId = match[1];
            if (toolAppIds.has(appId)) continue;

            const acfPath = path.join(steamAppsDir, file);
            try {
              const acfContent = fs.readFileSync(acfPath, 'utf8');
              const nameMatch = acfContent.match(/"name"\s+"([^"]+)"/);
              const dirMatch = acfContent.match(/"installdir"\s+"([^"]+)"/);

              const title = nameMatch ? nameMatch[1] : `Steam App ${appId}`;
              // Skip Proton / Redistributables by name
              if (
                title.includes('Steam Linux Runtime') ||
                title.includes('Steamworks Common') ||
                title.includes('Proton')
              ) {
                continue;
              }

              const installDir = dirMatch
                ? path.join(steamAppsDir, 'common', dirMatch[1])
                : steamAppsDir;

              // Check local Steam artwork cache
              let localArtwork = null;
              for (const sPath of steamPaths) {
                const possibleCover = path.join(
                  sPath,
                  'appcache',
                  'librarycache',
                  appId,
                  'library_600x900.jpg'
                );
                const possibleCover2x = path.join(
                  sPath,
                  'appcache',
                  'librarycache',
                  appId,
                  'library_600x900_2x.jpg'
                );
                if (fs.existsSync(possibleCover2x)) {
                  localArtwork = possibleCover2x;
                  break;
                } else if (fs.existsSync(possibleCover)) {
                  localArtwork = possibleCover;
                  break;
                }
              }

              steamGames.push({
                id: `steam_${appId}`,
                originalId: appId,
                appId: appId,
                title: title,
                launcher: 'STEAM',
                source: 'steam_manifest',
                installPath: installDir,
                localArtwork: localArtwork
              });
            } catch (err) {
              console.warn(`[Scanner] Error reading ${file}:`, err.message);
            }
          }
        }
      } catch (err) {
        console.warn(`[Scanner] Error reading steamapps in ${libPath}:`, err.message);
      }
    }

    return steamGames;
  }

  // 3. Scan Epic Games Launcher Manifests
  scanEpicGames() {
    const epicGames = [];
    const manifestsDir = path.join(
      this.programData,
      'Epic',
      'EpicGamesLauncher',
      'Data',
      'Manifests'
    );

    if (fs.existsSync(manifestsDir)) {
      try {
        const files = fs.readdirSync(manifestsDir);
        for (const file of files) {
          if (file.endsWith('.item')) {
            try {
              const fullPath = path.join(manifestsDir, file);
              const data = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
              if (data && data.DisplayName) {
                const title = data.DisplayName;
                epicGames.push({
                  id: `epic_${vault.sanitizeIdentifier(data.AppName || title)}`,
                  originalId: data.AppName || title,
                  title: title,
                  launcher: 'EPIC',
                  source: 'epic_manifest',
                  installPath: data.InstallLocation || '',
                  catalogItemId: data.CatalogItemId || null
                });
              }
            } catch (e) {
              // skip bad item
            }
          }
        }
      } catch (err) {
        console.warn('[Scanner] Error reading Epic manifests:', err.message);
      }
    }
    return epicGames;
  }

  // 4. Scan GOG Galaxy
  scanGOGGames() {
    const gogGames = [];

    // Query Registry HKLM\SOFTWARE\WOW6432Node\GOG.com\Games
    try {
      const regCmd = 'reg query "HKLM\\SOFTWARE\\WOW6432Node\\GOG.com\\Games" /s';
      const out = execSync(regCmd, { stdio: ['pipe', 'pipe', 'ignore'], encoding: 'utf8' });
      const blocks = out.split(/HKEY_LOCAL_MACHINE[^\r\n]+/i);

      for (const block of blocks) {
        const titleMatch = block.match(/gameName\s+REG_SZ\s+(.+)$/m);
        const idMatch = block.match(/gameID\s+REG_SZ\s+(.+)$/m);
        const pathMatch = block.match(/path\s+REG_SZ\s+(.+)$/m);

        if (titleMatch && titleMatch[1]) {
          const title = titleMatch[1].trim();
          const gameId = idMatch ? idMatch[1].trim() : title;
          gogGames.push({
            id: `gog_${vault.sanitizeIdentifier(gameId)}`,
            originalId: gameId,
            title: title,
            launcher: 'GOG',
            source: 'gog_registry',
            installPath: pathMatch ? pathMatch[1].trim() : ''
          });
        }
      }
    } catch (err) {
      // registry key might not exist
    }

    // Scan SQLite storage if exists
    const gogDbPath = path.join(this.programData, 'GOG.com', 'Galaxy', 'storage', 'index.db');
    if (fs.existsSync(gogDbPath)) {
      try {
        const { DatabaseSync } = require('node:sqlite');
        const db = new DatabaseSync(gogDbPath, { readOnly: true });
        const rows = db.prepare('SELECT title, releaseKey FROM Product WHERE isGame = 1').all();
        for (const row of rows) {
          if (row.title) {
            const exists = gogGames.some(g => g.title.toLowerCase() === row.title.toLowerCase());
            if (!exists) {
              gogGames.push({
                id: `gog_${vault.sanitizeIdentifier(row.releaseKey || row.title)}`,
                originalId: row.releaseKey || row.title,
                title: row.title,
                launcher: 'GOG',
                source: 'gog_database',
                installPath: ''
              });
            }
          }
        }
      } catch (err) {
        // SQLite read issue or locked, ignore
      }
    }

    return gogGames;
  }

  // 5. Sample / Demo games for testing and visual showcase
  getSampleGames() {
    return [
      {
        id: 'steam_1091500',
        appId: '1091500',
        title: 'Cyberpunk 2077',
        launcher: 'STEAM',
        source: 'sample',
        installPath: 'C:\\Games\\Steam\\steamapps\\common\\Cyberpunk 2077'
      },
      {
        id: 'steam_1145360',
        appId: '1145360',
        title: 'Hades',
        launcher: 'STEAM',
        source: 'sample',
        installPath: 'C:\\Games\\Steam\\steamapps\\common\\Hades'
      },
      {
        id: 'epic_alanwake2',
        title: 'Alan Wake 2',
        launcher: 'EPIC',
        source: 'sample',
        installPath: 'C:\\Program Files\\Epic Games\\AlanWake2'
      },
      {
        id: 'steam_1245620',
        appId: '1245620',
        title: 'ELDEN RING',
        launcher: 'STEAM',
        source: 'sample',
        installPath: 'C:\\Games\\Steam\\steamapps\\common\\ELDEN RING'
      },
      {
        id: 'gog_witcher3',
        title: 'The Witcher 3: Wild Hunt',
        launcher: 'GOG',
        source: 'sample',
        installPath: 'C:\\GOG Games\\The Witcher 3'
      },
      {
        id: 'shortcut_genshin',
        title: 'Genshin Impact',
        launcher: 'SHORTCUT',
        source: 'sample',
        installPath: 'C:\\Program Files\\Genshin Impact\\launcher.exe'
      },
      {
        id: 'steam_1086940',
        appId: '1086940',
        title: "Baldur's Gate 3",
        launcher: 'STEAM',
        source: 'sample',
        installPath: "C:\\Games\\Steam\\steamapps\\common\\Baldurs Gate 3"
      },
      {
        id: 'epic_gtav',
        title: 'Grand Theft Auto V',
        launcher: 'EPIC',
        source: 'sample',
        installPath: 'C:\\Program Files\\Epic Games\\GTAV'
      }
    ];
  }

  // Master Aggregator: scans all sources, deduplicates, and determines sync status
  async scanAll(options = { includeSamplesIfEmpty: true }) {
    console.log('[Scanner] Beginning multi-launcher discovery...');
    const startTime = Date.now();

    const xboxGames = this.scanXboxAppRegistry();
    const steamGames = this.scanSteamLibraries();
    const epicGames = this.scanEpicGames();
    const gogGames = this.scanGOGGames();
    const customGames = config.get('customGames') || [];

    console.log(
      `[Scanner] Scanned: ${xboxGames.length} Xbox registry, ${steamGames.length} Steam, ${epicGames.length} Epic, ${gogGames.length} GOG, ${customGames.length} Custom`
    );

    // Combine and deduplicate
    const combinedMap = new Map();

    const normalizeKey = (title, launcher) => {
      const clean = (title || '')
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '')
        .trim();
      return `${clean}_${(launcher || '').toLowerCase()}`;
    };

    // Helper to add game
    const addGame = (game) => {
      const key = normalizeKey(game.title, game.launcher);
      if (combinedMap.has(key)) {
        // Merge attributes
        const existing = combinedMap.get(key);
        combinedMap.set(key, {
          ...existing,
          ...game,
          appId: game.appId || existing.appId,
          installPath: game.installPath || existing.installPath,
          inXboxRegistry: existing.inXboxRegistry || game.source === 'xbox_registry'
        });
      } else {
        combinedMap.set(key, {
          ...game,
          inXboxRegistry: game.source === 'xbox_registry'
        });
      }
    };

    // Add in order of priority: Xbox Registry -> Native Launchers -> Custom
    xboxGames.forEach(addGame);
    steamGames.forEach(addGame);
    epicGames.forEach(addGame);
    gogGames.forEach(addGame);
    customGames.forEach(addGame);

    let allGames = Array.from(combinedMap.values());

    // Only real detected games are processed
    if (allGames.length === 0 && options && options.includeSamplesIfEmpty) {
      console.log('[Scanner] No local third-party games found.');
    }

    // Process Sync Status & Artwork availability for each game
    const processedGames = allGames.map(game => {
      const hasVaultCover = vault.hasCover(game.id);
      const vaultMeta = vault.getMetadata(game.id);
      const coverUrl = hasVaultCover ? vault.getCoverAsDataUrl(game.id) : null;

      let status = 'Pending';
      if (hasVaultCover) {
        status = 'Synced';
      } else if (!game.appId && game.launcher === 'SHORTCUT') {
        status = 'Needs Review';
      }

      return {
        ...game,
        hasVaultCover,
        coverUrl,
        lastSynced: vaultMeta ? vaultMeta.savedAt : null,
        status, // 'Synced' | 'Pending' | 'Needs Review'
        resolvedAppId: game.appId || vault.getCachedAppId(this.cleanGameTitle(game.title))
      };
    });

    const elapsed = Date.now() - startTime;
    console.log(`[Scanner] Discovery complete in ${elapsed}ms. Found ${processedGames.length} games.`);
    return processedGames;
  }

  // Utility to clean game title for fuzzy matching
  cleanGameTitle(rawTitle) {
    if (!rawTitle) return '';
    return rawTitle
      // Remove edition tags
      .replace(/\b(Game of the Year|GOTY|Enhanced|Definitive|Remastered|Deluxe|Special|Gold|Standard|Ultimate|Collector'?s|Anniversary|Digital)\s+Edition\b/gi, '')
      .replace(/\b(Director'?s\s+Cut)\b/gi, '')
      .replace(/\b(Edition)\b/gi, '')
      // Remove architecture tags like (x86), (x64)
      .replace(/\((x86|x64|64-bit|32-bit)\)/gi, '')
      // Remove publisher or launcher prefixes/suffixes
      .replace(/\[.*?\]/g, '')
      .replace(/\(.*?\)/g, '')
      // Remove ™ ® ©
      .replace(/[™®©]/g, '')
      // Clean extra spaces
      .replace(/\s+/g, ' ')
      .trim();
  }
}

module.exports = new GameScanner();
