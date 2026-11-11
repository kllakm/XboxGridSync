const https = require('https');
const path = require('path');
const { app } = require('electron');
const config = require('./config');

class AppUpdater {
  constructor() {
    this.repoOwner = 'kllakm';
    this.repoName = 'XboxGridSync';
    this.rateLimitHours = 4;
  }

  // Compare semantic version strings (e.g. "1.9.0" vs "1.8.13")
  compareSemVer(v1, v2) {
    const clean = v => (v || '').replace(/^v/i, '').trim();
    const parts1 = clean(v1).split('.').map(p => parseInt(p, 10) || 0);
    const parts2 = clean(v2).split('.').map(p => parseInt(p, 10) || 0);
    const maxLen = Math.max(parts1.length, parts2.length);

    for (let i = 0; i < maxLen; i++) {
      const p1 = parts1[i] || 0;
      const p2 = parts2[i] || 0;
      if (p1 > p2) return 1;
      if (p1 < p2) return -1;
    }
    return 0;
  }

  isPortableMode() {
    return (
      !!process.env.PORTABLE_EXECUTABLE_FILE ||
      !!process.env.PORTABLE_EXECUTABLE_DIR ||
      path.basename(process.execPath).toLowerCase().includes('portable')
    );
  }

  fetchLatestRelease() {
    return new Promise((resolve, reject) => {
      const options = {
        hostname: 'api.github.com',
        path: `/repos/${this.repoOwner}/${this.repoName}/releases/latest`,
        method: 'GET',
        headers: {
          'User-Agent': `XboxGridSync-App/${app.getVersion()}`,
          'Accept': 'application/vnd.github.v3+json'
        },
        timeout: 9000
      };

      const req = https.request(options, res => {
        // Handle HTTP redirects (301, 302, 307)
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          const redirectUrl = new URL(res.headers.location);
          options.hostname = redirectUrl.hostname;
          options.path = redirectUrl.pathname + redirectUrl.search;
          const redirectReq = https.request(options, rRes => {
            let body = '';
            rRes.on('data', chunk => { body += chunk; });
            rRes.on('end', () => {
              try {
                if (rRes.statusCode !== 200) {
                  return reject(new Error(`GitHub API returned status ${rRes.statusCode}`));
                }
                resolve(JSON.parse(body));
              } catch (e) {
                reject(e);
              }
            });
          });
          redirectReq.on('error', reject);
          redirectReq.on('timeout', () => {
            redirectReq.destroy();
            reject(new Error('Update check request timed out'));
          });
          redirectReq.end();
          return;
        }

        let body = '';
        res.on('data', chunk => { body += chunk; });
        res.on('end', () => {
          try {
            if (res.statusCode === 403 || res.statusCode === 429) {
              return reject(new Error('GitHub API rate limit exceeded. Please try again later.'));
            }
            if (res.statusCode !== 200) {
              return reject(new Error(`GitHub API error (HTTP ${res.statusCode})`));
            }
            resolve(JSON.parse(body));
          } catch (e) {
            reject(e);
          }
        });
      });

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Update check request timed out'));
      });
      req.end();
    });
  }

  async checkUpdate({ force = false } = {}) {
    const currentVersion = app.getVersion();
    const now = Date.now();
    const lastCheck = config.get('lastUpdateCheckTime') || 0;
    const cachedResult = config.get('cachedUpdateResult');

    // Respect rate limits: check cache if not forced and within 4-hour window
    if (!force && cachedResult && (now - lastCheck < this.rateLimitHours * 60 * 60 * 1000)) {
      console.log('[Updater] Returning cached update check result.');
      return {
        ...cachedResult,
        cached: true
      };
    }

    try {
      console.log('[Updater] Querying GitHub API for latest release...');
      const releaseData = await this.fetchLatestRelease();
      const tagName = releaseData.tag_name || '';
      const remoteVersion = tagName.replace(/^v/i, '').trim();
      const isNewer = this.compareSemVer(remoteVersion, currentVersion) > 0;
      const isPortable = this.isPortableMode();

      // Find appropriate asset (portable exe or setup installer)
      let targetAsset = null;
      if (Array.isArray(releaseData.assets)) {
        if (isPortable) {
          targetAsset = releaseData.assets.find(a => a.name.toLowerCase().includes('portable'));
        } else {
          targetAsset = releaseData.assets.find(a => a.name.toLowerCase().includes('setup'));
        }
        // Fallback to any executable asset if specific variant not matched
        if (!targetAsset) {
          targetAsset = releaseData.assets.find(a => a.name.toLowerCase().endsWith('.exe'));
        }
      }

      const downloadUrl = targetAsset ? targetAsset.browser_download_url : (releaseData.html_url || `https://github.com/${this.repoOwner}/${this.repoName}/releases/latest`);

      const result = {
        updateAvailable: isNewer,
        currentVersion,
        latestVersion: remoteVersion,
        releaseTag: tagName,
        releaseName: releaseData.name || tagName,
        releaseNotes: releaseData.body || '',
        releaseUrl: releaseData.html_url || `https://github.com/${this.repoOwner}/${this.repoName}/releases/latest`,
        downloadUrl,
        isPortable,
        checkedAt: now,
        cached: false
      };

      // Save to config cache
      config.set({
        lastUpdateCheckTime: now,
        cachedUpdateResult: result
      });

      return result;
    } catch (err) {
      console.warn('[Updater] Check failed:', err.message);
      // Fallback to cached result if network failed
      if (cachedResult) {
        return {
          ...cachedResult,
          cached: true,
          error: err.message
        };
      }
      return {
        updateAvailable: false,
        currentVersion,
        error: err.message,
        checkedAt: now
      };
    }
  }
}

module.exports = new AppUpdater();

