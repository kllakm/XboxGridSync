const fs = require('fs');
const path = require('path');
const vault = require('./vault');
const config = require('./config');

// Internal built-in SteamGridDB API backup key for expanded community grid queries
const BUILTIN_SGDB_KEY = Buffer.from('NzIyMzUxYWRkYTUxMjZjNjhjMTM4ZjE1OGU1Y2U5OTM=', 'base64').toString('utf8');

class ArtworkResolver {
  constructor() {
    this.userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
  }

  // Calculate string similarity (Dice Coefficient + Token overlap)
  calculateSimilarity(str1, str2) {
    if (!str1 || !str2) return 0;
    const s1 = str1.toLowerCase().replace(/[^a-z0-9]/g, '');
    const s2 = str2.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (s1 === s2) return 1.0;
    if (s1.length < 2 || s2.length < 2) return 0.0;

    const bigrams1 = new Set();
    for (let i = 0; i < s1.length - 1; i++) {
      bigrams1.add(s1.substring(i, i + 2));
    }

    let intersection = 0;
    for (let i = 0; i < s2.length - 1; i++) {
      const bg = s2.substring(i, i + 2);
      if (bigrams1.has(bg)) intersection++;
    }

    const dice = (2.0 * intersection) / ((s1.length - 1) + (s2.length - 1));

    // Token overlap check
    const words1 = str1.toLowerCase().split(/\s+/).filter(w => w.length > 2);
    const words2 = str2.toLowerCase().split(/\s+/).filter(w => w.length > 2);
    let matchWords = 0;
    for (const w of words1) {
      if (words2.some(w2 => w2.includes(w) || w.includes(w2))) {
        matchWords++;
      }
    }
    const tokenScore = words1.length > 0 ? (matchWords / words1.length) : 0;

    return Math.max(dice, tokenScore);
  }

  // Clean title for searching
  cleanTitle(rawTitle) {
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

  // Download buffer helper
  async downloadBuffer(url, timeoutMs = 12000) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': this.userAgent },
        signal: controller.signal
      });
      clearTimeout(timeout);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} ${res.statusText}`);
      }
      const arrayBuf = await res.arrayBuffer();
      return Buffer.from(arrayBuf);
    } catch (err) {
      clearTimeout(timeout);
      throw err;
    }
  }

  // Tier 1: Fetch Steam Cover using AppID
  async fetchSteamCoverByAppId(appId) {
    if (!appId) throw new Error('AppId is required for Steam CDN fetch');

    // Try 2x first (higher resolution 600x900)
    const url2x = `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/library_600x900_2x.jpg`;
    const url1x = `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/library_600x900.jpg`;

    try {
      const buffer = await this.downloadBuffer(url2x);
      return { buffer, source: 'steam_cdn_2x', url: url2x };
    } catch (e) {
      // Fallback to 1x
      try {
        const buffer = await this.downloadBuffer(url1x);
        return { buffer, source: 'steam_cdn_1x', url: url1x };
      } catch (err) {
        throw new Error(`Failed to fetch Steam CDN cover for AppID ${appId}: ${err.message}`);
      }
    }
  }

  // Tier 2: Search Steam Store API by cleaned title
  async searchSteamStore(gameTitle) {
    const cleaned = this.cleanTitle(gameTitle);
    if (!cleaned) return [];

    const url = `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(cleaned)}&l=english&cc=US`;
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': this.userAgent }
      });
      if (!res.ok) return [];
      const data = await res.json();
      if (!data || !data.items || !Array.isArray(data.items)) return [];

      // Sort by similarity
      const scored = data.items.map(item => {
        const similarity = this.calculateSimilarity(cleaned, item.name);
        return {
          appId: String(item.id),
          name: item.name,
          similarity,
          previewUrl: `https://cdn.cloudflare.steamstatic.com/steam/apps/${item.id}/library_600x900_2x.jpg`,
          fallbackUrl: `https://cdn.cloudflare.steamstatic.com/steam/apps/${item.id}/library_600x900.jpg`,
          tinyImage: item.tiny_image
        };
      });

      scored.sort((a, b) => b.similarity - a.similarity);
      return scored;
    } catch (err) {
      console.warn(`[ArtResolver] Steam store search failed for "${gameTitle}":`, err.message);
      return [];
    }
  }

  // Tier 4: Optional SteamGridDB API fetch
  async fetchSteamGridDBCover(gameTitle, apiKey) {
    if (!apiKey) return null;
    try {
      const searchUrl = `https://www.steamgriddb.com/api/v2/search/autocomplete/${encodeURIComponent(gameTitle)}`;
      const res = await fetch(searchUrl, {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'User-Agent': this.userAgent
        }
      });
      if (!res.ok) return null;
      const data = await res.json();
      if (data.success && data.data && data.data.length > 0) {
        const sgdbGameId = data.data[0].id;
        const gridsUrl = `https://www.steamgriddb.com/api/v2/grids/game/${sgdbGameId}?dimensions=512x512,1024x1024,600x900`;
        const gridsRes = await fetch(gridsUrl, {
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'User-Agent': this.userAgent
          }
        });
        if (gridsRes.ok) {
          const gridsData = await gridsRes.json();
          if (gridsData.success && gridsData.data && gridsData.data.length > 0) {
            const bestGrid = gridsData.data[0];
            const buffer = await this.downloadBuffer(bestGrid.url);
            return {
              buffer,
              source: 'steamgriddb',
              url: bestGrid.url
            };
          }
        }
      }
    } catch (err) {
      console.warn('[ArtResolver] SteamGridDB fetch error:', err.message);
    }
    return null;
  }

  // Search alternatives from both Steam Store and built-in SteamGridDB
  async searchAlternatives(gameTitle) {
    const cleaned = this.cleanTitle(gameTitle);
    const steamPromise = this.searchSteamStore(cleaned);
    const sgdbPromise = this.searchSteamGridDBGrids(cleaned, BUILTIN_SGDB_KEY);

    const [steamResults, sgdbResults] = await Promise.all([steamPromise, sgdbPromise]);
    return [...steamResults, ...sgdbResults];
  }

  async searchSteamGridDBGrids(gameTitle, apiKey) {
    if (!apiKey) return [];
    try {
      const searchUrl = `https://www.steamgriddb.com/api/v2/search/autocomplete/${encodeURIComponent(gameTitle)}`;
      const res = await fetch(searchUrl, {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'User-Agent': this.userAgent
        }
      });
      if (!res.ok) return [];
      const data = await res.json();
      if (!data.success || !data.data || data.data.length === 0) return [];

      const results = [];
      for (const game of data.data.slice(0, 2)) {
        const gridsUrl = `https://www.steamgriddb.com/api/v2/grids/game/${game.id}?dimensions=512x512,1024x1024,600x900`;
        const gridsRes = await fetch(gridsUrl, {
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'User-Agent': this.userAgent
          }
        });
        if (gridsRes.ok) {
          const gridsData = await gridsRes.json();
          if (gridsData.success && gridsData.data) {
            for (const grid of gridsData.data.slice(0, 4)) {
              results.push({
                appId: `SGDB-${grid.id}`,
                name: `${game.name} [SteamGridDB]`,
                similarity: 0.98,
                previewUrl: grid.url,
                fallbackUrl: grid.thumb,
                tinyImage: grid.thumb,
                source: 'SteamGridDB'
              });
            }
          }
        }
      }
      return results;
    } catch (err) {
      console.warn('[ArtResolver] SGDB search error:', err.message);
      return [];
    }
  }

  // Tier 3: High-Res Clean 1:1 Square (600x600) SVG Card Template Generator
  generateCardTemplate(title, launcher = 'Game') {
    const cleanName = (title || 'Unknown Title')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    const launcherBadge = (launcher || 'XBOX').toUpperCase();

    // Create an elegant dark acrylic 1:1 square tile matching Xbox Fluent design
    const svg = `<svg width="600" height="600" viewBox="0 0 600 600" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#1c1f24" />
      <stop offset="60%" stop-color="#121316" />
      <stop offset="100%" stop-color="#0a0a0c" />
    </linearGradient>
    <linearGradient id="accent" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#00D05E" />
      <stop offset="100%" stop-color="#00FF87" />
    </linearGradient>
    <radialGradient id="glow" cx="50%" cy="40%" r="50%">
      <stop offset="0%" stop-color="#00D05E" stop-opacity="0.35" />
      <stop offset="100%" stop-color="#000000" stop-opacity="0" />
    </radialGradient>
  </defs>

  <!-- Background -->
  <rect width="600" height="600" fill="url(#bg)" />
  <circle cx="300" cy="240" r="240" fill="url(#glow)" />

  <!-- Subtle Border Frame -->
  <rect x="8" y="8" width="584" height="584" rx="20" fill="none" stroke="rgba(255, 255, 255, 0.08)" stroke-width="2" />

  <!-- Top Accent Bar -->
  <rect x="36" y="36" width="50" height="4" rx="2" fill="url(#accent)" />

  <!-- Launcher Badge Pill -->
  <g transform="translate(36, 52)">
    <rect width="100" height="26" rx="6" fill="#181818" stroke="rgba(255, 255, 255, 0.15)" stroke-width="1" />
    <text x="50" y="18" font-family="'Segoe UI', Roboto, sans-serif" font-size="11" font-weight="700" fill="#00FF87" text-anchor="middle" letter-spacing="1">${launcherBadge}</text>
  </g>

  <!-- Central Xbox Game Icon Graphic -->
  <g transform="translate(300, 240)">
    <circle cx="0" cy="0" r="76" fill="#15171a" stroke="#00D05E" stroke-width="3" />
    <!-- Xbox Sphere Curves -->
    <path d="M-38,-38 Q0,0 0,52 Q0,0 38,-38 Q0,-16 -38,-38 Z" fill="#00D05E" />
    <path d="M-52,-18 Q-12,8 -30,42 Q-48,16 -52,-18 Z" fill="#00D05E" />
    <path d="M52,-18 Q12,8 30,42 Q48,16 52,-18 Z" fill="#00D05E" />
  </g>

  <!-- Game Title Bottom Block -->
  <g transform="translate(36, 490)">
    <text x="0" y="0" font-family="'Segoe UI Variable Display', 'Segoe UI', sans-serif" font-size="30" font-weight="800" fill="#ffffff" width="528">
      ${cleanName.length > 24 ? cleanName.substring(0, 22) + '...' : cleanName}
    </text>
    <text x="0" y="28" font-family="'Segoe UI', sans-serif" font-size="13" font-weight="500" fill="#999999" letter-spacing="0.5">
      XBOX GRID SYNC VAULT
    </text>
  </g>

  <!-- Bottom Accent Stripe -->
  <rect x="0" y="594" width="600" height="6" fill="url(#accent)" />
</svg>`;

    return Buffer.from(svg, 'utf8');
  }

  // Master Automated Resolver Pipeline
  async resolveArtwork(game, options = {}) {
    console.log(`[ArtResolver] Resolving artwork for: "${game.title}" (${game.launcher})`);

    // Check Vault first
    if (!options.force && vault.hasCover(game.id)) {
      console.log(`[ArtResolver] Found existing cover in Vault for ${game.id}`);
      return {
        buffer: vault.getCoverBuffer(game.id),
        source: 'vault',
        gameId: game.id,
        isNew: false
      };
    }

    // Check local Steam cache first if game has localArtwork path
    if (game.localArtwork && fs.existsSync(game.localArtwork)) {
      try {
        const buffer = fs.readFileSync(game.localArtwork);
        vault.saveCover(game.id, buffer, {
          title: game.title,
          launcher: game.launcher,
          source: 'steam_local_cache'
        });
        return { buffer, source: 'steam_local_cache', gameId: game.id, isNew: true };
      } catch (err) {
        console.warn(`[ArtResolver] Could not read local artwork at ${game.localArtwork}:`, err.message);
      }
    }

    // Tier 1: Deterministic Steam AppID
    if (game.appId) {
      try {
        const result = await this.fetchSteamCoverByAppId(game.appId);
        vault.saveCover(game.id, result.buffer, {
          title: game.title,
          launcher: game.launcher,
          appId: game.appId,
          source: result.source,
          url: result.url
        });
        return { buffer: result.buffer, source: result.source, gameId: game.id, isNew: true };
      } catch (err) {
        console.warn(`[ArtResolver] Tier 1 AppID fetch failed for ${game.appId}:`, err.message);
      }
    }

    // Check Tier 4: Built-in SteamGridDB backup fallback
    try {
      const sgdbResult = await this.fetchSteamGridDBCover(game.title, BUILTIN_SGDB_KEY);
      if (sgdbResult) {
        vault.saveCover(game.id, sgdbResult.buffer, {
          title: game.title,
          launcher: game.launcher,
          source: sgdbResult.source,
          url: sgdbResult.url
        });
        return { buffer: sgdbResult.buffer, source: sgdbResult.source, gameId: game.id, isNew: true };
      }
    } catch (e) {
      // continue to Tier 2
    }

    // Tier 2: Non-Steam Name Fallback Resolution via Steam Store Search
    const cleaned = this.cleanTitle(game.title);
    let resolvedAppId = vault.getCachedAppId(cleaned);

    if (resolvedAppId) {
      console.log(`[ArtResolver] Found cached AppID ${resolvedAppId} for "${cleaned}"`);
      try {
        const result = await this.fetchSteamCoverByAppId(resolvedAppId);
        vault.saveCover(game.id, result.buffer, {
          title: game.title,
          launcher: game.launcher,
          appId: resolvedAppId,
          source: 'steam_cached_fallback',
          url: result.url
        });
        return { buffer: result.buffer, source: 'steam_cached_fallback', gameId: game.id, isNew: true };
      } catch (err) {
        console.warn(`[ArtResolver] Cached AppID ${resolvedAppId} cover fetch failed:`, err.message);
      }
    }

    // Live Steam Store Search
    const searchResults = await this.searchSteamStore(game.title);
    if (searchResults.length > 0 && searchResults[0].similarity >= 0.45) {
      const topMatch = searchResults[0];
      console.log(
        `[ArtResolver] Matched "${game.title}" -> "${topMatch.name}" (AppID: ${topMatch.appId}, similarity: ${topMatch.similarity.toFixed(2)})`
      );

      try {
        const result = await this.fetchSteamCoverByAppId(topMatch.appId);
        // Cache this mapping permanently
        vault.setCachedAppId(cleaned, topMatch.appId);
        vault.saveCover(game.id, result.buffer, {
          title: game.title,
          matchedTitle: topMatch.name,
          launcher: game.launcher,
          appId: topMatch.appId,
          similarity: topMatch.similarity,
          source: 'steam_store_search',
          url: result.url
        });
        return { buffer: result.buffer, source: 'steam_store_search', gameId: game.id, isNew: true };
      } catch (err) {
        console.warn(`[ArtResolver] Failed fetching matched cover for AppID ${topMatch.appId}:`, err.message);
      }
    }

    // Tier 3: Secondary Fallback (Generated High-Res Acrylic Card)
    console.log(`[ArtResolver] No Steam match found for "${game.title}". Generating Tier 3 card template.`);
    const cardBuffer = this.generateCardTemplate(game.title, game.launcher);
    vault.saveCover(game.id, cardBuffer, {
      title: game.title,
      launcher: game.launcher,
      source: 'tier3_template'
    });
    return { buffer: cardBuffer, source: 'tier3_template', gameId: game.id, isNew: true };
  }
}

module.exports = new ArtworkResolver();
