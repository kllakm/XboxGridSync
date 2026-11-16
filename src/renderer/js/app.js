// ============================================================================
// Xbox Grid Sync - Main Renderer Application
// ============================================================================

const state = {
  games: [],
  activeFilter: 'all',
  searchQuery: '',
  sortBy: 'alpha',
  viewMode: 'grid',
  isSyncing: false
};
window.state = state;

function createDemoGame() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#0f3d22"/>
        <stop offset="52%" stop-color="#14231c"/>
        <stop offset="100%" stop-color="#0c1015"/>
      </linearGradient>
      <radialGradient id="glow" cx="50%" cy="38%" r="48%">
        <stop offset="0%" stop-color="#107c10" stop-opacity="0.72"/>
        <stop offset="100%" stop-color="#107c10" stop-opacity="0"/>
      </radialGradient>
    </defs>
    <rect width="512" height="512" fill="url(#bg)"/>
    <rect width="512" height="512" fill="url(#glow)"/>
    <circle cx="256" cy="196" r="80" fill="none" stroke="#4ade80" stroke-width="6" stroke-opacity="0.5"/>
    <path d="M214 166 L298 226 M298 166 L214 226" stroke="#86efac" stroke-width="10" stroke-linecap="round" stroke-opacity="0.8"/>
    <text x="256" y="346" fill="#ffffff" font-family="Segoe UI, sans-serif" font-size="42" font-weight="800" letter-spacing="3" text-anchor="middle">DEMO GAME</text>
    <text x="256" y="388" fill="#86efac" font-family="Segoe UI, sans-serif" font-size="18" font-weight="600" letter-spacing="4" text-anchor="middle">XBOX GRID SYNC PREVIEW</text>
  </svg>`;
  return {
    id: 'demo-game-seed',
    title: 'Demo Game',
    launcher: 'Xbox',
    appId: 'DEMO-001',
    status: 'Synced',
    inXboxRegistry: true,
    isDemo: true,
    installPath: 'Virtual Demo Library',
    coverUrl: `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
  };
}

function ensureDemoGame(games) {
  const list = Array.isArray(games) ? [...games] : [];
  const hasDemo = list.some(g => g && (g.id === 'demo-game-seed' || g.isDemo));
  if (!hasDemo) {
    list.unshift(createDemoGame());
  }
  return list;
}

// ============================================================================
// Toast Notification Utility
// ============================================================================
window.showToast = function (title, message, type = 'info') {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;

  const iconSvg = type === 'success'
    ? `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#4ade80" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>`
    : type === 'warning'
    ? `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2.5"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>`
    : type === 'error'
    ? `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2.5"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>`
    : `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#60a5fa" stroke-width="2.5"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>`;

  toast.innerHTML = `
    <div class="toast-icon">${iconSvg}</div>
    <div class="toast-content">
      <div class="toast-title">${title}</div>
      <div class="toast-msg">${message}</div>
    </div>
  `;

  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.remove(), 300);
  }, 4500);
};

// ============================================================================
// Window Controls & Shield Status Badge
// ============================================================================
function applyFseState(isFse) {
  const fseBtn = document.getElementById('btnToggleFse');
  if (isFse) {
    document.body.classList.add('fse-mode');
    if (fseBtn) fseBtn.title = 'Exit Exclusive Fullscreen (PC Mode)';
  } else {
    document.body.classList.remove('fse-mode');
    if (fseBtn) fseBtn.title = 'Exclusive Fullscreen Experience (Handheld Mode)';
  }
}

function initWindowControls() {
  document.getElementById('btnMinimize').addEventListener('click', () => {
    window.api.minimizeWindow();
  });
  document.getElementById('btnMaximize').addEventListener('click', () => {
    window.api.maximizeWindow();
  });
  document.getElementById('btnClose').addEventListener('click', () => {
    window.api.closeWindow();
  });

  const donateBtn = document.getElementById('btnTitlebarDonate');
  if (donateBtn) {
    donateBtn.addEventListener('click', () => {
      window.api.openExternal('https://buymeacoffee.com/enufstyle');
    });
  }

  const fseBtn = document.getElementById('btnToggleFse');
  if (fseBtn) {
    fseBtn.addEventListener('click', async () => {
      const isFse = await window.api.toggleFse();
      applyFseState(isFse);
    });
  }

  // Query initial FSE status
  if (window.api && window.api.isFse) {
    window.api.isFse().then(applyFseState).catch(() => {});
  }

  // Listen for FSE state change notifications
  if (window.api && window.api.onFseChanged) {
    window.api.onFseChanged(applyFseState);
  }

  // F11 keyboard shortcut to toggle FSE
  window.addEventListener('keydown', (e) => {
    if (e.key === 'F11') {
      e.preventDefault();
      if (window.api && window.api.toggleFse) {
        window.api.toggleFse().then(applyFseState).catch(() => {});
      }
    }
  });
}

window.updateShieldBadge = function (isActive) {
  const badge = document.getElementById('shieldStatusBadge');
  const text = document.getElementById('shieldStatusText');
  const fseShield = document.getElementById('fseShieldIcon');
  if (fseShield) {
    fseShield.className = `win-btn fse-shield-icon ${isActive ? 'active' : 'inactive'}`;
    fseShield.title = isActive
      ? 'Automated Update Shield is actively protecting artwork'
      : 'Automated Update Shield is disabled in Settings';
  }
  if (!badge) return;
  if (isActive) {
    badge.className = 'shield-badge active';
    if (text) text.textContent = 'Shield Active';
    badge.title = 'Automated Update Shield is actively protecting artwork';
  } else {
    badge.className = 'shield-badge inactive';
    if (text) text.textContent = 'Shield Inactive';
    badge.title = 'Automated Update Shield is disabled in Settings';
  }
};

function updateFseClock() {
  const el = document.getElementById('fseClock');
  if (!el) return;
  const now = new Date();
  el.textContent = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}
setInterval(updateFseClock, 15000);

// ============================================================================
// Library Loading & Rendering
// ============================================================================
window.rescanLibrary = async function () {
  const summaryEl = document.getElementById('gamesCountSummary');
  const loadingIndicator = document.getElementById('gamesLoadingIndicator');
  const emptyState = document.getElementById('emptyState');

  summaryEl.textContent = 'Scanning...';
  if (!state.games || state.games.length === 0) {
    if (loadingIndicator) loadingIndicator.style.display = 'flex';
    if (emptyState) emptyState.style.display = 'none';
  }

  try {
    const games = await window.api.scanAll({ includeSamplesIfEmpty: false });
    state.games = ensureDemoGame(games);
    updateCounts();
    renderGames();
    summaryEl.textContent = `${state.games.length} ${state.games.length === 1 ? 'game' : 'games'}`;
  } catch (err) {
    summaryEl.textContent = 'Error scanning';
    window.showToast('Scan Error', err.message, 'error');
  } finally {
    if (loadingIndicator) loadingIndicator.style.display = 'none';
  }
};

function updateCounts() {
  const total = state.games.length;
  const steam = state.games.filter(g => (g.launcher || '').toLowerCase() === 'steam').length;
  const epic = state.games.filter(g => (g.launcher || '').toLowerCase() === 'epic').length;
  const gog = state.games.filter(g => (g.launcher || '').toLowerCase() === 'gog').length;
  const shortcut = state.games.filter(g => {
    const l = (g.launcher || '').toLowerCase();
    return l === 'shortcut' || l === 'custom';
  }).length;
  const pending = state.games.filter(g => g.status !== 'Synced').length;

  document.getElementById('countAll').textContent = total;
  document.getElementById('countSteam').textContent = steam;
  document.getElementById('countEpic').textContent = epic;
  document.getElementById('countGog').textContent = gog;
  document.getElementById('countShortcut').textContent = shortcut;
  document.getElementById('countPending').textContent = pending;
}
window.updateCounts = updateCounts;

function filterGames() {
  const list = state.games.filter(game => {
    // Filter pill matching
    if (state.activeFilter !== 'all') {
      if (state.activeFilter === 'pending') {
        if (game.status === 'Synced') return false;
      } else if (state.activeFilter === 'synced') {
        if (game.status !== 'Synced') return false;
      } else if (state.activeFilter === 'shortcut') {
        const gameLauncher = (game.launcher || '').toLowerCase();
        if (gameLauncher !== 'shortcut' && gameLauncher !== 'custom') return false;
      } else {
        const gameLauncher = (game.launcher || '').toLowerCase();
        if (gameLauncher !== state.activeFilter) return false;
      }
    }

    // Search query matching
    if (state.searchQuery) {
      const q = state.searchQuery.toLowerCase();
      const titleMatch = (game.title || '').toLowerCase().includes(q);
      const launcherMatch = (game.launcher || '').toLowerCase().includes(q);
      return titleMatch || launcherMatch;
    }

    return true;
  });

  // Sort results
  return list.sort((a, b) => {
    if (state.sortBy === 'status') {
      const sa = a.status === 'Synced' ? 0 : 1;
      const sb = b.status === 'Synced' ? 0 : 1;
      if (sa !== sb) return sa - sb;
    } else if (state.sortBy === 'launcher') {
      const la = (a.launcher || '').localeCompare(b.launcher || '');
      if (la !== 0) return la;
    }
    return (a.title || '').localeCompare(b.title || '');
  });
}

function renderGames() {
  const grid = document.getElementById('gamesGrid');
  const emptyState = document.getElementById('emptyState');
  const filtered = filterGames();

  grid.innerHTML = '';

  if (filtered.length === 0) {
    emptyState.style.display = 'flex';
    return;
  }
  emptyState.style.display = 'none';

  filtered.forEach(game => {
    const card = document.createElement('div');
    card.className = 'game-card';
    card.id = `card-${game.id}`;

    const launcherClass = (game.launcher || 'shortcut').toLowerCase();
    const isSynced = game.status === 'Synced';
    const isReady = game.status === 'Ready to Sync' || (!isSynced && !!game.coverUrl);
    const statusClass = isSynced ? 'synced' : (isReady ? 'ready' : (game.status === 'Needs Review' ? 'review' : 'pending'));
    const statusText = isSynced ? 'Synced' : (isReady ? 'Ready to Sync' : (game.status === 'Needs Review' ? 'Needs Review' : 'Pending'));

    const isCustom = (game.launcher || '').toLowerCase() === 'custom' ||
                     (game.launcher || '').toLowerCase() === 'shortcut' ||
                     game.source === 'xbox_shortcut' ||
                     game.source === 'custom_manifest' ||
                     game.source === 'user_custom';

    const posterSrc = game.coverUrl || '';

    card.innerHTML = `
      <div class="card-poster-wrapper">
        <img class="card-poster-img" id="img-${game.id}" src="${posterSrc}" alt="${game.title}" onerror="this.src='data:image/svg+xml;utf8,<svg xmlns=\\'http://www.w3.org/2000/svg\\' width=\\'300\\' height=\\'300\\' fill=\\'%231c1e21\\'><rect width=\\'300\\' height=\\'300\\' fill=\\'%231c1e21\\'/><text x=\\'50%\\' y=\\'50%\\' fill=\\'%2364748b\\' font-family=\\'sans-serif\\' font-size=\\'16\\' text-anchor=\\'middle\\'>No Artwork</text></svg>'">

        <div class="card-overlay">
          <div class="overlay-btn-group">
            <button class="overlay-btn overlay-btn-primary btn-quick-sync" data-id="${game.id}">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"></path>
              </svg>
              <span>Sync</span>
            </button>
            <button class="overlay-btn overlay-btn-secondary btn-override" data-id="${game.id}">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M12 20h9"></path>
                <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"></path>
              </svg>
              <span>Edit</span>
            </button>
            ${isCustom ? `
              <button class="overlay-btn overlay-btn-secondary btn-delete-custom" data-id="${game.id}" title="Remove Game" style="color: #f87171;">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
              </button>
            ` : ''}
          </div>
        </div>
      </div>

      <div class="card-info">
        <div class="card-info-main">
          <div class="card-badges">
            <span class="launcher-pill ${launcherClass}">${game.launcher}</span>
            <span class="status-badge ${statusClass}" id="badge-${game.id}">${statusText}</span>
          </div>
          <div class="card-title" title="${game.title}">${game.title}</div>
          <div class="card-subtext">
            <span id="subtext-status-${game.id}" style="color: ${isSynced ? '#4ade80' : (isReady ? '#60a5fa' : 'var(--text-muted)')}; font-weight: ${isSynced || isReady ? '600' : '400'};">${isSynced ? 'Protected' : (isReady ? 'Artwork Ready' : 'Needs Art')}</span>
          </div>
        </div>
        <div class="list-col-platform">${game.launcher || 'Custom'}</div>
        <div class="list-col-status">${isSynced ? 'Protected' : (isReady ? 'Artwork Ready' : 'Needs Art')}</div>
      </div>
    `;

    // Click card or edit button to open override modal
    card.addEventListener('click', (e) => {
      // Don't trigger if clicked quick sync directly
      if (e.target.closest('.btn-quick-sync')) {
        e.stopPropagation();
        syncSingleGame(game);
        return;
      }
      if (e.target.closest('.btn-delete-custom')) {
        e.stopPropagation();
        if (confirm(`Remove "${game.title}" from library and Xbox App shortcuts?`)) {
          window.api.deleteCustomGame(game).then((res) => {
            if (res && res.success) {
              window.showToast('Game Removed', `"${game.title}" has been removed.`, 'info');
              window.rescanLibrary();
            }
          });
        }
        return;
      }
      window.ModalManager.openOverrideModal(game, (gameId, newCoverUrl) => {
        onGameCoverUpdated(gameId, newCoverUrl);
      });
    });

    const editBtn = card.querySelector('.btn-override');
    if (editBtn) {
      editBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        window.ModalManager.openOverrideModal(game, (gameId, newCoverUrl) => {
          onGameCoverUpdated(gameId, newCoverUrl);
        });
      });
    }

    grid.appendChild(card);
  });
}
window.renderGames = renderGames;

function onGameCoverUpdated(gameId, newCoverUrl) {
  const g = state.games.find(item => item.id === gameId);
  if (g) {
    g.coverUrl = newCoverUrl;
    g.hasVaultCover = true;
    g.status = 'Synced';
    updateCounts();

    const img = document.getElementById(`img-${gameId}`);
    if (img) img.src = newCoverUrl;

    const badge = document.getElementById(`badge-${gameId}`);
    if (badge) {
      badge.className = 'status-badge synced';
      badge.textContent = '✓ Synced';
    }

    const subtext = document.getElementById(`subtext-status-${gameId}`);
    if (subtext) {
      subtext.style.color = '#4ade80';
      subtext.textContent = 'Protected';
    }
  }
}

// ============================================================================
// Artwork Synchronization
// ============================================================================
async function syncSingleGame(game) {
  if (game && game.isDemo) {
    onGameCoverUpdated(game.id, game.coverUrl);
    window.showToast('Demo Preview', `"${game.title}" is a virtual demo entry — no system files were modified.`, 'success');
    return;
  }
  window.showToast('Syncing Artwork', `Pushing thumbnail for "${game.title}" to Xbox App...`, 'info');
  try {
    const res = await window.api.resolveArtwork(game);
    if (res.success) {
      onGameCoverUpdated(game.id, res.coverUrl);
      window.showToast('Protected!', `Cover for "${game.title}" saved to Vault and injected into Xbox App.`, 'success');
    } else {
      window.showToast('Sync Warning', res.error || 'Failed to resolve artwork', 'warning');
    }
  } catch (err) {
    window.showToast('Error', err.message, 'error');
  }
}

async function syncAllGames() {
  if (state.isSyncing) return;
  state.isSyncing = true;

  const btnSync = document.getElementById('btnSyncAll');
  const fseSync = document.getElementById('fseNavSyncAll');
  const progressFill = document.getElementById('syncProgressFill');

  if (btnSync) { btnSync.disabled = true; btnSync.classList.add('is-syncing'); }
  if (fseSync) { fseSync.disabled = true; fseSync.classList.add('is-syncing'); }

  window.showToast('Sync Started', `Syncing artwork for all ${state.games.length} titles...`, 'info');

  const removeListener = window.api.onSyncProgress((data) => {
    const percent = Math.round((data.current / data.total) * 100);
    progressFill.style.width = `${percent}%`;
  });

  try {
    const realGames = state.games.filter(g => !g.isDemo);
    const results = realGames.length > 0 ? await window.api.resolveAll(realGames) : [];
    let succeeded = 0;
    for (const r of results) {
      if (r.success) {
        succeeded++;
        onGameCoverUpdated(r.gameId, r.coverUrl);
      }
    }

    if (realGames.length === 0) {
      window.showToast('Demo Mode Active', 'Demo Game preview is protected. Click Rescan to discover installed games.', 'info');
    } else {
      window.showToast(
        'Sync Completed!',
        `Successfully upgraded and protected ${succeeded}/${results.length} titles in the Xbox PC App.`,
        'success'
      );
    }
  } catch (err) {
    window.showToast('Batch Sync Error', err.message, 'error');
  } finally {
    state.isSyncing = false;
    if (btnSync) { btnSync.disabled = false; btnSync.classList.remove('is-syncing'); }
    if (fseSync) { fseSync.disabled = false; fseSync.classList.remove('is-syncing'); }
    setTimeout(() => {
      progressFill.style.width = '0%';
    }, 1500);
    if (removeListener) removeListener();
  }
}

let currentUpdateInfo = null;

window.showUpdateBanner = function(updateInfo) {
  currentUpdateInfo = updateInfo;
  const banner = document.getElementById('updateBanner');
  const versionEl = document.getElementById('updateBannerVersion');
  const notesEl = document.getElementById('updateBannerNotes');
  if (!banner) return;

  if (versionEl) versionEl.textContent = `v${updateInfo.latestVersion}`;
  if (notesEl && updateInfo.releaseNotes) {
    const lines = updateInfo.releaseNotes.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const firstBullet = lines.find(l => l.startsWith('-') || l.startsWith('*') || l.startsWith('#')) || lines[0] || '';
    const cleanBullet = firstBullet.replace(/^[#*\s-]+/, '').trim();
    notesEl.textContent = cleanBullet ? cleanBullet : `Release ${updateInfo.releaseTag || ''} is available on GitHub.`;
  }
  banner.style.display = 'flex';
};

window.hideUpdateBanner = function() {
  const banner = document.getElementById('updateBanner');
  if (banner) banner.style.display = 'none';
};

// ============================================================================
// Event Listeners & Initialization
// ============================================================================
function initEventListeners() {
  // Sync All
  document.getElementById('btnSyncAll').addEventListener('click', syncAllGames);

  // Rescan
  document.getElementById('btnRescan').addEventListener('click', () => {
    window.rescanLibrary();
  });

  // Update Banner actions
  const btnUpdateDownload = document.getElementById('btnUpdateDownload');
  if (btnUpdateDownload) {
    btnUpdateDownload.addEventListener('click', () => {
      if (currentUpdateInfo && currentUpdateInfo.downloadUrl) {
        window.api.downloadUpdate(currentUpdateInfo.downloadUrl);
      } else if (currentUpdateInfo && currentUpdateInfo.releaseUrl) {
        window.api.downloadUpdate(currentUpdateInfo.releaseUrl);
      } else {
        window.api.downloadUpdate('https://github.com/kllakm/XboxGridSync/releases/latest');
      }
    });
  }

  const btnUpdateDismiss = document.getElementById('btnUpdateDismiss');
  if (btnUpdateDismiss) {
    btnUpdateDismiss.addEventListener('click', () => {
      window.hideUpdateBanner();
    });
  }

  // Add Game (optional)
  const addGameBtn = document.getElementById('btnAddGame');
  if (addGameBtn) {
    addGameBtn.addEventListener('click', () => {
      window.ModalManager.openAddGameModal();
    });
  }

  // Restore Vault
  document.getElementById('btnRestoreVault').addEventListener('click', async () => {
    window.showToast('Restoring Vault', 'Shielding all artwork into Xbox App cache...', 'info');
    const res = await window.api.restoreVaultToXbox();
    window.showToast('Vault Restored', `${res.restored} master covers reinforced into Xbox App.`, 'success');
  });

  // Settings (Full-App View)
  document.getElementById('btnSettings').addEventListener('click', () => {
    window.ModalManager.openSettingsPage();
  });

  // Settings Sidebar Category Navigation
  document.querySelectorAll('#settingsView .settings-nav-item[data-section]').forEach(navBtn => {
    navBtn.addEventListener('click', () => {
      const target = navBtn.dataset.section;
      document.querySelectorAll('#settingsView .settings-nav-item[data-section]').forEach(b => b.classList.remove('active'));
      navBtn.classList.add('active');
      document.querySelectorAll('#settingsView .settings-section').forEach(sec => {
        sec.classList.toggle('active', sec.dataset.section === target);
      });
      const titleEl = document.getElementById('settingsSectionTitle');
      if (titleEl) titleEl.textContent = navBtn.textContent.trim();
    });
  });

  const btnCloseSettingsX = document.getElementById('btnCloseSettingsX');
  if (btnCloseSettingsX) {
    btnCloseSettingsX.addEventListener('click', () => {
      window.ModalManager.closeSettingsPage();
    });
  }

  // Left Floating Navigation Rail & FSE Top-Center Navigation
  document.getElementById('railLibrary')?.addEventListener('click', () => window.ModalManager.closeSettingsPage());
  document.getElementById('fseNavLibrary')?.addEventListener('click', () => window.ModalManager.closeSettingsPage());
  document.getElementById('fseNavSyncAll')?.addEventListener('click', syncAllGames);
  document.getElementById('fseNavRescan')?.addEventListener('click', window.rescanLibrary);
  document.getElementById('fseNavSettings')?.addEventListener('click', () => window.ModalManager.openSettingsPage());
  document.getElementById('fseShieldIcon')?.addEventListener('click', () => window.ModalManager.openSettingsPage());
  document.getElementById('fseNavSearch')?.addEventListener('click', () => {
    const searchEl = document.getElementById('searchGamesInput');
    document.body.classList.toggle('fse-search-open');
    if (document.body.classList.contains('fse-search-open') && searchEl) {
      setTimeout(() => searchEl.focus(), 50);
    }
  });

  document.getElementById('btnAddCustomQuick')?.addEventListener('click', () => {
    if (window.ModalManager && window.ModalManager.openAddGameModal) {
      window.ModalManager.openAddGameModal();
    }
  });

  updateFseClock();

  // Custom Xbox Sort Dropdown
  const sortWrapper = document.getElementById('sortDropdownWrapper');
  const sortTrigger = document.getElementById('btnSortDropdown');
  const sortMenu = document.getElementById('sortDropdownMenu');
  const sortLabel = document.getElementById('sortDropdownLabel');
  if (sortTrigger && sortMenu && sortWrapper) {
    const closeSortMenu = () => {
      sortMenu.style.display = 'none';
      sortTrigger.classList.remove('open');
      sortTrigger.setAttribute('aria-expanded', 'false');
    };
    sortTrigger.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = sortMenu.style.display !== 'none';
      if (isOpen) {
        closeSortMenu();
      } else {
        sortMenu.style.display = 'block';
        sortTrigger.classList.add('open');
        sortTrigger.setAttribute('aria-expanded', 'true');
      }
    });
    sortMenu.querySelectorAll('.xbox-dropdown-option').forEach(opt => {
      opt.addEventListener('click', () => {
        sortMenu.querySelectorAll('.xbox-dropdown-option').forEach(o => {
          o.classList.remove('selected');
          o.setAttribute('aria-selected', 'false');
        });
        opt.classList.add('selected');
        opt.setAttribute('aria-selected', 'true');
        state.sortBy = opt.dataset.sort || 'alpha';
        if (sortLabel) sortLabel.textContent = opt.querySelector('span')?.textContent || 'Alphabetical';
        closeSortMenu();
        renderGames();
      });
    });
    document.addEventListener('click', (e) => {
      if (!sortWrapper.contains(e.target)) closeSortMenu();
    });
  }

  // Desktop Sidebar Collapse / Expand Toggle
  document.getElementById('btnToggleSidebar')?.addEventListener('click', () => {
    document.body.classList.toggle('sidebar-compact');
  });

  // Grid / List View Dropdown (matches Xbox "View as" menu)
  const viewWrapper = document.getElementById('viewDropdownWrapper');
  const btnViewMode = document.getElementById('btnViewModeToggle');
  const viewMenu = document.getElementById('viewDropdownMenu');
  if (btnViewMode && viewMenu && viewWrapper) {
    const closeViewMenu = () => {
      viewMenu.style.display = 'none';
      btnViewMode.classList.remove('open');
      btnViewMode.setAttribute('aria-expanded', 'false');
    };
    btnViewMode.addEventListener('click', (e) => {
      e.stopPropagation();
      const isOpen = viewMenu.style.display !== 'none';
      if (isOpen) closeViewMenu();
      else {
        viewMenu.style.display = 'block';
        btnViewMode.classList.add('open');
        btnViewMode.setAttribute('aria-expanded', 'true');
      }
    });
    viewMenu.querySelectorAll('.xbox-dropdown-option').forEach(opt => {
      opt.addEventListener('click', () => {
        viewMenu.querySelectorAll('.xbox-dropdown-option').forEach(o => {
          o.classList.remove('selected');
          o.setAttribute('aria-selected', 'false');
        });
        opt.classList.add('selected');
        opt.setAttribute('aria-selected', 'true');
        state.viewMode = opt.dataset.view === 'list' ? 'list' : 'grid';
        const isList = state.viewMode === 'list';
        const grid = document.getElementById('gamesGrid');
        const listHeader = document.getElementById('listViewHeader');
        const gridIcon = btnViewMode.querySelector('.view-icon-grid');
        const listIcon = btnViewMode.querySelector('.view-icon-list');
        if (grid) grid.classList.toggle('list-view', isList);
        if (listHeader) listHeader.style.display = isList ? 'grid' : 'none';
        if (gridIcon) gridIcon.style.display = isList ? 'none' : 'block';
        if (listIcon) listIcon.style.display = isList ? 'block' : 'none';
        btnViewMode.classList.toggle('active', isList);
        closeViewMenu();
      });
    });
    document.addEventListener('click', (e) => {
      if (!viewWrapper.contains(e.target)) closeViewMenu();
    });
  }

  // Quick Filter Toggle Button
  const btnFilterToggle = document.getElementById('btnFilterToggle');
  if (btnFilterToggle) {
    btnFilterToggle.addEventListener('click', () => {
      const next = state.activeFilter === 'pending' ? 'all' : 'pending';
      state.activeFilter = next;
      document.querySelectorAll('.filter-pill').forEach(b => b.classList.toggle('active', b.dataset.filter === next));
      document.querySelectorAll('#libraryQuickTabs .segmented-tab').forEach(t => t.classList.toggle('active', t.dataset.quickFilter === next));
      btnFilterToggle.classList.toggle('active', next === 'pending');
      renderGames();
    });
  }

  // Titlebar Back Button
  const btnTitlebarBack = document.getElementById('btnTitlebarBack');
  if (btnTitlebarBack) {
    btnTitlebarBack.addEventListener('click', () => {
      const settingsView = document.getElementById('settingsView');
      const overrideView = document.getElementById('overrideView');
      if (settingsView && settingsView.style.display !== 'none') {
        window.ModalManager.closeSettingsPage();
      } else if (overrideView && overrideView.style.display !== 'none') {
        document.getElementById('btnBackFromOverride')?.click();
      }
    });
  }

  // Top Segmented Quick Tabs
  document.querySelectorAll('#libraryQuickTabs .segmented-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('#libraryQuickTabs .segmented-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const qf = tab.dataset.quickFilter || 'all';
      state.activeFilter = qf;
      document.querySelectorAll('.filter-pill').forEach(b => {
        b.classList.toggle('active', b.dataset.filter === qf);
      });
      renderGames();
    });
  });

  // Filters
  document.querySelectorAll('.filter-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-pill').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.activeFilter = btn.dataset.filter;
      document.querySelectorAll('#libraryQuickTabs .segmented-tab').forEach(t => {
        t.classList.toggle('active', t.dataset.quickFilter === state.activeFilter);
      });
      renderGames();
    });
  });

  // Search input
  const searchInput = document.getElementById('searchGamesInput');
  searchInput.addEventListener('input', () => {
    state.searchQuery = searchInput.value.trim();
    renderGames();
  });

  // Auto-restore event from FileSystemWatcher
  window.api.onAutoRestoreEvent((eventData) => {
    if (eventData && eventData.result && eventData.result.restored > 0) {
      window.showToast(
        'Artwork Shield Protected',
        `Xbox App update detected (${eventData.reason}). Automatically restored ${eventData.result.restored} master covers from Vault.`,
        'success'
      );
      window.rescanLibrary();
    }
  });
}

// ============================================================================
// 32-bit Floating-Point GPU Ambient Mesh Shader (Zero Banding)
// ============================================================================
function initAmbientMeshShader() {
  const canvas = document.getElementById('xboxAmbientShaderCanvas');
  if (!canvas) return;

  const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false, stencil: false });
  if (!gl) return;

  const vsSource = `#version 300 es
    in vec2 aPos;
    out vec2 vUv;
    void main() {
      vUv = aPos * 0.5 + 0.5;
      gl_Position = vec4(aPos, 0.0, 1.0);
    }
  `;

  const fsSource = `#version 300 es
    precision highp float;
    in vec2 vUv;
    out vec4 fragColor;

    // Interleaved Gradient Noise (32-bit float triangular dither, eliminates 8-bit banding cleanly)
    float ign(vec2 p) {
      vec3 magic = vec3(0.06711056, 0.00583715, 52.9829189);
      return fract(magic.z * fract(dot(p, magic.xy)));
    }

    void main() {
      vec2 uv = vec2(vUv.x, 1.0 - vUv.y);
      vec3 base = vec3(17.0 / 255.0, 18.0 / 255.0, 20.0 / 255.0);

      // Soft Xbox olive-forest ambient mesh lobes
      vec2 d1 = (uv - vec2(0.42, -0.04)) / vec2(0.58, 0.55);
      float w1 = exp(-dot(d1, d1) * 1.45);

      vec2 d2 = (uv - vec2(0.18, 0.14)) / vec2(0.45, 0.42);
      float w2 = exp(-dot(d2, d2) * 1.75);

      vec2 d3 = (uv - vec2(0.75, 0.10)) / vec2(0.52, 0.45);
      float w3 = exp(-dot(d3, d3) * 1.9);

      vec3 oliveGlow = vec3(44.0 / 255.0, 62.0 / 255.0, 44.0 / 255.0);
      vec3 mossGlow  = vec3(34.0 / 255.0, 48.0 / 255.0, 35.0 / 255.0);
      vec3 slateGlow = vec3(28.0 / 255.0, 38.0 / 255.0, 32.0 / 255.0);

      vec3 col = base;
      col = mix(col, oliveGlow, clamp(w1 * 0.62, 0.0, 1.0));
      col = mix(col, mossGlow, clamp(w2 * 0.30, 0.0, 1.0));
      col = mix(col, slateGlow, clamp(w3 * 0.22, 0.0, 1.0));

      // Sub-LSB triangular dithering in 32-bit float
      float n = ign(gl_FragCoord.xy) - 0.5;
      col += n / 255.0;

      fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
    }
  `;

  const compile = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null;
  };

  const vs = compile(gl.VERTEX_SHADER, vsSource);
  const fs = compile(gl.FRAGMENT_SHADER, fsSource);
  if (!vs || !fs) return;

  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return;

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);

  const loc = gl.getAttribLocation(prog, 'aPos');
  gl.useProgram(prog);
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

  const render = () => {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.floor(window.innerWidth * dpr));
    const h = Math.max(1, Math.floor(window.innerHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    gl.viewport(0, 0, w, h);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  };

  render();
  window.addEventListener('resize', render);
}

// Startup
document.addEventListener('DOMContentLoaded', async () => {
  initAmbientMeshShader();
  initWindowControls();
  initEventListeners();
  try {
    window.ModalManager.init();
  } catch (err) {
    console.error('[App] Error initializing ModalManager:', err);
  }

  // Load and display dynamic version
  try {
    const version = await window.api.getAppVersion();
    if (version) {
      const badge = document.getElementById('appVersionBadge');
      if (badge) badge.textContent = `v${version}`;
      const settingsVer = document.getElementById('settingsPageVersion') || document.getElementById('settingsModalVersion');
      if (settingsVer) settingsVer.textContent = `v${version}`;
      const settingsDesc = document.getElementById('settingsUpdateDesc');
      if (settingsDesc) settingsDesc.textContent = `Currently on v${version}. Queries GitHub releases for the latest versions.`;
    }
  } catch (err) {
    console.warn('[App] Could not fetch version:', err);
  }

  // Listen for automatic GitHub updates detected in background
  if (window.api && window.api.onUpdateAvailable) {
    window.api.onUpdateAvailable((updateInfo) => {
      console.log('[App] New update available from GitHub:', updateInfo);
      window.showUpdateBanner(updateInfo);
    });
  }

  // Check initial shield status & first-launch tutorial
  try {
    const config = await window.api.getConfig();
    window.updateShieldBadge(config.autoRestore);
    if (!config.hasSeenTutorial) {
      window.ModalManager.openTutorialModal();
    }
  } catch (err) {
    console.warn('[App] Could not fetch config:', err);
  }

  // Listen for config changes from tray or other sources
  if (window.api.onConfigChanged) {
    window.api.onConfigChanged((cfg) => {
      if (typeof cfg.autoRestore !== 'undefined') {
        window.updateShieldBadge(cfg.autoRestore);
      }
    });
  }

  // Instant Library Rendering from Cache + Mandatory Demo Game (no auto drive scan on startup)
  let initialGames = [];
  try {
    if (window.api && window.api.getCachedLibrary) {
      const cached = await window.api.getCachedLibrary();
      if (Array.isArray(cached) && cached.length > 0) {
        initialGames = cached;
      }
    }
  } catch (e) {}

  state.games = ensureDemoGame(initialGames);
  updateCounts();
  renderGames();
  const summaryEl = document.getElementById('gamesCountSummary');
  if (summaryEl) {
    summaryEl.textContent = `${state.games.length} ${state.games.length === 1 ? 'game' : 'games'}`;
  }
});

