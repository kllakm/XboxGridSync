// ============================================================================
// Modal Management & Artwork Override Engine
// ============================================================================

window.ModalManager = {
  currentOverrideGame: null,
  selectedOverrideCoverUrl: null,
  onOverrideApplyCallback: null,

  init() {
    this.setupOverrideModal();
    this.setupAddGameModal();
    this.setupSettingsModal();
  },

  // 1. Setup Artwork Override Modal
  setupOverrideModal() {
    const modal = document.getElementById('overrideModal');
    const closeBtn = document.getElementById('closeOverrideModalBtn');
    const cancelBtn = document.getElementById('btnCancelOverride');
    const applyBtn = document.getElementById('btnApplyOverride');
    const searchBtn = document.getElementById('btnSearchAlternatives');
    const searchInput = document.getElementById('overrideSearchInput');
    const dropZone = document.getElementById('overrideDropZone');
    const browseLink = document.getElementById('btnBrowseLocalCover');
    const urlInput = document.getElementById('overrideUrlInput');

    const closeModal = () => {
      modal.classList.remove('open');
      this.currentOverrideGame = null;
      this.selectedOverrideCoverUrl = null;
    };

    closeBtn.addEventListener('click', closeModal);
    cancelBtn.addEventListener('click', closeModal);
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeModal();
    });

    this.rawMatches = [];
    this.currentSourceFilter = 'all';

    const sourceButtons = {
      all: document.getElementById('filterSourceAll'),
      steam: document.getElementById('filterSourceSteam'),
      sgdb: document.getElementById('filterSourceSgdb')
    };

    const setSourceFilter = (filterKey) => {
      this.currentSourceFilter = filterKey;
      Object.keys(sourceButtons).forEach(k => {
        if (sourceButtons[k]) {
          sourceButtons[k].classList.toggle('active', k === filterKey);
        }
      });
      this.filterAndRenderMatches();
    };

    if (sourceButtons.all) sourceButtons.all.addEventListener('click', () => setSourceFilter('all'));
    if (sourceButtons.steam) sourceButtons.steam.addEventListener('click', () => setSourceFilter('steam'));
    if (sourceButtons.sgdb) sourceButtons.sgdb.addEventListener('click', () => setSourceFilter('sgdb'));

    // Search alternatives
    const performSearch = async () => {
      const query = searchInput.value.trim();
      if (!query) return;
      const listEl = document.getElementById('overrideMatchesList');
      listEl.innerHTML = '<div style="padding: 12px; color: var(--text-muted); font-size: 12px;">Searching Steam and SteamGridDB databases...</div>';

      try {
        const matches = await window.api.searchAlternatives(query);
        this.rawMatches = matches || [];
        this.filterAndRenderMatches();
      } catch (err) {
        listEl.innerHTML = `<div style="padding: 12px; color: #ef4444; font-size: 12px;">Search failed: ${err.message}</div>`;
      }
    };

    searchBtn.addEventListener('click', performSearch);
    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') performSearch();
    });

    // File Browse
    browseLink.addEventListener('click', async (e) => {
      e.preventDefault();
      try {
        const filePath = await window.api.selectImageFile();
        if (filePath) {
          this.setOverridePreview(filePath);
        }
      } catch (err) {
        console.error(err);
      }
    });

    // Drag & Drop
    dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropZone.classList.add('dragover');
    });
    dropZone.addEventListener('dragleave', () => {
      dropZone.classList.remove('dragover');
    });
    dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropZone.classList.remove('dragover');
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        const file = e.dataTransfer.files[0];
        if (file.type.startsWith('image/')) {
          const reader = new FileReader();
          reader.onload = (readEvt) => {
            this.setOverridePreview(readEvt.target.result);
          };
          reader.readAsDataURL(file);
        }
      }
    });

    // URL input
    urlInput.addEventListener('input', () => {
      const url = urlInput.value.trim();
      if (url.startsWith('http://') || url.startsWith('https://')) {
        this.setOverridePreview(url);
      }
    });

    // Apply Button
    applyBtn.addEventListener('click', async () => {
      if (!this.currentOverrideGame || !this.selectedOverrideCoverUrl) {
        window.showToast('Select an image', 'Please select or search an image first.', 'warning');
        return;
      }

      applyBtn.disabled = true;
      applyBtn.innerHTML = '<span>Saving...</span>';

      try {
        const res = await window.api.applyCustomCover(
          this.currentOverrideGame.id,
          this.selectedOverrideCoverUrl,
          {
            title: this.currentOverrideGame.title,
            launcher: this.currentOverrideGame.launcher
          }
        );

        if (res.success) {
          window.showToast(
            'Artwork Applied!',
            `High-res cover saved to Vault & injected into Xbox App for "${this.currentOverrideGame.title}".`,
            'success'
          );
          if (this.onOverrideApplyCallback) {
            this.onOverrideApplyCallback(this.currentOverrideGame.id, res.coverUrl);
          }
          closeModal();
        } else {
          window.showToast('Save Failed', res.error || 'Failed to apply custom cover', 'error');
        }
      } catch (err) {
        window.showToast('Error', err.message, 'error');
      } finally {
        applyBtn.disabled = false;
        applyBtn.innerHTML = '<span>Apply to Vault & Xbox App</span>';
      }
    });
  },

  openOverrideModal(game, callback) {
    this.currentOverrideGame = game;
    this.onOverrideApplyCallback = callback;

    const modal = document.getElementById('overrideModal');
    const titleEl = document.getElementById('overrideModalTitle');
    const searchInput = document.getElementById('overrideSearchInput');
    const urlInput = document.getElementById('overrideUrlInput');

    titleEl.textContent = `Customize Artwork - ${game.title}`;
    searchInput.value = game.title;
    urlInput.value = '';

    // Set initial preview
    this.setOverridePreview(game.coverUrl || '');

    modal.classList.add('open');

    // Trigger initial search for alternative Steam covers
    document.getElementById('btnSearchAlternatives').click();
  },

  setOverridePreview(urlOrData) {
    this.selectedOverrideCoverUrl = urlOrData;
    const imgEl = document.getElementById('overridePreviewImg');
    if (urlOrData) {
      imgEl.src = urlOrData;
      imgEl.style.display = 'block';
    } else {
      imgEl.src = '';
      imgEl.style.display = 'none';
    }
  },

  filterAndRenderMatches() {
    const listEl = document.getElementById('overrideMatchesList');
    listEl.innerHTML = '';

    let filtered = this.rawMatches || [];
    if (this.currentSourceFilter === 'steam') {
      filtered = filtered.filter(m => (m.source || 'SteamStore') !== 'SteamGridDB');
    } else if (this.currentSourceFilter === 'sgdb') {
      filtered = filtered.filter(m => m.source === 'SteamGridDB');
    }

    if (filtered.length === 0) {
      listEl.innerHTML = '<div style="padding: 12px; color: var(--text-muted); font-size: 12px;">No matches found for the selected filter. Try another title or filter.</div>';
      return;
    }

    filtered.slice(0, 15).forEach(match => {
      const item = document.createElement('div');
      item.className = 'match-item';

      const isSgdb = match.source === 'SteamGridDB';
      const sourceBadgeHtml = isSgdb
        ? '<span class="match-source-badge sgdb">SteamGridDB</span>'
        : '<span class="match-source-badge steam">Steam</span>';

      const simPercent = Math.round(match.similarity * 100);
      item.innerHTML = `
        <img class="match-thumb" src="${match.tinyImage || match.previewUrl}" onerror="this.style.display='none'">
        <div class="match-info">
          <div style="display: flex; align-items: center; gap: 6px;">
            <div class="match-title">${match.name}</div>
            ${sourceBadgeHtml}
          </div>
          <div class="match-appId">${match.appId ? `ID: ${match.appId}` : 'Community Grid'}</div>
        </div>
        <div class="match-score">${simPercent}% Match</div>
      `;

      item.addEventListener('click', () => {
        document.querySelectorAll('.match-item').forEach(m => m.classList.remove('selected'));
        item.classList.add('selected');
        this.setOverridePreview(match.previewUrl);
      });

      listEl.appendChild(item);
    });
  },

  // 2. Setup Add Custom Game Modal
  setupAddGameModal() {
    const modal = document.getElementById('addGameModal');
    const closeBtn = document.getElementById('closeAddGameModalBtn');
    const cancelBtn = document.getElementById('btnCancelAddGame');
    const saveBtn = document.getElementById('btnSaveCustomGame');
    const browseExeBtn = document.getElementById('btnBrowseGameExe');
    const titleInput = document.getElementById('customGameTitleInput');
    const pathInput = document.getElementById('customGamePathInput');
    const launcherSelect = document.getElementById('customGameLauncherSelect');

    const closeModal = () => {
      modal.classList.remove('open');
      titleInput.value = '';
      pathInput.value = '';
    };

    closeBtn.addEventListener('click', closeModal);
    cancelBtn.addEventListener('click', closeModal);
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeModal();
    });

    browseExeBtn.addEventListener('click', async () => {
      const selected = await window.api.selectExecutableFile();
      if (selected) {
        pathInput.value = selected.filePath;
        if (!titleInput.value.trim()) {
          titleInput.value = selected.name;
        }
      }
    });

    saveBtn.addEventListener('click', async () => {
      const title = titleInput.value.trim();
      const execPath = pathInput.value.trim();
      const launcher = launcherSelect.value;

      if (!title) {
        window.showToast('Missing Title', 'Please enter a title for the game.', 'warning');
        return;
      }

      const safeId = `custom_${title.toLowerCase().replace(/[^a-z0-9]/g, '_')}`;
      const newGame = {
        id: safeId,
        title,
        installPath: execPath,
        launcher,
        source: 'user_custom'
      };

      try {
        await window.api.addCustomGame(newGame);
        closeModal();
        window.showToast('Game Added', `Resolving artwork for ${title}...`, 'info');
        window.rescanLibrary();
      } catch (err) {
        window.showToast('Error', err.message, 'error');
      }
    });
  },

  openAddGameModal() {
    document.getElementById('addGameModal').classList.add('open');
  },

  // 3. Setup Full-App Settings Page
  setupSettingsPage() {
    const autoRestoreCheck = document.getElementById('settingAutoRestore');
    const schedulerCheck = document.getElementById('settingTaskScheduler');
    const watcherCheck = document.getElementById('settingLiveWatcher');
    const closeToTrayCheck = document.getElementById('settingCloseToTray');

    const openVaultBtn = document.getElementById('btnOpenVaultFolder');
    const restartXboxBtn = document.getElementById('btnRestartXboxApp');
    const btnBack = document.getElementById('btnBackToLibrary');
    const btnSaveTop = document.getElementById('btnSaveSettingsTop');

    const saveAndClose = async () => {
      const updated = {
        autoRestore: autoRestoreCheck ? autoRestoreCheck.checked : true,
        taskSchedulerEnabled: schedulerCheck ? schedulerCheck.checked : true,
        watchEnabled: watcherCheck ? watcherCheck.checked : true,
        closeToTray: closeToTrayCheck ? closeToTrayCheck.checked : true
      };

      await window.api.setConfig(updated);
      await window.api.setSchedulerEnabled(updated.taskSchedulerEnabled);
      if (window.updateShieldBadge) window.updateShieldBadge(updated.autoRestore);

      window.showToast('Settings Saved', 'Configuration updated successfully.', 'success');
      this.closeSettingsPage();
    };

    if (btnBack) btnBack.addEventListener('click', saveAndClose);
    if (btnSaveTop) btnSaveTop.addEventListener('click', saveAndClose);

    // Escape key returns to library view
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        const settingsView = document.getElementById('settingsView');
        if (settingsView && settingsView.style.display !== 'none') {
          saveAndClose();
        }
      }
    });

    if (openVaultBtn) {
      openVaultBtn.addEventListener('click', async () => {
        await window.api.openVaultFolder();
      });
    }

    if (restartXboxBtn) {
      restartXboxBtn.addEventListener('click', async () => {
        window.showToast('Xbox App', 'Restarting Xbox PC App...', 'info');
        const res = await window.api.restartXboxApp();
        if (res.success) {
          window.showToast('Xbox App', 'Xbox PC App restarted.', 'success');
        } else {
          window.showToast('Notice', res.message || 'Xbox App restarted.', 'info');
        }
      });
    }

    const testSchedulerBtn = document.getElementById('btnTestScheduler');
    if (testSchedulerBtn) {
      testSchedulerBtn.addEventListener('click', async () => {
        window.showToast('Testing Trigger', 'Executing background silent restore via schtasks...', 'info');
        try {
          const res = await window.api.testSchedulerTrigger();
          if (res.success) {
            window.showToast('Trigger Verified!', 'Task executed silently. Background shield is functional.', 'success');
          } else {
            window.showToast('Test Result', res.message || res.error, 'warning');
          }
        } catch (err) {
          window.showToast('Trigger Test Error', err.message, 'error');
        }
      });
    }

    const openSchedulerGuiBtn = document.getElementById('btnOpenTaskSchedulerGui');
    if (openSchedulerGuiBtn) {
      openSchedulerGuiBtn.addEventListener('click', async () => {
        await window.api.openTaskSchedulerGui();
        window.showToast('Task Scheduler', 'Opened Windows Task Scheduler (taskschd.msc).', 'info');
      });
    }

    const donateSettingsBtn = document.getElementById('btnSettingsDonate');
    if (donateSettingsBtn) {
      donateSettingsBtn.addEventListener('click', () => {
        window.api.openExternal('https://buymeacoffee.com/enufstyle');
      });
    }
  },

  async openSettingsPage() {
    const config = await window.api.getConfig();
    const scheduler = await window.api.getSchedulerStatus();

    const autoRestoreCheck = document.getElementById('settingAutoRestore');
    const schedulerCheck = document.getElementById('settingTaskScheduler');
    const watcherCheck = document.getElementById('settingLiveWatcher');
    const closeToTrayCheck = document.getElementById('settingCloseToTray');

    if (autoRestoreCheck) autoRestoreCheck.checked = !!config.autoRestore;
    if (schedulerCheck) schedulerCheck.checked = scheduler.registered;
    if (watcherCheck) watcherCheck.checked = !!config.watchEnabled;
    if (closeToTrayCheck) closeToTrayCheck.checked = !!config.closeToTray;

    const liveBadge = document.getElementById('schedulerLiveStatusBadge');
    if (liveBadge) {
      if (scheduler.registered) {
        liveBadge.innerHTML = '<span class="pulse-dot"></span> Active in Windows (Event 854 + Logon)';
        liveBadge.style.display = 'inline-flex';
      } else {
        liveBadge.innerHTML = '<span style="width:6px;height:6px;border-radius:50%;background:#888;"></span> Not Registered';
        liveBadge.style.display = 'inline-flex';
      }
    }

    // Switch to Settings full-app view
    const libView = document.getElementById('libraryView');
    const setView = document.getElementById('settingsView');
    if (libView) libView.style.display = 'none';
    if (setView) setView.style.display = 'flex';
  },

  closeSettingsPage() {
    const libView = document.getElementById('libraryView');
    const setView = document.getElementById('settingsView');
    if (setView) setView.style.display = 'none';
    if (libView) libView.style.display = 'flex';
  },

  // Alias for backward compatibility
  openSettingsModal() {
    this.openSettingsPage();
  },

  setupSettingsModal() {
    this.setupSettingsPage();
  }
};
