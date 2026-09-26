// ============================================================================
// Xbox Grid Sync - Main Renderer Application
// ============================================================================

const state = {
  games: [],
  activeFilter: 'all',
  searchQuery: '',
  isSyncing: false
};

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
}

window.updateShieldBadge = function (isActive) {
  const badge = document.getElementById('shieldStatusBadge');
  const text = document.getElementById('shieldStatusText');
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

// ============================================================================
// Library Loading & Rendering
// ============================================================================
window.rescanLibrary = async function () {
  const summaryEl = document.getElementById('gamesCountSummary');
  summaryEl.textContent = '(Scanning...)';

  try {
    const games = await window.api.scanAll({ includeSamplesIfEmpty: false });
    state.games = games;
    updateCounts();
    renderGames();
    summaryEl.textContent = `(${games.length} titles discovered)`;
  } catch (err) {
    summaryEl.textContent = '(Error scanning)';
    window.showToast('Scan Error', err.message, 'error');
  }
};

function updateCounts() {
  const total = state.games.length;
  const steam = state.games.filter(g => (g.launcher || '').toLowerCase() === 'steam').length;
  const epic = state.games.filter(g => (g.launcher || '').toLowerCase() === 'epic').length;
  const gog = state.games.filter(g => (g.launcher || '').toLowerCase() === 'gog').length;
  const shortcut = state.games.filter(g => (g.launcher || '').toLowerCase() === 'shortcut').length;
  const pending = state.games.filter(g => g.status !== 'Synced').length;

  document.getElementById('countAll').textContent = total;
  document.getElementById('countSteam').textContent = steam;
  document.getElementById('countEpic').textContent = epic;
  document.getElementById('countGog').textContent = gog;
  document.getElementById('countShortcut').textContent = shortcut;
  document.getElementById('countPending').textContent = pending;
}

function filterGames() {
  return state.games.filter(game => {
    // Filter pill matching
    if (state.activeFilter !== 'all') {
      if (state.activeFilter === 'pending') {
        if (game.status === 'Synced') return false;
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
    const statusClass = isSynced ? 'synced' : (game.status === 'Needs Review' ? 'review' : 'pending');
    const statusText = isSynced ? '✓ Synced' : (game.status === 'Needs Review' ? 'Needs Review' : 'Pending');

    const posterSrc = game.coverUrl || '';

    card.innerHTML = `
      <div class="card-poster-wrapper">
        <img class="card-poster-img" id="img-${game.id}" src="${posterSrc}" alt="${game.title}" onerror="this.src='data:image/svg+xml;utf8,<svg xmlns=\\'http://www.w3.org/2000/svg\\' width=\\'200\\' height=\\'300\\' fill=\\'%231a1a1a\\'><rect width=\\'200\\' height=\\'300\\' fill=\\'%231a1a1a\\'/><text x=\\'50%\\' y=\\'50%\\' fill=\\'%23666\\' font-family=\\'sans-serif\\' font-size=\\'14\\' text-anchor=\\'middle\\'>No Artwork</text></svg>'">
        
        <div class="card-badges">
          <span class="launcher-pill ${launcherClass}">${game.launcher}</span>
          <span class="status-badge ${statusClass}" id="badge-${game.id}">${statusText}</span>
        </div>

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
          </div>
        </div>
      </div>

      <div class="card-info">
        <div class="card-title" title="${game.title}">${game.title}</div>
        <div class="card-subtext">
          <span>${game.appId ? `AppID: ${game.appId}` : (game.inXboxRegistry ? 'Xbox Registered' : 'Discovered')}</span>
          <span style="color: ${isSynced ? '#4ade80' : 'var(--text-muted)'};">${isSynced ? 'Protected' : 'Unsynced'}</span>
        </div>
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
  }
}

// ============================================================================
// Artwork Synchronization
// ============================================================================
async function syncSingleGame(game) {
  window.showToast('Syncing Artwork', `Resolving vertical cover for "${game.title}"...`, 'info');
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
  const progressFill = document.getElementById('syncProgressFill');

  btnSync.disabled = true;
  btnSync.innerHTML = `
    <svg class="spin-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
      <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"></path>
    </svg>
    <span>Syncing...</span>
  `;

  window.showToast('Sync Started', `Syncing artwork for all ${state.games.length} titles...`, 'info');

  const removeListener = window.api.onSyncProgress((data) => {
    const percent = Math.round((data.current / data.total) * 100);
    progressFill.style.width = `${percent}%`;
  });

  try {
    const results = await window.api.resolveAll(state.games);
    let succeeded = 0;
    for (const r of results) {
      if (r.success) {
        succeeded++;
        onGameCoverUpdated(r.gameId, r.coverUrl);
      }
    }

    window.showToast(
      'Sync Completed!',
      `Successfully upgraded and protected ${succeeded}/${results.length} titles in the Xbox PC App.`,
      'success'
    );
  } catch (err) {
    window.showToast('Batch Sync Error', err.message, 'error');
  } finally {
    state.isSyncing = false;
    btnSync.disabled = false;
    btnSync.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"></path>
      </svg>
      <span>Sync All Artwork</span>
    `;
    setTimeout(() => {
      progressFill.style.width = '0%';
    }, 1500);
    if (removeListener) removeListener();
  }
}

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

  // Filters
  document.querySelectorAll('.filter-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-pill').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.activeFilter = btn.dataset.filter;
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

// Startup
document.addEventListener('DOMContentLoaded', async () => {
  initWindowControls();
  initEventListeners();
  window.ModalManager.init();

  // Load and display dynamic version
  try {
    const version = await window.api.getAppVersion();
    if (version) {
      const badge = document.getElementById('appVersionBadge');
      if (badge) badge.textContent = `v${version}`;
      const settingsVer = document.getElementById('settingsPageVersion') || document.getElementById('settingsModalVersion');
      if (settingsVer) settingsVer.textContent = `v${version}`;
    }
  } catch (err) {
    console.warn('[App] Could not fetch version:', err);
  }

  // Check initial shield status
  try {
    const config = await window.api.getConfig();
    window.updateShieldBadge(config.autoRestore);
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

  // Initial scan
  window.rescanLibrary();
});

