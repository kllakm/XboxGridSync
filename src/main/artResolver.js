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

  // Helper to score and rank SteamGridDB square items by resolution and rating
  scoreAndRankSquareGrids(grids) {
    if (!grids || !Array.isArray(grids) || grids.length === 0) return [];
    const squares = grids.filter(g => {
      if (!g || !g.url) return false;
      const w = g.width || 0;
      const h = g.height || 0;
      if (w > 0 && h > 0) {
        return Math.abs(w - h) <= 2;
      }
      return true;
    });

    squares.sort((a, b) => {
      const getRank = (item) => {
        const w = item.width || 0;
        let resScore = 0;
        if (w >= 1024) resScore = 2500;
        else if (w >= 512) resScore = 1200;
        else if (w > 0) resScore = w;
        else resScore = 600;

        const score = (item.score || 0) * 15 + (item.upvotes || 0) * 5;
        const isPng = (item.url && item.url.toLowerCase().endsWith('.png')) ? 50 : 0;
        return resScore + score + isPng;
      };
      return getRank(b) - getRank(a);
    });

    return squares;
  }

  // Fetch the best 1:1 square artwork buffer from SteamGridDB (ranked by resolution & rating)
  async fetchBestSquareArtwork(game) {
    const apiKey = BUILTIN_SGDB_KEY;
    if (!apiKey) return null;

    let candidateGrids = [];

    // A. Query by Steam AppID directly if available
    if (game.appId) {
      try {
        const squareUrl = `https://www.steamgriddb.com/api/v2/grids/steam/${game.appId}?dimensions=512x512,1024x1024`;
        const sqRes = await fetch(squareUrl, {
          headers: { 'Authorization': `Bearer ${apiKey}`, 'User-Agent': this.userAgent }
        });
        if (sqRes.ok) {
          const sqData = await sqRes.json();
          if (sqData.success && Array.isArray(sqData.data)) {
            candidateGrids.push(...sqData.data);
          }
        }

        // Also check SteamGridDB icons
        const iconUrl = `https://www.steamgriddb.com/api/v2/icons/steam/${game.appId}`;
        const icRes = await fetch(iconUrl, {
          headers: { 'Authorization': `Bearer ${apiKey}`, 'User-Agent': this.userAgent }
        });
        if (icRes.ok) {
          const icData = await icRes.json();
          if (icData.success && Array.isArray(icData.data)) {
            const cleanIcons = icData.data.filter(i => i.url && !i.url.toLowerCase().endsWith('.ico'));
            candidateGrids.push(...cleanIcons);
          }
        }
      } catch (e) {
        console.warn(`[ArtResolver] SGDB Steam query error for ${game.appId}:`, e.message);
      }
    }

    // B. If no square grids found by AppID, search SteamGridDB by title
    if (candidateGrids.length === 0 && game.title) {
      try {
        const cleaned = this.cleanTitle(game.title);
        const searchUrl = `https://www.steamgriddb.com/api/v2/search/autocomplete/${encodeURIComponent(cleaned)}`;
        const res = await fetch(searchUrl, {
          headers: { 'Authorization': `Bearer ${apiKey}`, 'User-Agent': this.userAgent }
        });
        if (res.ok) {
          const data = await res.json();
          if (data.success && data.data && data.data.length > 0) {
            const sgdbGameId = data.data[0].id;

            const sqUrl = `https://www.steamgriddb.com/api/v2/grids/game/${sgdbGameId}?dimensions=512x512,1024x1024`;
            const sqRes = await fetch(sqUrl, {
              headers: { 'Authorization': `Bearer ${apiKey}`, 'User-Agent': this.userAgent }
            });
            if (sqRes.ok) {
              const sqData = await sqRes.json();
              if (sqData.success && Array.isArray(sqData.data)) {
                candidateGrids.push(...sqData.data);
              }
            }

            const icUrl = `https://www.steamgriddb.com/api/v2/icons/game/${sgdbGameId}`;
            const icRes = await fetch(icUrl, {
              headers: { 'Authorization': `Bearer ${apiKey}`, 'User-Agent': this.userAgent }
            });
            if (icRes.ok) {
              const icData = await icRes.json();
              if (icData.success && Array.isArray(icData.data)) {
                const cleanIcons = icData.data.filter(i => i.url && !i.url.toLowerCase().endsWith('.ico'));
                candidateGrids.push(...cleanIcons);
              }
            }
          }
        }
      } catch (e) {
        console.warn(`[ArtResolver] SGDB title search error for "${game.title}":`, e.message);
      }
    }

    const ranked = this.scoreAndRankSquareGrids(candidateGrids);
    if (ranked.length > 0) {
      const best = ranked[0];
      try {
        const buffer = await this.downloadBuffer(best.url);
        return {
          buffer,
          source: 'steamgriddb_square',
          url: best.url,
          width: best.width,
          height: best.height,
          isPreCropped: true
        };
      } catch (downloadErr) {
        console.warn(`[ArtResolver] Failed downloading SGDB square grid from ${best.url}:`, downloadErr.message);
      }
    }

    return null;
  }

  // Fast resolution for scanning: resolves highest-rated square URL from SteamGridDB first, falls back to Steam 2:3
  async getBestSquareCoverUrl(game) {
    if (!this.urlCache) this.urlCache = new Map();
    const cacheKey = (game.appId ? `steam_${game.appId}` : game.id || game.title || '').toLowerCase();
    if (this.urlCache.has(cacheKey)) {
      return this.urlCache.get(cacheKey);
    }

    const apiKey = BUILTIN_SGDB_KEY;
    let candidateGrids = [];
    const cleaned = this.cleanTitle(game.title);

    // 1. Determine or resolve Steam AppID (fastest & most accurate hook for SteamGridDB)
    let resolvedAppId = game.appId;
    if (!resolvedAppId && cleaned) {
      resolvedAppId = vault.getCachedAppId(cleaned);
      if (!resolvedAppId) {
        try {
          const steamMatches = await this.searchSteamStore(cleaned);
          if (steamMatches.length > 0 && steamMatches[0].similarity >= 0.40) {
            resolvedAppId = steamMatches[0].appId;
            vault.setCachedAppId(cleaned, resolvedAppId);
          }
        } catch (e) {}
      }
    }

    // 2. Query SteamGridDB square grids & icons by Steam AppID
    if (resolvedAppId) {
      try {
        const sqUrl = `https://www.steamgriddb.com/api/v2/grids/steam/${resolvedAppId}?dimensions=512x512,1024x1024`;
        const sqRes = await fetch(sqUrl, {
          headers: { 'Authorization': `Bearer ${apiKey}`, 'User-Agent': this.userAgent },
          signal: AbortSignal.timeout(3500)
        });
        if (sqRes.ok) {
          const sqData = await sqRes.json();
          if (sqData.success && Array.isArray(sqData.data)) {
            candidateGrids.push(...sqData.data);
          }
        }

        if (candidateGrids.length === 0) {
          const icUrl = `https://www.steamgriddb.com/api/v2/icons/steam/${resolvedAppId}`;
          const icRes = await fetch(icUrl, {
            headers: { 'Authorization': `Bearer ${apiKey}`, 'User-Agent': this.userAgent },
            signal: AbortSignal.timeout(3000)
          });
          if (icRes.ok) {
            const icData = await icRes.json();
            if (icData.success && Array.isArray(icData.data)) {
              candidateGrids.push(...icData.data.filter(i => i.url && !i.url.toLowerCase().endsWith('.ico')));
            }
          }
        }
      } catch (e) {}
    }

    // 3. Query SteamGridDB by Title Autocomplete if no grids by AppID
    if (candidateGrids.length === 0 && cleaned) {
      try {
        const searchUrl = `https://www.steamgriddb.com/api/v2/search/autocomplete/${encodeURIComponent(cleaned)}`;
        const res = await fetch(searchUrl, {
          headers: { 'Authorization': `Bearer ${apiKey}`, 'User-Agent': this.userAgent },
          signal: AbortSignal.timeout(3500)
        });
        if (res.ok) {
          const data = await res.json();
          if (data.success && data.data && data.data.length > 0) {
            const sgdbGameId = data.data[0].id;
            const sqUrl = `https://www.steamgriddb.com/api/v2/grids/game/${sgdbGameId}?dimensions=512x512,1024x1024`;
            const sqRes = await fetch(sqUrl, {
              headers: { 'Authorization': `Bearer ${apiKey}`, 'User-Agent': this.userAgent },
              signal: AbortSignal.timeout(3500)
            });
            if (sqRes.ok) {
              const sqData = await sqRes.json();
              if (sqData.success && Array.isArray(sqData.data)) {
                candidateGrids.push(...sqData.data);
              }
            }

            if (candidateGrids.length === 0) {
              const icUrl = `https://www.steamgriddb.com/api/v2/icons/game/${sgdbGameId}`;
              const icRes = await fetch(icUrl, {
                headers: { 'Authorization': `Bearer ${apiKey}`, 'User-Agent': this.userAgent },
                signal: AbortSignal.timeout(3000)
              });
              if (icRes.ok) {
                const icData = await icRes.json();
                if (icData.success && Array.isArray(icData.data)) {
                  candidateGrids.push(...icData.data.filter(i => i.url && !i.url.toLowerCase().endsWith('.ico')));
                }
              }
            }
          }
        }
      } catch (e) {}
    }

    // 4. Score and pick best square candidate
    const ranked = this.scoreAndRankSquareGrids(candidateGrids);
    if (ranked.length > 0) {
      const result = { url: ranked[0].url, source: 'steamgriddb_square', isSquare: true };
      this.urlCache.set(cacheKey, result);
      return result;
    }

    // 5. Fallback to Steam Store 2:3 vertical cover if resolvedAppId is available
    if (resolvedAppId) {
      const result = {
        url: `https://cdn.cloudflare.steamstatic.com/steam/apps/${resolvedAppId}/library_600x900_2x.jpg`,
        source: 'steam_store_2x3',
        isSquare: false
      };
      this.urlCache.set(cacheKey, result);
      return result;
    }

    // 6. Universal Fallback: Elegant 1:1 Acrylic Card Template
    try {
      const cardBuffer = this.generateCardTemplate(game.title, game.launcher);
      const dataUrl = `data:image/svg+xml;utf8,${encodeURIComponent(cardBuffer.toString('utf8'))}`;
      const result = { url: dataUrl, source: 'tier3_template', isSquare: true };
      this.urlCache.set(cacheKey, result);
      return result;
    } catch (e) {
      return null;
    }
  }

  // Search alternatives from both Steam Store and built-in SteamGridDB
  async searchAlternatives(gameTitle, appId = null) {
    const cleaned = this.cleanTitle(gameTitle);
    const steamPromise = this.searchSteamStore(cleaned);
    const sgdbPromise = this.searchSteamGridDBGrids(cleaned, BUILTIN_SGDB_KEY, appId);

    const [steamResults, sgdbResults] = await Promise.all([steamPromise, sgdbPromise]);
    // Prioritize SteamGridDB square results, then Steam Store
    return [...sgdbResults, ...steamResults];
  }

  async searchSteamGridDBGrids(gameTitle, apiKey, appId = null) {
    if (!apiKey) return [];
    try {
      const results = [];

      // If appId is provided, directly fetch SteamGridDB grids and icons by Steam AppID
      if (appId) {
        try {
          const sqUrl = `https://www.steamgriddb.com/api/v2/grids/steam/${appId}?dimensions=512x512,1024x1024`;
          const sqRes = await fetch(sqUrl, {
            headers: { 'Authorization': `Bearer ${apiKey}`, 'User-Agent': this.userAgent }
          });
          if (sqRes.ok) {
            const sqData = await sqRes.json();
            if (sqData.success && Array.isArray(sqData.data)) {
              const ranked = this.scoreAndRankSquareGrids(sqData.data);
              for (const grid of ranked) {
                results.push({
                  appId: `SGDB-${grid.id}`,
                  name: `${gameTitle || 'Game'} [Square Grid]`,
                  similarity: 1.0,
                  previewUrl: grid.url,
                  fallbackUrl: grid.thumb,
                  tinyImage: grid.thumb,
                  source: 'SteamGridDB',
                  badge: `${grid.width || 1024}×${grid.height || 1024} Square`
                });
              }
            }
          }

          const icUrl = `https://www.steamgriddb.com/api/v2/icons/steam/${appId}`;
          const icRes = await fetch(icUrl, {
            headers: { 'Authorization': `Bearer ${apiKey}`, 'User-Agent': this.userAgent }
          });
          if (icRes.ok) {
            const icData = await icRes.json();
            if (icData.success && Array.isArray(icData.data)) {
              const cleanIcons = icData.data.filter(i => i.url && !i.url.toLowerCase().endsWith('.ico'));
              for (const icon of cleanIcons.slice(0, 4)) {
                results.push({
                  appId: `SGDB-ICON-${icon.id}`,
                  name: `${gameTitle || 'Game'} [Square Icon]`,
                  similarity: 0.98,
                  previewUrl: icon.url,
                  fallbackUrl: icon.thumb,
                  tinyImage: icon.thumb,
                  source: 'SteamGridDB',
                  badge: '1:1 Icon'
                });
              }
            }
          }
        } catch (err) {}
      }

      const searchUrl = `https://www.steamgriddb.com/api/v2/search/autocomplete/${encodeURIComponent(gameTitle)}`;
      const res = await fetch(searchUrl, {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'User-Agent': this.userAgent
        }
      });
      if (!res.ok) return results;
      const data = await res.json();
      if (!data.success || !data.data || data.data.length === 0) return results;

      for (const game of data.data.slice(0, 2)) {
        // Fetch 1:1 Square Grids
        const squareUrl = `https://www.steamgriddb.com/api/v2/grids/game/${game.id}?dimensions=512x512,1024x1024`;
        try {
          const sqRes = await fetch(squareUrl, {
            headers: { 'Authorization': `Bearer ${apiKey}`, 'User-Agent': this.userAgent }
          });
          if (sqRes.ok) {
            const sqData = await sqRes.json();
            if (sqData.success && sqData.data) {
              for (const grid of sqData.data.slice(0, 4)) {
                results.push({
                  appId: `SGDB-${grid.id}`,
                  name: `${game.name} [Square Grid]`,
                  similarity: 0.99,
                  previewUrl: grid.url,
                  fallbackUrl: grid.thumb,
                  tinyImage: grid.thumb,
                  source: 'SteamGridDB',
                  badge: '1:1 Square'
                });
              }
            }
          }
        } catch (e) {}

        // Fetch Official / Community Icons
        const iconsUrl = `https://www.steamgriddb.com/api/v2/icons/game/${game.id}`;
        try {
          const icRes = await fetch(iconsUrl, {
            headers: { 'Authorization': `Bearer ${apiKey}`, 'User-Agent': this.userAgent }
          });
          if (icRes.ok) {
            const icData = await icRes.json();
            if (icData.success && icData.data) {
              for (const icon of icData.data.slice(0, 2)) {
                results.push({
                  appId: `SGDB-ICON-${icon.id}`,
                  name: `${game.name} [Square Icon]`,
                  similarity: 0.96,
                  previewUrl: icon.url,
                  fallbackUrl: icon.thumb,
                  tinyImage: icon.thumb,
                  source: 'SteamGridDB',
                  badge: '1:1 Icon'
                });
              }
            }
          }
        } catch (e) {}

        // Fetch standard 600x900 vertical posters
        const vertUrl = `https://www.steamgriddb.com/api/v2/grids/game/${game.id}?dimensions=600x900`;
        try {
          const vRes = await fetch(vertUrl, {
            headers: { 'Authorization': `Bearer ${apiKey}`, 'User-Agent': this.userAgent }
          });
          if (vRes.ok) {
            const vData = await vRes.json();
            if (vData.success && vData.data) {
              for (const grid of vData.data.slice(0, 3)) {
                results.push({
                  appId: `SGDB-${grid.id}`,
                  name: `${game.name} [Poster]`,
                  similarity: 0.95,
                  previewUrl: grid.url,
                  fallbackUrl: grid.thumb,
                  tinyImage: grid.thumb,
                  source: 'SteamGridDB',
                  badge: '2:3 Poster'
                });
              }
            }
          }
        } catch (e) {}
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

  <!-- Central Game Icon Graphic (Two-Square Sync) -->
  <g transform="translate(240, 180)">
    <defs>
      <mask id="cardBackMask">
        <rect width="200" height="200" fill="white" />
        <rect x="-8" y="36" width="96" height="96" rx="24" fill="black" />
      </mask>
    </defs>
    <!-- Rear Square -->
    <rect x="44" y="0" width="76" height="76" rx="20" fill="#00A846" mask="url(#cardBackMask)" />
    <!-- Front Square -->
    <rect x="0" y="44" width="76" height="76" rx="20" fill="url(#accent)" />
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

    // 1. Check Vault first (if already protected and not forcing re-fetch)
    if (!options.force && vault.hasCover(game.id)) {
      console.log(`[ArtResolver] Found existing cover in Vault for ${game.id}`);
      return {
        buffer: vault.getCoverBuffer(game.id),
        source: 'vault',
        gameId: game.id,
        isNew: false
      };
    }

    // 2. Preselected Cover URL from initial scan or user modal override
    if (game.coverUrl && !options.ignorePreselected) {
      try {
        if (game.coverUrl.startsWith('data:image/svg+xml;utf8,')) {
          const svgText = decodeURIComponent(game.coverUrl.replace(/^data:image\/svg\+xml;utf8,/, ''));
          const buffer = Buffer.from(svgText, 'utf8');
          vault.saveCover(game.id, buffer, {
            title: game.title,
            launcher: game.launcher,
            appId: game.appId,
            targetImagePath: game.targetImagePath,
            isPreCropped: true,
            source: 'preselected_template'
          });
          return { buffer, source: 'preselected_template', gameId: game.id, isNew: true };
        } else if (game.coverUrl.startsWith('data:image/')) {
          const base64Data = game.coverUrl.replace(/^data:image\/[a-z+]+;base64,/i, '');
          const buffer = Buffer.from(base64Data, 'base64');
          vault.saveCover(game.id, buffer, {
            title: game.title,
            launcher: game.launcher,
            appId: game.appId,
            targetImagePath: game.targetImagePath,
            isPreCropped: !!game.isSquare,
            source: 'preselected_data'
          });
          return { buffer, source: 'preselected_data', gameId: game.id, isNew: true };
        } else if (game.coverUrl.startsWith('http://') || game.coverUrl.startsWith('https://')) {
          console.log(`[ArtResolver] Downloading preselected cover for "${game.title}" from ${game.coverUrl}`);
          const buffer = await this.downloadBuffer(game.coverUrl);
          vault.saveCover(game.id, buffer, {
            title: game.title,
            launcher: game.launcher,
            appId: game.appId,
            targetImagePath: game.targetImagePath,
            url: game.coverUrl,
            isPreCropped: !!game.isSquare,
            source: 'preselected_url'
          });
          return { buffer, source: 'preselected_url', url: game.coverUrl, gameId: game.id, isNew: true };
        } else if (fs.existsSync(game.coverUrl)) {
          const buffer = fs.readFileSync(game.coverUrl);
          vault.saveCover(game.id, buffer, {
            title: game.title,
            launcher: game.launcher,
            appId: game.appId,
            targetImagePath: game.targetImagePath,
            isPreCropped: !!game.isSquare,
            source: 'preselected_file'
          });
          return { buffer, source: 'preselected_file', gameId: game.id, isNew: true };
        }
      } catch (err) {
        console.warn(`[ArtResolver] Could not use preselected coverUrl for "${game.title}":`, err.message);
      }
    }

    // Tier 1 (Preferred Default): Highest-Resolution & Highest-Rated 1:1 Square Artwork from SteamGridDB
    try {
      const squareResult = await this.fetchBestSquareArtwork(game);
      if (squareResult && squareResult.buffer) {
        vault.saveCover(game.id, squareResult.buffer, {
          title: game.title,
          launcher: game.launcher,
          appId: game.appId,
          targetImagePath: game.targetImagePath,
          source: squareResult.source,
          url: squareResult.url,
          isPreCropped: true
        });
        return {
          buffer: squareResult.buffer,
          source: squareResult.source,
          url: squareResult.url,
          gameId: game.id,
          isNew: true
        };
      }
    } catch (sgdbErr) {
      console.warn(`[ArtResolver] SteamGridDB square fetch failed for "${game.title}":`, sgdbErr.message);
    }

    // Tier 2: Default Fallback to Steam Store 2:3 Cover (if Steam AppID is available)
    if (game.appId) {
      try {
        const result = await this.fetchSteamCoverByAppId(game.appId);
        vault.saveCover(game.id, result.buffer, {
          title: game.title,
          launcher: game.launcher,
          appId: game.appId,
          targetImagePath: game.targetImagePath,
          source: result.source,
          url: result.url
        });
        return { buffer: result.buffer, source: result.source, gameId: game.id, isNew: true };
      } catch (err) {
        console.warn(`[ArtResolver] Steam Store fallback fetch failed for AppID ${game.appId}:`, err.message);
      }
    }

    // Tier 3: Check local Steam cache if game has localArtwork path
    if (game.localArtwork && fs.existsSync(game.localArtwork)) {
      try {
        const buffer = fs.readFileSync(game.localArtwork);
        vault.saveCover(game.id, buffer, {
          title: game.title,
          launcher: game.launcher,
          targetImagePath: game.targetImagePath,
          source: 'steam_local_cache'
        });
        return { buffer, source: 'steam_local_cache', gameId: game.id, isNew: true };
      } catch (err) {
        console.warn(`[ArtResolver] Could not read local artwork at ${game.localArtwork}:`, err.message);
      }
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
          targetImagePath: game.targetImagePath,
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
    if (searchResults.length > 0 && searchResults[0].similarity >= 0.40) {
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
          targetImagePath: game.targetImagePath,
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
      targetImagePath: game.targetImagePath,
      source: 'tier3_template'
    });
    return { buffer: cardBuffer, source: 'tier3_template', gameId: game.id, isNew: true };
  }
}

module.exports = new ArtworkResolver();
