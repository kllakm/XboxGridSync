// ============================================================================
// Modal & Full-App Studio Management Engine
// ============================================================================

window.ModalManager = {
  currentOverrideGame: null,
  onOverrideApplyCallback: null,
  rawMatches: [],
  currentSourceFilter: 'all',

  // Interactive 1:1 Square Crop Studio State
  cropState: {
    image: null,
    sourceUrl: null,
    zoom: 1.0,
    panX: 0,
    panY: 0,
    isDragging: false,
    startX: 0,
    startY: 0,
    baseScale: 1.0
  },

  init() {
    this.setupOverrideStudio();
    this.setupAddGameModal();
    this.setupSettingsPage();
    this.setupTutorialModal();
  },

  // 1. Setup Full-App Manual Artwork Override Studio
  setupOverrideStudio() {
    const canvas = document.getElementById('cropCanvas');
    const viewport = document.getElementById('cropViewport');
    const zoomSlider = document.getElementById('cropZoomSlider');
    const zoomVal = document.getElementById('cropZoomVal');
    const zoomInBtn = document.getElementById('btnZoomIn');
    const zoomOutBtn = document.getElementById('btnZoomOut');
    const gridOverlay = document.getElementById('cropGridOverlay');
    const toggleGridBtn = document.getElementById('btnToggleGrid');

    const alignTopBtn = document.getElementById('btnAlignTop');
    const alignCenterBtn = document.getElementById('btnAlignCenter');
    const alignBottomBtn = document.getElementById('btnAlignBottom');
    const fitBestBtn = document.getElementById('btnFitBest');
    const resetCropBtn = document.getElementById('btnResetCrop');

    const backBtn = document.getElementById('btnBackFromOverride');
    const cancelBtn = document.getElementById('btnCancelOverridePage');
    const applyBtn = document.getElementById('btnApplyOverridePage');

    const searchInput = document.getElementById('overrideSearchInput');
    const searchBtn = document.getElementById('btnSearchAlternatives');
    const dropZone = document.getElementById('overrideDropZone');
    const browseLink = document.getElementById('btnBrowseLocalCover');
    const urlInput = document.getElementById('overrideUrlInput');
    const loadUrlBtn = document.getElementById('btnLoadUrl');

    const sourceButtons = {
      all: document.getElementById('filterSourceAll'),
      sgdb: document.getElementById('filterSourceSgdb'),
      steam: document.getElementById('filterSourceSteam')
    };

    // Close / Navigation
    const closeStudio = () => {
      this.closeOverridePage();
    };

    if (backBtn) backBtn.addEventListener('click', closeStudio);
    if (cancelBtn) cancelBtn.addEventListener('click', closeStudio);

    // Escape key navigation
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        const overrideView = document.getElementById('overrideView');
        if (overrideView && overrideView.style.display !== 'none') {
          closeStudio();
        }
      }
    });

    // Render Canvas
    this.renderCropCanvas = () => {
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, 1024, 1024);

      if (!this.cropState.image) return;

      const img = this.cropState.image;
      const baseScale = Math.max(1024 / img.width, 1024 / img.height);
      this.cropState.baseScale = baseScale;

      const scale = baseScale * this.cropState.zoom;
      const drawW = img.width * scale;
      const drawH = img.height * scale;

      const drawX = (1024 - drawW) / 2 + this.cropState.panX;
      const drawY = (1024 - drawH) / 2 + this.cropState.panY;

      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, drawX, drawY, drawW, drawH);
    };

    // Zoom Controls
    const updateZoom = (newZoom) => {
      const clamped = Math.max(0.5, Math.min(3.0, Math.round(newZoom * 100) / 100));
      this.cropState.zoom = clamped;
      if (zoomSlider) zoomSlider.value = clamped;
      if (zoomVal) zoomVal.textContent = `${Math.round(clamped * 100)}%`;
      this.renderCropCanvas();
    };

    if (zoomSlider) {
      zoomSlider.addEventListener('input', () => {
        updateZoom(parseFloat(zoomSlider.value));
      });
    }

    if (zoomInBtn) {
      zoomInBtn.addEventListener('click', () => updateZoom(this.cropState.zoom + 0.1));
    }
    if (zoomOutBtn) {
      zoomOutBtn.addEventListener('click', () => updateZoom(this.cropState.zoom - 0.1));
    }

    // Viewport mouse / wheel panning
    if (viewport) {
      viewport.addEventListener('wheel', (e) => {
        e.preventDefault();
        const delta = e.deltaY < 0 ? 0.08 : -0.08;
        updateZoom(this.cropState.zoom + delta);
      }, { passive: false });

      viewport.addEventListener('mousedown', (e) => {
        this.cropState.isDragging = true;
        this.cropState.startX = e.clientX;
        this.cropState.startY = e.clientY;
      });

      window.addEventListener('mousemove', (e) => {
        if (!this.cropState.isDragging) return;
        const factor = 1024 / (viewport.clientWidth || 380);
        const dx = (e.clientX - this.cropState.startX) * factor;
        const dy = (e.clientY - this.cropState.startY) * factor;

        this.cropState.panX += dx;
        this.cropState.panY += dy;
        this.cropState.startX = e.clientX;
        this.cropState.startY = e.clientY;
        this.renderCropCanvas();
      });

      window.addEventListener('mouseup', () => {
        this.cropState.isDragging = false;
      });

      // Touch support
      viewport.addEventListener('touchstart', (e) => {
        if (e.touches.length === 1) {
          this.cropState.isDragging = true;
          this.cropState.startX = e.touches[0].clientX;
          this.cropState.startY = e.touches[0].clientY;
        }
      }, { passive: true });

      viewport.addEventListener('touchmove', (e) => {
        if (!this.cropState.isDragging || e.touches.length !== 1) return;
        const factor = 1024 / (viewport.clientWidth || 380);
        const dx = (e.touches[0].clientX - this.cropState.startX) * factor;
        const dy = (e.touches[0].clientY - this.cropState.startY) * factor;

        this.cropState.panX += dx;
        this.cropState.panY += dy;
        this.cropState.startX = e.touches[0].clientX;
        this.cropState.startY = e.touches[0].clientY;
        this.renderCropCanvas();
      }, { passive: true });

      viewport.addEventListener('touchend', () => {
        this.cropState.isDragging = false;
      });
    }

    // Quick Alignment Buttons
    const setActiveAlignChip = (activeBtn) => {
      [alignTopBtn, alignCenterBtn, alignBottomBtn, fitBestBtn, resetCropBtn].forEach(b => {
        if (b) b.classList.toggle('active', b === activeBtn);
      });
    };

    if (alignTopBtn) {
      alignTopBtn.addEventListener('click', () => {
        if (!this.cropState.image) return;
        setActiveAlignChip(alignTopBtn);
        const img = this.cropState.image;
        const scale = this.cropState.baseScale * this.cropState.zoom;
        const drawH = img.height * scale;
        this.cropState.panY = (drawH - 1024) / 2;
        this.renderCropCanvas();
      });
    }

    if (alignCenterBtn) {
      alignCenterBtn.addEventListener('click', () => {
        setActiveAlignChip(alignCenterBtn);
        this.cropState.panX = 0;
        this.cropState.panY = 0;
        this.renderCropCanvas();
      });
    }

    if (alignBottomBtn) {
      alignBottomBtn.addEventListener('click', () => {
        if (!this.cropState.image) return;
        setActiveAlignChip(alignBottomBtn);
        const img = this.cropState.image;
        const scale = this.cropState.baseScale * this.cropState.zoom;
        const drawH = img.height * scale;
        this.cropState.panY = -(drawH - 1024) / 2;
        this.renderCropCanvas();
      });
    }

    if (fitBestBtn) {
      fitBestBtn.addEventListener('click', () => {
        setActiveAlignChip(fitBestBtn);
        updateZoom(1.0);
        this.cropState.panX = 0;
        this.cropState.panY = 0;
        this.renderCropCanvas();
      });
    }

    if (resetCropBtn) {
      resetCropBtn.addEventListener('click', () => {
        setActiveAlignChip(resetCropBtn);
        updateZoom(1.0);
        this.setDefaultCropPan();
        this.renderCropCanvas();
      });
    }

    // Grid Toggle
    if (toggleGridBtn && gridOverlay) {
      toggleGridBtn.addEventListener('click', () => {
        gridOverlay.classList.toggle('hidden');
        toggleGridBtn.classList.toggle('active', !gridOverlay.classList.contains('hidden'));
      });
    }

    // Source Filter Tabs
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
    if (sourceButtons.sgdb) sourceButtons.sgdb.addEventListener('click', () => setSourceFilter('sgdb'));
    if (sourceButtons.steam) sourceButtons.steam.addEventListener('click', () => setSourceFilter('steam'));

    // Search Database
    const performSearch = async () => {
      const query = searchInput.value.trim();
      if (!query) return;
      const listEl = document.getElementById('overrideMatchesList');
      listEl.innerHTML = '<div style="padding: 14px; color: var(--text-muted); font-size: 12px; text-align: center;">Searching Steam &amp; SteamGridDB for square and cover art...</div>';

      try {
        const matches = await window.api.searchAlternatives(query, this.currentOverrideGame?.appId);
        this.rawMatches = matches || [];
        this.filterAndRenderMatches();
      } catch (err) {
        listEl.innerHTML = `<div style="padding: 12px; color: #ef4444; font-size: 12px;">Search failed: ${err.message}</div>`;
      }
    };

    if (searchBtn) searchBtn.addEventListener('click', performSearch);
    if (searchInput) {
      searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') performSearch();
      });
    }

    // Browse Local File
    if (browseLink) {
      browseLink.addEventListener('click', async (e) => {
        e.preventDefault();
        try {
          const res = await window.api.selectImageFile();
          if (res) {
            const dataUrlOrPath = res.dataUrl || res.filePath;
            await this.loadArtworkIntoStudio(dataUrlOrPath);
          }
        } catch (err) {
          window.showToast('File Error', err.message, 'error');
        }
      });
    }

    // Drag & Drop
    if (dropZone) {
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
              this.loadArtworkIntoStudio(readEvt.target.result);
            };
            reader.readAsDataURL(file);
          }
        }
      });
    }

    // URL input
    const loadUrlAction = () => {
      const url = urlInput.value.trim();
      if (url.startsWith('http://') || url.startsWith('https://')) {
        this.loadArtworkIntoStudio(url);
      }
    };
    if (loadUrlBtn) loadUrlBtn.addEventListener('click', loadUrlAction);
    if (urlInput) {
      urlInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') loadUrlAction();
      });
    }

    // Save & Inject Button
    if (applyBtn) {
      applyBtn.addEventListener('click', async () => {
        if (!this.currentOverrideGame || !this.cropState.image) {
          window.showToast('No Image', 'Please select or search an image first.', 'warning');
          return;
        }

        applyBtn.disabled = true;
        applyBtn.innerHTML = '<span>Injecting to Xbox App...</span>';

        try {
          // Render lossless high-res 1:1 square PNG from canvas
          const pngDataUrl = canvas.toDataURL('image/png', 1.0);

          const res = await window.api.applyCustomCover(
            this.currentOverrideGame.id,
            pngDataUrl,
            {
              title: this.currentOverrideGame.title,
              launcher: this.currentOverrideGame.launcher,
              isPreCropped: true
            }
          );

          if (res.success) {
            window.showToast(
              'Artwork Injected!',
              `Lossless 1:1 square PNG saved to Xbox App & Vault for "${this.currentOverrideGame.title}".`,
              'success'
            );
            if (this.onOverrideApplyCallback) {
              this.onOverrideApplyCallback(this.currentOverrideGame.id, res.coverUrl);
            }
            closeStudio();
          } else {
            window.showToast('Save Failed', res.error || 'Failed to inject custom cover', 'error');
          }
        } catch (err) {
          window.showToast('Error', err.message, 'error');
        } finally {
          applyBtn.disabled = false;
          applyBtn.innerHTML = `
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
            <span>Save &amp; Inject to Xbox</span>
          `;
        }
      });
    }
  },

  // Open Full-App Override Page
  openOverridePage(game, callback) {
    this.currentOverrideGame = game;
    this.onOverrideApplyCallback = callback;

    const titleEl = document.getElementById('overridePageTitle');
    const badgeEl = document.getElementById('overrideGameBadge');
    const searchInput = document.getElementById('overrideSearchInput');
    const urlInput = document.getElementById('overrideUrlInput');

    if (titleEl) titleEl.textContent = `Customize Artwork - ${game.title}`;
    if (badgeEl) badgeEl.textContent = game.launcher || 'GAME';
    if (searchInput) searchInput.value = game.title;
    if (urlInput) urlInput.value = '';

    // Switch views to full-app override view
    const libView = document.getElementById('libraryView');
    const setView = document.getElementById('settingsView');
    const ovView = document.getElementById('overrideView');

    if (libView) libView.style.display = 'none';
    if (setView) setView.style.display = 'none';
    if (ovView) {
      ovView.style.display = 'flex';
      window.scrollTo(0, 0);
    }

    // Load initial cover into studio (from vault cover, local cache thumbnail, or steam cdn)
    const initialUrl = game.coverUrl || game.currentThumbnail || (game.appId ? `https://cdn.akamai.steamstatic.com/steam/apps/${game.appId}/library_600x900_2x.jpg` : null);
    if (initialUrl) {
      this.loadArtworkIntoStudio(initialUrl);
    } else {
      // Clear canvas
      this.cropState.image = null;
      this.renderCropCanvas();
    }

    // Trigger initial search for alternative Steam / SGDB covers
    const searchBtn = document.getElementById('btnSearchAlternatives');
    if (searchBtn) searchBtn.click();
  },

  // Backward compatibility alias
  openOverrideModal(game, callback) {
    this.openOverridePage(game, callback);
  },

  closeOverridePage() {
    const libView = document.getElementById('libraryView');
    const ovView = document.getElementById('overrideView');
    if (ovView) ovView.style.display = 'none';
    if (libView) libView.style.display = 'flex';
    this.currentOverrideGame = null;
  },

  // Set default pan: for vertical posters (height > width), shift up slightly to frame title & keyart
  setDefaultCropPan() {
    if (!this.cropState.image) return;
    const img = this.cropState.image;
    this.cropState.panX = 0;
    if (img.height > img.width) {
      const baseScale = 1024 / img.width;
      const extraH = img.height * baseScale - 1024;
      // 0.35 bias keeps the upper-middle title and hero art visible
      this.cropState.panY = -Math.round(extraH * 0.35);
    } else if (img.width > img.height) {
      this.cropState.panY = 0;
    } else {
      this.cropState.panY = 0;
    }
  },

  // Reliable image loader: handles local paths, CORS errors, and direct dataURLs
  async loadArtworkIntoStudio(urlOrPath) {
    if (!urlOrPath) return;

    const spinner = document.getElementById('cropLoadingSpinner');
    if (spinner) spinner.style.display = 'flex';

    const dimText = document.getElementById('cropSourceDimensions');
    if (dimText) dimText.textContent = 'Loading source image...';

    const loadImageElement = (src) => {
      return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => resolve(img);
        img.onerror = (e) => reject(new Error('Image failed to load in browser context'));
        img.src = src;
      });
    };

    let loadedImg = null;
    try {
      // Direct load attempt
      loadedImg = await loadImageElement(urlOrPath);
    } catch (err) {
      // Fallback: Fetch via main process IPC to bypass CORS / hotlinking / local protocol issues
      try {
        const dataUrl = await window.api.fetchImageAsDataUrl(urlOrPath);
        if (dataUrl) {
          loadedImg = await loadImageElement(dataUrl);
        }
      } catch (fallbackErr) {
        console.error('All image loading strategies failed:', fallbackErr);
      }
    }

    if (spinner) spinner.style.display = 'none';

    if (loadedImg) {
      this.cropState.image = loadedImg;
      this.cropState.sourceUrl = urlOrPath;
      this.cropState.zoom = 1.0;

      const zoomSlider = document.getElementById('cropZoomSlider');
      const zoomVal = document.getElementById('cropZoomVal');
      if (zoomSlider) zoomSlider.value = 1.0;
      if (zoomVal) zoomVal.textContent = '100%';

      this.setDefaultCropPan();
      this.renderCropCanvas();

      if (dimText) {
        const aspect = (loadedImg.width / loadedImg.height).toFixed(2);
        const aspectDesc = Math.abs(loadedImg.width - loadedImg.height) <= 4 ? '1:1 Square' : `${loadedImg.width}:${loadedImg.height}`;
        dimText.textContent = `Source: ${loadedImg.width} \u00d7 ${loadedImg.height} (${aspectDesc}) \u2192 1024 \u00d7 1024 Lossless PNG`;
      }
    } else {
      window.showToast('Preview Error', 'Could not load image preview. Please try another image.', 'warning');
      if (dimText) dimText.textContent = 'Failed to load preview';
    }
  },

  filterAndRenderMatches() {
    const listEl = document.getElementById('overrideMatchesList');
    if (!listEl) return;
    listEl.innerHTML = '';

    let filtered = this.rawMatches || [];
    if (this.currentSourceFilter === 'steam') {
      filtered = filtered.filter(m => (m.source || 'SteamStore') !== 'SteamGridDB');
    } else if (this.currentSourceFilter === 'sgdb') {
      filtered = filtered.filter(m => m.source === 'SteamGridDB');
    }

    if (filtered.length === 0) {
      listEl.innerHTML = '<div style="padding: 14px; color: var(--text-muted); font-size: 12px; text-align: center;">No matches found. Try another query or filter.</div>';
      return;
    }

    filtered.slice(0, 20).forEach(match => {
      const item = document.createElement('div');
      item.className = 'match-item';
      item.tabIndex = 0;

      const isSgdb = match.source === 'SteamGridDB';
      const isSquare = match.badge && match.badge.includes('1:1');

      let badgeClass = 'steam';
      if (isSquare) badgeClass = 'square';
      else if (isSgdb) badgeClass = 'sgdb';

      const badgeText = match.badge || (isSgdb ? 'SteamGridDB' : 'Steam Store');
      const simPercent = Math.round((match.similarity || 0.95) * 100);

      item.innerHTML = `
        <img class="match-thumb" src="${match.tinyImage || match.fallbackUrl || match.previewUrl}" onerror="this.style.display='none'">
        <div class="match-info">
          <div class="match-title">${match.name}</div>
          <div class="match-badges-row">
            <span class="match-source-badge ${badgeClass}">${badgeText}</span>
            <span style="font-size: 11px; color: var(--text-muted);">${match.appId || ''}</span>
          </div>
        </div>
        <div class="match-score">${simPercent}% Match</div>
      `;

      item.addEventListener('click', () => {
        document.querySelectorAll('.match-item').forEach(m => m.classList.remove('selected'));
        item.classList.add('selected');
        this.loadArtworkIntoStudio(match.previewUrl || match.fallbackUrl);
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
    const fseDefaultCheck = document.getElementById('settingFseDefault');

    const openVaultBtn = document.getElementById('btnOpenVaultFolder');
    const restartXboxBtn = document.getElementById('btnRestartXboxApp');
    const btnBack = document.getElementById('btnBackToLibrary');
    const btnSaveTop = document.getElementById('btnSaveSettingsTop');
    const saveAndClose = async () => {
      const updated = {
        autoRestore: autoRestoreCheck ? autoRestoreCheck.checked : true,
        taskSchedulerEnabled: schedulerCheck ? schedulerCheck.checked : true,
        watchEnabled: watcherCheck ? watcherCheck.checked : true,
        closeToTray: closeToTrayCheck ? closeToTrayCheck.checked : true,
        fseDefault: fseDefaultCheck ? fseDefaultCheck.checked : false
      };

      await window.api.setConfig(updated);

      // Only update scheduler during save if the toggle was altered and unhandled; never request UAC on save/close
      if (this._initialSchedulerEnabled !== undefined && updated.taskSchedulerEnabled !== this._initialSchedulerEnabled) {
        await window.api.setSchedulerEnabled(updated.taskSchedulerEnabled, false);
        this._initialSchedulerEnabled = updated.taskSchedulerEnabled;
      }

      if (window.updateShieldBadge) window.updateShieldBadge(updated.autoRestore);

      window.showToast('Settings Saved', 'Configuration updated successfully.', 'success');
      this.closeSettingsPage();
    };

    // User explicitly toggling the Task Scheduler checkbox directly
    if (schedulerCheck) {
      schedulerCheck.addEventListener('change', async () => {
        const isEnabled = schedulerCheck.checked;
        window.showToast('Task Scheduler', isEnabled ? 'Registering scheduled task...' : 'Removing scheduled task...', 'info');
        // When user explicitly clicks toggle ON, allow elevation so they can approve Event triggers if prompted
        const res = await window.api.setSchedulerEnabled(isEnabled, isEnabled);
        this._initialSchedulerEnabled = isEnabled;
        if (isEnabled) {
          if (res && res.success) {
            window.showToast('Task Scheduler Enabled', 'Registered "Xbox Grid Sync - Automated Artwork Update Shield".', 'success');
          } else {
            window.showToast('Notice', res?.error || 'Scheduled task active.', 'info');
          }
        } else {
          window.showToast('Task Scheduler Disabled', 'Removed background task from Task Scheduler.', 'info');
        }
        await this.refreshSchedulerBadge();
      });
    }

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
        window.showToast('Testing Trigger', 'Executing background silent restore via Task Scheduler...', 'info');
        try {
          const res = await window.api.testSchedulerTrigger();
          if (res.success) {
            window.showToast('Trigger Verified!', res.message || 'Task executed silently. Background shield is active.', 'success');
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
        window.showToast('Task Scheduler Opened', 'Opened taskschd.msc. Look for "Xbox Grid Sync - Automated Artwork Update Shield" in Task Scheduler Library.', 'info');
      });
    }

    // Clear Xbox App Thumbnails
    const clearXboxCacheBtn = document.getElementById('btnClearXboxCache');
    if (clearXboxCacheBtn) {
      clearXboxCacheBtn.addEventListener('click', async () => {
        if (!confirm('Clear all injected artwork from the Xbox App cache?\n\nYour Vault backups will be preserved and can be re-injected with "Sync All Artwork".')) return;
        try {
          const res = await window.api.clearXboxCache();
          window.showToast('Xbox Cache Cleared', `Removed ${res.removedFiles} injected thumbnail files from Xbox App.`, 'success');
        } catch (err) {
          window.showToast('Error', err.message, 'error');
        }
      });
    }

    // Full Factory Reset
    const fullResetBtn = document.getElementById('btnFullReset');
    if (fullResetBtn) {
      fullResetBtn.addEventListener('click', async () => {
        if (!confirm('⚠ FULL FACTORY RESET ⚠\n\nThis will permanently delete:\n• All saved artwork in the Vault\n• All local resolution cache\n• All injected Xbox App thumbnails\n\nThis cannot be undone. Continue?')) return;
        if (!confirm('Are you absolutely sure? All artwork data will be lost.')) return;
        try {
          const res = await window.api.clearAllData();
          window.showToast('Factory Reset Complete', `Removed ${res.removedCovers} vault entries and restored original artwork in Xbox App.`, 'success');

          // Reset UI in-memory state immediately
          if (window.state) {
            window.state.games = [];
            if (window.updateCounts) window.updateCounts();
            if (window.renderGames) window.renderGames();
          }

          // Return to main library page
          this.closeSettingsPage();
          if (window.ControllerNav && window.ControllerNav.focusDefaultElement) {
            window.ControllerNav.focusDefaultElement();
          }

          // Rescan cleanly
          if (window.rescanLibrary) await window.rescanLibrary();
        } catch (err) {
          window.showToast('Error', err.message, 'error');
        }
      });
    }

    const donateSettingsBtn = document.getElementById('btnSettingsDonate');
    if (donateSettingsBtn) {
      donateSettingsBtn.addEventListener('click', () => {
        window.api.openExternal('https://buymeacoffee.com/enufstyle');
      });
    }

    const openTutorialBtn = document.getElementById('btnOpenTutorial');
    if (openTutorialBtn) {
      openTutorialBtn.addEventListener('click', () => {
        this.openTutorialModal();
      });
    }
  },

  // 4. Quick Start Tutorial Modal Engine
  setupTutorialModal() {
    const modal = document.getElementById('tutorialModal');
    const closeBtn = document.getElementById('btnCloseTutorialModal');
    const getStartedBtn = document.getElementById('btnGetStartedTutorial');
    const dontShowCheck = document.getElementById('chkDontShowTutorialAgain');

    const handleDismiss = async () => {
      this.closeTutorialModal();
      if (dontShowCheck && dontShowCheck.checked) {
        try {
          await window.api.setConfig({ hasSeenTutorial: true });
        } catch (e) {}
      }
    };

    if (closeBtn) closeBtn.addEventListener('click', handleDismiss);
    if (getStartedBtn) getStartedBtn.addEventListener('click', handleDismiss);

    if (modal) {
      modal.addEventListener('click', (e) => {
        if (e.target === modal) {
          handleDismiss();
        }
      });
    }
  },

  openTutorialModal() {
    const modal = document.getElementById('tutorialModal');
    if (modal) {
      modal.style.display = 'flex';
      // Force layout reflow before adding .open for fluent acrylic fade-in
      modal.offsetHeight;
      modal.classList.add('open');
      const sheet = modal.querySelector('.modal-sheet');
      if (sheet) {
        sheet.style.transform = '';
        sheet.style.opacity = '';
        sheet.style.transition = '';
      }
      if (window.ControllerNav) {
        setTimeout(() => {
          if (window.ControllerNav && window.ControllerNav.focusDefaultElement) {
            window.ControllerNav.focusDefaultElement();
          }
        }, 60);
      }
    }
  },

  closeTutorialModal() {
    const modal = document.getElementById('tutorialModal');
    if (modal) {
      modal.classList.remove('open');
      setTimeout(() => {
        if (!modal.classList.contains('open')) {
          modal.style.display = 'none';
        }
      }, 220);
      if (window.ControllerNav) {
        setTimeout(() => {
          if (window.ControllerNav && window.ControllerNav.focusDefaultElement) {
            window.ControllerNav.focusDefaultElement();
          }
        }, 60);
      }
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

    const fseDefaultCheck = document.getElementById('settingFseDefault');
    const fseDesc = document.getElementById('settingFseDesc');
    let isHandheld = false;
    try {
      if (window.api && window.api.isHandheld) {
        isHandheld = await window.api.isHandheld();
      }
    } catch (e) {}

    if (fseDesc) {
      if (isHandheld) {
        fseDesc.innerHTML = 'Automatically start in Exclusive Fullscreen (<strong>🎮 Handheld Gaming PC Detected!</strong>)';
      } else {
        fseDesc.textContent = 'Automatically start in Exclusive Fullscreen (ideal for ROG Ally & gaming handhelds)';
      }
    }

    if (fseDefaultCheck) {
      fseDefaultCheck.checked = config.fseDefault !== undefined ? !!config.fseDefault : isHandheld;
    }

    this._initialSchedulerEnabled = scheduler.registered;

    await this.refreshSchedulerBadge();

    // Switch to Settings full-app view
    const libView = document.getElementById('libraryView');
    const setView = document.getElementById('settingsView');
    if (libView) libView.style.display = 'none';
    if (setView) setView.style.display = 'flex';
  },

  async refreshSchedulerBadge() {
    const scheduler = await window.api.getSchedulerStatus();
    const liveBadge = document.getElementById('schedulerLiveStatusBadge');
    if (liveBadge) {
      if (scheduler.registered) {
        liveBadge.innerHTML = '<span class="pulse-dot"></span> Active in Windows';
        liveBadge.style.display = 'inline-flex';
      } else {
        liveBadge.innerHTML = '<span style="width:6px;height:6px;border-radius:50%;background:#888;"></span> Not Registered';
        liveBadge.style.display = 'inline-flex';
      }
    }
  },

  closeSettingsPage() {
    const libView = document.getElementById('libraryView');
    const setView = document.getElementById('settingsView');
    if (setView) setView.style.display = 'none';
    if (libView) libView.style.display = 'flex';
  },

  // Aliases for backward compatibility
  openSettingsModal() {
    this.openSettingsPage();
  },

  closeSettingsModal() {
    this.closeSettingsPage();
  },

  setupSettingsModal() {
    this.setupSettingsPage();
  }
};
