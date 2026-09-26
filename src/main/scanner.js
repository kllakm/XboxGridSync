const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');
const vault = require('./vault');
const config = require('./config');
const artResolver = require('./artResolver');

// Built-in SteamGridDB API key for community metadata queries
const BUILTIN_SGDB_KEY = Buffer.from('NzIyMzUxYWRkYTUxMjZjNjhjMTM4ZjE1OGU1Y2U5OTM=', 'base64').toString('utf8');

// Dictionary of known Steam App IDs for instant resolution
const KNOWN_STEAM_TITLES = {
  '250820': 'SteamVR',
  '1091500': 'Cyberpunk 2077',
  '1245620': 'ELDEN RING',
  '1145360': 'Hades',
  '1086940': "Baldur's Gate 3",
  '730': 'Counter-Strike 2',
  '570': 'Dota 2',
  '440': 'Team Fortress 2',
  '271590': 'Grand Theft Auto V',
  '1172470': 'Apex Legends',
  '1172620': 'Sea of Thieves',
  '105600': 'Terraria',
  '252490': 'Rust',
  '413150': 'Stardew Valley',
  '546560': 'Half-Life: Alyx',
  '2358720': 'Black Myth: Wukong',
  '1623730': 'Palworld',
  '553850': 'HELLDIVERS 2',
  '108600': 'Project Zomboid',
  '359550': "Tom Clancy's Rainbow Six Siege",
  '218620': 'PAYDAY 2',
  '292030': 'The Witcher 3: Wild Hunt',
  '812140': "Assassin's Creed Odyssey",
  '1817070': "Marvel's Spider-Man Remastered",
  '990080': 'Hogwarts Legacy',
  '1238810': 'Battlefield V',
  '1238840': 'Battlefield 1',
  '1222670': 'The Sims 4',
  '230410': 'Warframe',
  '550': 'Left 4 Dead 2',
  '4000': "Garry's Mod",
  '220': 'Half-Life 2',
  '1364780': 'Street Fighter 6',
  '1774580': 'STAR WARS Jedi: Survivor',
  '1888930': 'Armored Core VI Fires of Rubicon',
  '1868140': 'Dave the Diver',
  '2050650': 'Resident Evil 4',
  '2195250': 'EA SPORTS FC 24',
  '2420110': 'EA SPORTS FC 25',
  '1794680': 'Vampire Survivors',
  '892970': 'Valheim',
  '39210': 'FINAL FANTASY XIV Online',
  '1446780': 'MONSTER HUNTER RISE',
  '582010': 'MONSTER HUNTER: WORLD',
  '322330': "Don't Starve Together",
  '242760': 'The Forest',
  '1326470': 'Sons of the Forest',
  '1151640': 'Horizon Zero Dawn'
};

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
    this.xboxRoamingThirdPartyDir = path.join(
      this.xboxPackagePath,
      'LocalCache',
      'Roaming',
      'Microsoft',
      'XboxPCApp',
      'ThirdPartyLibraries'
    );

    // In-memory cache for external name lookups
    this.uplayCache = null;
    this.nameCache = new Map();
  }

  // 1. Build local launcher indices for fast offline name and metadata enrichment
  buildLocalEnrichmentIndices() {
    const epicMap = new Map();
    const steamMap = new Map();
    const gogMap = new Map();

    // A. Local Epic Games manifests (.item files)
    try {
      const manifestsDir = path.join(this.programData, 'Epic', 'EpicGamesLauncher', 'Data', 'Manifests');
      if (fs.existsSync(manifestsDir)) {
        const files = fs.readdirSync(manifestsDir);
        for (const file of files) {
          if (!file.endsWith('.item')) continue;
          try {
            const raw = fs.readFileSync(path.join(manifestsDir, file), 'utf8');
            const data = JSON.parse(raw);
            if (data && data.DisplayName) {
              const entry = {
                title: data.DisplayName,
                installPath: data.InstallLocation || '',
                appName: data.AppName || '',
                catalogItemId: data.CatalogItemId || '',
                namespace: data.CatalogNamespace || ''
              };
              if (data.CatalogItemId) epicMap.set(data.CatalogItemId.toLowerCase(), entry);
              if (data.CatalogNamespace) epicMap.set(data.CatalogNamespace.toLowerCase(), entry);
              if (data.AppName) epicMap.set(data.AppName.toLowerCase(), entry);
            }
          } catch (e) {}
        }
      }
    } catch (e) {}

    // B. Local Steam Library manifests (appmanifest_*.acf)
    try {
      const steamPaths = new Set();
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
            if (fs.existsSync(cleanPath)) steamPaths.add(cleanPath);
          }
        } catch (e) {}
      }

      ['C:\\Program Files (x86)\\Steam', 'C:\\Program Files\\Steam', 'D:\\Steam', 'D:\\SteamLibrary', 'E:\\SteamLibrary'].forEach(p => {
        if (fs.existsSync(p)) steamPaths.add(p);
      });

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
              if (fs.existsSync(libPath)) allLibraryFolders.add(libPath);
            }
          } catch (e) {}
        }
      }

      for (const libPath of allLibraryFolders) {
        const steamAppsDir = path.join(libPath, 'steamapps');
        if (!fs.existsSync(steamAppsDir)) continue;
        try {
          const files = fs.readdirSync(steamAppsDir);
          for (const file of files) {
            const match = file.match(/^appmanifest_(\d+)\.acf$/i);
            if (match) {
              const appId = match[1];
              try {
                const acfContent = fs.readFileSync(path.join(steamAppsDir, file), 'utf8');
                const nameMatch = acfContent.match(/"name"\s+"([^"]+)"/);
                const dirMatch = acfContent.match(/"installdir"\s+"([^"]+)"/);
                if (nameMatch && nameMatch[1]) {
                  steamMap.set(appId, {
                    title: nameMatch[1],
                    installPath: dirMatch ? path.join(steamAppsDir, 'common', dirMatch[1]) : ''
                  });
                }
              } catch (e) {}
            }
          }
        } catch (e) {}
      }
    } catch (e) {}

    // C. Local GOG Registry
    try {
      const gogCmd = 'reg query "HKLM\\Software\\WOW6432Node\\GOG.com\\Games"';
      const out = execSync(gogCmd, { stdio: ['pipe', 'pipe', 'ignore'], encoding: 'utf8' });
      const subKeys = out.match(/HKEY_LOCAL_MACHINE\\Software\\WOW6432Node\\GOG\.com\\Games\\\d+/gi) || [];
      for (const key of subKeys) {
        try {
          const detail = execSync(`reg query "${key}"`, { stdio: ['pipe', 'pipe', 'ignore'], encoding: 'utf8' });
          const nameMatch = detail.match(/GAMENAME\s+REG_SZ\s+(.+)$/m);
          const idMatch = detail.match(/GAMEID\s+REG_SZ\s+(.+)$/m);
          const pathMatch = detail.match(/PATH\s+REG_SZ\s+(.+)$/m);
          const gameId = idMatch ? idMatch[1].trim() : path.basename(key);
          if (nameMatch && nameMatch[1]) {
            gogMap.set(gameId, {
              title: nameMatch[1].trim(),
              installPath: pathMatch ? pathMatch[1].trim() : ''
            });
          }
        } catch (e) {}
      }
    } catch (e) {}

    return { epic: epicMap, steam: steamMap, gog: gogMap };
  }

  // 2. Fetch and cache Ubisoft game list from Haoose repository
  async getUbisoftGameName(ubiId) {
    if (!ubiId) return null;
    if (this.uplayCache && this.uplayCache.has(String(ubiId))) {
      return this.uplayCache.get(String(ubiId));
    }

    if (!this.uplayCache) {
      try {
        const res = await fetch('https://raw.githubusercontent.com/Haoose/UPLAY_GAME_ID/refs/heads/master/README.md', {
          signal: AbortSignal.timeout(4000)
        });
        if (res.ok) {
          const text = await res.text();
          this.uplayCache = new Map();
          for (const line of text.split('\n')) {
            const trimmed = line.trim();
            const dashIdx = trimmed.indexOf(' - ');
            if (dashIdx > 0) {
              const idPart = trimmed.substring(0, dashIdx).trim();
              const namePart = trimmed.substring(dashIdx + 3).trim();
              if (idPart && namePart) {
                this.uplayCache.set(idPart, namePart);
              }
            }
          }
        }
      } catch (e) {
        this.uplayCache = new Map();
      }
    }

    return this.uplayCache ? this.uplayCache.get(String(ubiId)) || null : null;
  }

  // 3. Resolve Epic game name via local index, SteamGridDB API, or items-tracker
  async resolveEpicGameName(externalPlatformId, namespace, localEpicMap) {
    const key = (externalPlatformId || namespace || '').toLowerCase();
    if (!key) return null;

    if (this.nameCache.has(`epic_${key}`)) {
      return this.nameCache.get(`epic_${key}`);
    }

    // A. Check local Epic manifests first (instant offline match)
    if (localEpicMap) {
      const match = localEpicMap.get(key) || (namespace ? localEpicMap.get(namespace.toLowerCase()) : null);
      if (match && match.title) {
        this.nameCache.set(`epic_${key}`, match.title);
        return match.title;
      }
    }

    // B. Query SteamGridDB API
    try {
      const sgdbRes = await fetch(`https://www.steamgriddb.com/api/v2/games/egs/${encodeURIComponent(externalPlatformId)}`, {
        headers: { 'Authorization': `Bearer ${BUILTIN_SGDB_KEY}` },
        signal: AbortSignal.timeout(3500)
      });
      if (sgdbRes.ok) {
        const sgdbData = await sgdbRes.json();
        if (sgdbData && sgdbData.success && sgdbData.data && sgdbData.data.name) {
          this.nameCache.set(`epic_${key}`, sgdbData.data.name);
          return sgdbData.data.name;
        }
      }
    } catch (e) {}

    // C. Query GitHub items-tracker database
    try {
      const trackerRes = await fetch(`https://raw.githubusercontent.com/nachoaldamav/items-tracker/refs/heads/main/database/items/${encodeURIComponent(externalPlatformId)}.json`, {
        signal: AbortSignal.timeout(3500)
      });
      if (trackerRes.ok) {
        const itemData = await trackerRes.json();
        if (itemData && itemData.title) {
          this.nameCache.set(`epic_${key}`, itemData.title);
          return itemData.title;
        }
      }
    } catch (e) {}

    return null;
  }

  // 4. Resolve GOG game name via local index or GOG official API
  async resolveGOGGameName(gogId, localGogMap) {
    if (!gogId) return null;
    const cacheKey = `gog_${gogId}`;
    if (this.nameCache.has(cacheKey)) return this.nameCache.get(cacheKey);

    if (localGogMap && localGogMap.has(String(gogId))) {
      const title = localGogMap.get(String(gogId)).title;
      this.nameCache.set(cacheKey, title);
      return title;
    }

    try {
      const res = await fetch(`https://api.gog.com/v2/games/${encodeURIComponent(gogId)}`, {
        signal: AbortSignal.timeout(3500)
      });
      if (res.ok) {
        const data = await res.json();
        if (data && data._embedded && data._embedded.product && data._embedded.product.title) {
          const title = data._embedded.product.title;
          this.nameCache.set(cacheKey, title);
          return title;
        }
      }
    } catch (e) {}

    return null;
  }

  // 5. Scan Xbox PC App's authoritative library from ThirdPartyLibraries and ExternalAppShortcut
  scanXboxAppRegistry(localIndexes = null) {
    const rawGames = [];
    const candidateDirs = [
      this.xboxThirdPartyDir,
      this.xboxRoamingThirdPartyDir,
      path.join(this.xboxPackagePath, 'LocalState', 'CustomLibraryManagement')
    ].filter(d => fs.existsSync(d));

    const providers = ['steam', 'epic', 'gog', 'bnet', 'ea', 'ubi', 'CustomLibraryManagement'];

    for (const baseDir of candidateDirs) {
      for (const prov of providers) {
        const provDir = path.join(baseDir, prov);
        if (!fs.existsSync(provDir)) continue;

        const isCustom = prov === 'CustomLibraryManagement';
        const manifestCandidates = [
          path.join(provDir, `${prov}.manifest`),
          path.join(provDir, `${prov}.json`)
        ];

        // 5A. Parse manifest files (Official Xbox App Manifest Structure)
        for (const mPath of manifestCandidates) {
          if (!fs.existsSync(mPath)) continue;
          try {
            const raw = fs.readFileSync(mPath, 'utf8').trim().replace(/^\uFEFF/, '');
            if (!raw) continue;
            const root = JSON.parse(raw);
            if (!root || !root.gameCache) continue;

            // gameCache can be a Map/Object or an Array
            const entries = [];
            if (Array.isArray(root.gameCache.games)) {
              entries.push(...root.gameCache.games);
            } else if (Array.isArray(root.gameCache)) {
              entries.push(...root.gameCache);
            } else if (typeof root.gameCache === 'object') {
              for (const [key, val] of Object.entries(root.gameCache)) {
                if (key === 'version') continue;
                if (val && typeof val === 'object') {
                  entries.push({ ...val, _mapKey: key });
                }
              }
            }

            for (const item of entries) {
              const rawId = item.id || item._mapKey || item.title;
              if (!rawId) continue;

              // Parse launcher & platform ID
              let launcher = isCustom ? 'CUSTOM' : (prov === 'ubi' ? 'UBISOFT' : prov.toUpperCase());
              let externalPlatformId = String(rawId);
              let namespace = '';

              if (prov === 'steam') {
                externalPlatformId = rawId.replace(/^steam:/i, '');
              } else if (prov === 'epic') {
                const parts = rawId.split(':');
                if (parts.length >= 3) {
                  namespace = parts[1];
                  externalPlatformId = parts[2];
                } else if (parts.length === 2) {
                  externalPlatformId = parts[1];
                }
              } else if (prov === 'gog') {
                externalPlatformId = rawId.replace(/^gog:/i, '');
              } else if (prov === 'ubi') {
                externalPlatformId = rawId.replace(/^ubi:/i, '');
              } else if (prov === 'ea') {
                externalPlatformId = rawId.replace(/^ea:/i, '');
              }

              // Determine exact image path Xbox App uses
              let targetImagePath;
              if (isCustom && item.imagePath) {
                targetImagePath = item.imagePath;
              } else if (isCustom) {
                targetImagePath = path.join(provDir, `${vault.sanitizeIdentifier(rawId)}.png`);
              } else {
                targetImagePath = path.join(provDir, `${rawId.replace(/:/g, '_')}.png`);
              }

              const safeId = vault.sanitizeIdentifier(
                prov === 'steam' ? `steam_${externalPlatformId}` : (prov === 'epic' ? `epic_${externalPlatformId}` : `${prov}_${externalPlatformId}`)
              );

              rawGames.push({
                id: safeId,
                originalId: rawId,
                externalPlatformId,
                namespace,
                appId: prov === 'steam' ? externalPlatformId : null,
                title: item.title || item.name || item.displayName || null,
                launcher,
                targetImagePath,
                installPath: item.installLocation || item.installPath || '',
                executableName: item.executableName || '',
                source: 'xbox_registry',
                currentThumbnail: fs.existsSync(targetImagePath) ? targetImagePath : null
              });
            }
          } catch (e) {
            console.warn(`[Scanner] Warning parsing ${mPath}:`, e.message);
          }
        }

        // 5B. Check directory files for any cached images without an explicit manifest entry
        try {
          const files = fs.readdirSync(provDir);
          for (const file of files) {
            const lower = file.toLowerCase();
            if (lower.endsWith('.bak') || lower.endsWith('.new') || lower.endsWith('.tmp') || lower.includes('_cover.')) {
              continue; // Skip backup, companion, and legacy duplicate files
            }

            if (!lower.endsWith('.png') && !lower.endsWith('.jpg')) {
              continue;
            }

            const fullPath = path.join(provDir, file);
            const baseName = path.parse(file).name;

            // If an entry already tracks this exact targetImagePath, update currentThumbnail
            const existing = rawGames.find(g => g.targetImagePath && g.targetImagePath.toLowerCase() === fullPath.toLowerCase());
            if (existing) {
              if (!existing.currentThumbnail) existing.currentThumbnail = fullPath;
              continue;
            }

            // Otherwise, this is a standalone image cached in the Xbox folder
            let launcher = isCustom ? 'CUSTOM' : (prov === 'ubi' ? 'UBISOFT' : prov.toUpperCase());
            let cleanBase = baseName;
            let externalPlatformId = baseName;
            let namespace = '';

            if (prov === 'steam' || cleanBase.startsWith('steam_')) {
              launcher = 'STEAM';
              externalPlatformId = cleanBase.replace(/^steam_/i, '');
            } else if (prov === 'epic' || cleanBase.startsWith('epic_')) {
              launcher = 'EPIC';
              const withoutPrefix = cleanBase.replace(/^epic_/i, '');
              const parts = withoutPrefix.split('_');
              if (parts.length >= 2) {
                namespace = parts[0];
                externalPlatformId = parts.slice(1).join('_');
              } else {
                externalPlatformId = withoutPrefix;
              }
            } else if (prov === 'gog' || cleanBase.startsWith('gog_')) {
              launcher = 'GOG';
              externalPlatformId = cleanBase.replace(/^gog_/i, '');
            } else if (prov === 'ubi' || cleanBase.startsWith('ubi_')) {
              launcher = 'UBISOFT';
              externalPlatformId = cleanBase.replace(/^ubi_/i, '');
            }

            const safeId = vault.sanitizeIdentifier(
              launcher === 'STEAM' ? `steam_${externalPlatformId}` : `${launcher.toLowerCase()}_${externalPlatformId}`
            );

            // If this is an unmanifested image in a standard provider folder,
            // only treat it as a game if it is actually verified installed in the local launcher index.
            // This prevents orphan cache images from creating ghost games on machines where the game is not installed.
            if (!isCustom) {
              let isInstalled = false;
              if (localIndexes) {
                if (launcher === 'STEAM' && localIndexes.steam && localIndexes.steam.has(externalPlatformId)) {
                  isInstalled = true;
                } else if (launcher === 'EPIC' && localIndexes.epic && (localIndexes.epic.has(externalPlatformId) || localIndexes.epic.has(cleanBase))) {
                  isInstalled = true;
                } else if (launcher === 'GOG' && localIndexes.gog && localIndexes.gog.has(externalPlatformId)) {
                  isInstalled = true;
                }
              }
              if (!isInstalled) {
                continue;
              }
            }

            rawGames.push({
              id: safeId,
              originalId: baseName,
              externalPlatformId,
              namespace,
              appId: launcher === 'STEAM' ? externalPlatformId : null,
              title: null,
              launcher,
              targetImagePath: fullPath,
              installPath: '',
              source: 'xbox_cache',
              currentThumbnail: fullPath
            });
          }
        } catch (e) {}
      }
    }

    // 5C. Scan ExternalAppShortcut directory (manually added shortcuts)
    const externalShortcutDir = path.join(this.xboxPackagePath, 'LocalState', 'ExternalAppShortcut');
    if (fs.existsSync(externalShortcutDir)) {
      try {
        const files = fs.readdirSync(externalShortcutDir);
        for (const file of files) {
          if (file.endsWith('.json') || file.endsWith('.manifest')) {
            try {
              const content = fs.readFileSync(path.join(externalShortcutDir, file), 'utf8');
              const parsed = JSON.parse(content);
              const targetPath = parsed.targetPath || parsed.installPath || '';
              let title = parsed.title || parsed.name || '';
              if (!title || title.toLowerCase() === 'shortcutmanifest') {
                title = targetPath ? path.parse(targetPath).name : 'Custom Shortcut';
              }

              const safeId = `shortcut_${vault.sanitizeIdentifier(parsed.id || title)}`;
              rawGames.push({
                id: safeId,
                originalId: parsed.id || title,
                externalPlatformId: parsed.id || title,
                title,
                launcher: 'SHORTCUT',
                targetImagePath: parsed.iconPath || path.join(externalShortcutDir, `${safeId}.png`),
                installPath: targetPath,
                source: 'xbox_shortcut',
                currentThumbnail: parsed.iconPath && fs.existsSync(parsed.iconPath) ? parsed.iconPath : null
              });
            } catch (e) {}
          }
        }
      } catch (e) {}
    }

    // 5D. Include user-configured custom games from settings
    const customConfigGames = config.get('customGames') || [];
    for (const cg of customConfigGames) {
      const safeId = cg.id || `custom_${vault.sanitizeIdentifier(cg.title)}`;
      const targetImagePath = cg.targetImagePath || path.join(this.xboxCustomLibraryDir, `${safeId}.png`);
      rawGames.push({
        id: safeId,
        originalId: safeId,
        externalPlatformId: safeId,
        title: cg.title,
        launcher: 'CUSTOM',
        targetImagePath,
        installPath: cg.path || '',
        source: 'user_custom',
        currentThumbnail: fs.existsSync(targetImagePath) ? targetImagePath : null
      });
    }

    return rawGames;
  }

  // 6. Master Aggregator & Deduplication Pipeline
  async scanAll(options = { includeSamplesIfEmpty: false }) {
    console.log('[Scanner] Scanning Xbox App ThirdPartyLibraries...');
    const startTime = Date.now();

    // 1. Build local indexes for instant offline enrichment
    const localIndexes = this.buildLocalEnrichmentIndices();

    // 2. Discover games registered in Xbox PC App
    const rawXboxGames = this.scanXboxAppRegistry(localIndexes);
    console.log(`[Scanner] Discovered ${rawXboxGames.length} raw entries in Xbox App.`);

    // 3. Strict Deduplication: Keyed by targetImagePath or canonical identifier
    const uniqueMap = new Map();

    for (const game of rawXboxGames) {
      const key = (game.targetImagePath || game.id).toLowerCase();
      if (!uniqueMap.has(key)) {
        uniqueMap.set(key, game);
      } else {
        // Merge entries if one has better metadata
        const existing = uniqueMap.get(key);
        uniqueMap.set(key, {
          ...existing,
          title: existing.title || game.title,
          installPath: existing.installPath || game.installPath,
          currentThumbnail: existing.currentThumbnail || game.currentThumbnail
        });
      }
    }

    const dedupedGames = Array.from(uniqueMap.values());

    // 4. Resolve clean titles for all entries (eliminates raw hashes like 6504cc... or Ubi 11903)
    const resolvedGames = await Promise.all(dedupedGames.map(async (game) => {
      let title = game.title;

      // Check if title is missing or generic hash/id
      if (this.isGenericTitle(title)) {
        if (game.launcher === 'STEAM' && game.appId) {
          title = KNOWN_STEAM_TITLES[game.appId] ||
            (localIndexes.steam.has(game.appId) ? localIndexes.steam.get(game.appId).title : null) ||
            `Steam App ${game.appId}`;
        } else if (game.launcher === 'EPIC') {
          const resolved = await this.resolveEpicGameName(game.externalPlatformId, game.namespace, localIndexes.epic);
          if (resolved) title = resolved;
        } else if (game.launcher === 'UBISOFT') {
          const resolved = await this.getUbisoftGameName(game.externalPlatformId);
          if (resolved) title = resolved;
        } else if (game.launcher === 'GOG') {
          const resolved = await this.resolveGOGGameName(game.externalPlatformId, localIndexes.gog);
          if (resolved) title = resolved;
        }

        // Final fallback if still generic
        if (!title || this.isGenericTitle(title)) {
          if (game.installPath) {
            title = path.parse(game.installPath).name;
          } else if (game.title && !this.isGenericTitle(game.title)) {
            title = game.title;
          } else {
            title = game.originalId ? game.originalId.replace(/^[a-z]+[_-]/i, '').replace(/[_-]+/g, ' ') : 'Game';
          }
        }
      }

      // Format title cleanly
      title = title.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
      title = title.replace(/\b\w/g, c => c.toUpperCase());

      return {
        ...game,
        title
      };
    }));

    // 5. Final pass deduplication by normalized title to guarantee ONE card per game
    const finalTitleMap = new Map();
    for (const game of resolvedGames) {
      const normalizedTitle = game.title.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (!finalTitleMap.has(normalizedTitle)) {
        finalTitleMap.set(normalizedTitle, game);
      } else {
        const existing = finalTitleMap.get(normalizedTitle);
        // Keep the one with an existing thumbnail or Vault cover
        if (!existing.currentThumbnail && game.currentThumbnail) {
          finalTitleMap.set(normalizedTitle, game);
        }
      }
    }

    const uniqueFinalGames = Array.from(finalTitleMap.values());

    // Helper to process items in a small concurrency-managed pool with stagger to prevent rate-limiting
    const mapConcurrent = async (items, limit, fn) => {
      const results = new Array(items.length);
      let index = 0;
      const worker = async () => {
        while (index < items.length) {
          const i = index++;
          try {
            results[i] = await fn(items[i], i);
          } catch (err) {
            results[i] = null;
          }
          await new Promise(r => setTimeout(r, 40));
        }
      };
      const workers = [];
      for (let w = 0; w < Math.min(limit, items.length); w++) {
        workers.push(worker());
      }
      await Promise.all(workers);
      return results.filter(Boolean);
    };

    // 6. Process Sync Status & Artwork Preview (Auto-selects best available community artwork)
    const processedGames = await mapConcurrent(uniqueFinalGames, 4, async (game) => {
      const hasVaultCover = vault.hasCover(game.id);
      const vaultMeta = vault.getMetadata(game.id);
      let coverUrl = hasVaultCover ? vault.getCoverAsDataUrl(game.id) : null;
      let isSquare = true;

      // Primary Selection on scan: Automatically select best available community artwork
      if (!coverUrl) {
        try {
          const artInfo = await artResolver.getBestSquareCoverUrl(game);
          if (artInfo && artInfo.url) {
            coverUrl = artInfo.url;
            isSquare = !!artInfo.isSquare;
          }
        } catch (e) {
          if (game.appId) {
            coverUrl = `https://cdn.akamai.steamstatic.com/steam/apps/${game.appId}/library_600x900_2x.jpg`;
            isSquare = false;
          }
        }
      }

      // Fallback: If no online thumbnail found, show existing Xbox App thumbnail if present on disk
      if (!coverUrl && game.currentThumbnail && fs.existsSync(game.currentThumbnail)) {
        try {
          const buf = fs.readFileSync(game.currentThumbnail);
          const ext = path.extname(game.currentThumbnail).toLowerCase();
          const mime = ext === '.png' ? 'image/png' : 'image/jpeg';
          coverUrl = `data:${mime};base64,${buf.toString('base64')}`;
        } catch (e) {}
      }

      let status = 'Pending';
      if (hasVaultCover) {
        status = 'Synced';
      } else if (coverUrl && (coverUrl.startsWith('http') || coverUrl.startsWith('data:image/svg'))) {
        status = 'Ready to Sync';
      } else if (!game.appId && game.launcher === 'SHORTCUT') {
        status = 'Needs Review';
      }

      return {
        ...game,
        hasVaultCover,
        coverUrl,
        isSquare,
        lastSynced: vaultMeta ? vaultMeta.savedAt : null,
        status,
        inXboxRegistry: true,
        resolvedAppId: game.appId || vault.getCachedAppId(this.cleanGameTitle(game.title))
      };
    });

    const elapsed = Date.now() - startTime;
    console.log(`[Scanner] Discovery complete in ${elapsed}ms. Found ${processedGames.length} authoritative Xbox games.`);
    this.saveCachedLibrary(processedGames);
    return processedGames;
  }

  // Retrieve cached library scan for instantaneous 0ms display on boot
  getCachedLibrary() {
    try {
      const cachePath = path.join(vault.cacheDir, 'library_cache.json');
      if (fs.existsSync(cachePath)) {
        const raw = fs.readFileSync(cachePath, 'utf8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed;
        }
      }
    } catch (e) {
      console.warn('[Scanner] Could not read library cache:', e.message);
    }
    return [];
  }

  // Persist library scan results to disk
  saveCachedLibrary(games) {
    try {
      if (!Array.isArray(games)) return;
      const cachePath = path.join(vault.cacheDir, 'library_cache.json');
      fs.writeFileSync(cachePath, JSON.stringify(games, null, 2), 'utf8');
    } catch (e) {
      console.warn('[Scanner] Could not write library cache:', e.message);
    }
  }

  // Check if a game title is generic or an unresolved raw ID
  isGenericTitle(title) {
    if (!title) return true;
    const t = String(title).trim().toLowerCase();
    return t === 'shortcutmanifest' ||
      t === 'unknown' ||
      /^\d+$/.test(t) ||
      /^[0-9a-f]{16,}$/i.test(t.replace(/[^0-9a-f]/gi, '')) ||
      t.startsWith('steam app ') ||
      t.startsWith('xbox ') ||
      t.startsWith('ubi ') ||
      t.startsWith('ubi_') ||
      t.startsWith('epic_') ||
      t.startsWith('steam_') ||
      t.startsWith('gog_');
  }

  // Utility to clean game title for fuzzy matching
  cleanGameTitle(rawTitle) {
    if (!rawTitle) return '';
    return rawTitle
      .replace(/\b(Game of the Year|GOTY|Enhanced|Definitive|Remastered|Deluxe|Special|Gold|Standard|Ultimate|Collector'?s|Anniversary|Digital)\s+Edition\b/gi, '')
      .replace(/\b(Director'?s\s+Cut)\b/gi, '')
      .replace(/\b(Edition)\b/gi, '')
      .replace(/\((x86|x64|64-bit|32-bit)\)/gi, '')
      .replace(/\[.*?\]/g, '')
      .replace(/\(.*?\)/g, '')
      .replace(/[™®©]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }
}

module.exports = new GameScanner();
