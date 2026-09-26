/**
 * Xbox Grid Sync - Handheld & Windows Controller Navigation Engine
 * Provides native gamepad navigation, spatial focus, faint glows, cursor hiding,
 * and context-sensitive HUD button hints for Windows 11, Flydigi Vader, Xbox controllers,
 * and handheld gaming PCs (ROG Ally, Legion Go, Claw, etc.).
 */

class ControllerNavigationManager {
  constructor() {
    this.isControllerMode = false;
    this.currentFocusedElement = null;
    this.initialRepeatDelay = 250; // ms before repeating direction
    this.repeatInterval = 130; // ms between continuous steps
    this.directionHoldStart = 0;
    this.lastDirectionTime = 0;
    this.activeDirection = null; // 'UP', 'DOWN', 'LEFT', 'RIGHT'

    // Multi-gamepad button state tracking (slot index -> boolean array)
    this.prevButtonsMap = new Map();

    // Mouse tracking to detect intentional mouse moves vs gyro/accidental jitter
    this.lastMouseX = -1;
    this.lastMouseY = -1;

    this.hudElement = null;

    this.init();
  }

  init() {
    this.createHudOverlay();
    this.setupMouseListeners();
    this.setupGamepadListeners();
    this.startPollingLoop();

    // Automatically enter controller mode if launched in FSE mode or if gamepads are connected
    setTimeout(() => {
      try {
        const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
        const hasConnected = Array.from(gamepads).some(g => g && g.connected);
        if (document.body.classList.contains('fse-mode') || hasConnected) {
          this.enterControllerMode();
        }
      } catch (e) {}
    }, 350);
  }

  createHudOverlay() {
    let hud = document.getElementById('controllerHudOverlay');
    if (!hud) {
      hud = document.createElement('div');
      hud.id = 'controllerHudOverlay';
      hud.className = 'controller-hud-overlay';
      document.body.appendChild(hud);
    }
    this.hudElement = hud;
    this.updateHudHints();
  }

  setupGamepadListeners() {
    window.addEventListener('gamepadconnected', (e) => {
      console.log(`[Gamepad] Connected at slot ${e.gamepad.index}: ${e.gamepad.id} (${e.gamepad.mapping || 'raw'})`);
      this.enterControllerMode();
      this.updateHudHints();
    });

    window.addEventListener('gamepaddisconnected', (e) => {
      console.log(`[Gamepad] Disconnected from slot ${e.gamepad.index}: ${e.gamepad.id}`);
      this.prevButtonsMap.delete(e.gamepad.index);
      this.updateHudHints();
    });
  }

  setupMouseListeners() {
    window.addEventListener('mousemove', (e) => {
      if (this.lastMouseX === -1) {
        this.lastMouseX = e.clientX;
        this.lastMouseY = e.clientY;
        return;
      }

      const dx = Math.abs(e.clientX - this.lastMouseX);
      const dy = Math.abs(e.clientY - this.lastMouseY);

      // Require intentional mouse move (> 25px) before switching to mouse mode
      // This prevents controller gyros (Flydigi/DualSense) or table vibrations from cancelling controller mode
      if (dx > 25 || dy > 25) {
        this.lastMouseX = e.clientX;
        this.lastMouseY = e.clientY;
        if (this.isControllerMode) {
          this.exitControllerMode();
        }
      }
    });

    window.addEventListener('mousedown', () => {
      if (this.isControllerMode) {
        this.exitControllerMode();
      }
    });
  }

  enterControllerMode() {
    if (this.isControllerMode) return;
    this.isControllerMode = true;
    document.body.classList.add('controller-mode');

    // Ensure we have a focused element
    if (!this.currentFocusedElement || !document.body.contains(this.currentFocusedElement) || !this.isElementVisible(this.currentFocusedElement)) {
      this.focusDefaultElement();
    } else {
      this.setFocus(this.currentFocusedElement);
    }

    this.updateHudHints();
  }

  exitControllerMode() {
    if (!this.isControllerMode) return;
    this.isControllerMode = false;
    document.body.classList.remove('controller-mode');

    if (this.currentFocusedElement) {
      this.currentFocusedElement.classList.remove('controller-focused');
    }
  }

  startPollingLoop() {
    const poll = () => {
      this.pollGamepads();
      requestAnimationFrame(poll);
    };
    requestAnimationFrame(poll);
  }

  pollGamepads() {
    if (!navigator.getGamepads) return;
    const gamepads = navigator.getGamepads();
    if (!gamepads) return;

    const now = performance.now();
    let anyActiveDirection = null;

    // Check ALL connected gamepads (Flydigi Vader creates virtual controller at index 0, physical controller at index 1+)
    for (let i = 0; i < gamepads.length; i++) {
      const gp = gamepads[i];
      if (!gp || !gp.connected) continue;

      const dir = this.processGamepadInput(gp, i, now);
      if (dir) anyActiveDirection = dir;
    }

    // Directional navigation repeat handling across active controller
    if (anyActiveDirection !== null) {
      if (this.activeDirection !== anyActiveDirection) {
        this.activeDirection = anyActiveDirection;
        this.directionHoldStart = now;
        this.lastDirectionTime = now;
        this.navigateDirection(anyActiveDirection);
      } else {
        const holdTime = now - this.directionHoldStart;
        if (holdTime > this.initialRepeatDelay) {
          if (now - this.lastDirectionTime > this.repeatInterval) {
            this.lastDirectionTime = now;
            this.navigateDirection(anyActiveDirection);
          }
        }
      }
    } else {
      this.activeDirection = null;
    }
  }

  processGamepadInput(gp, slotIndex, now) {
    // 1. Stick & D-Pad directional input
    const stickX = (gp.axes && gp.axes.length > 0) ? gp.axes[0] : 0;
    const stickY = (gp.axes && gp.axes.length > 1) ? gp.axes[1] : 0;

    let dpadUp = gp.buttons[12] && (gp.buttons[12].pressed || gp.buttons[12].value > 0.5);
    let dpadDown = gp.buttons[13] && (gp.buttons[13].pressed || gp.buttons[13].value > 0.5);
    let dpadLeft = gp.buttons[14] && (gp.buttons[14].pressed || gp.buttons[14].value > 0.5);
    let dpadRight = gp.buttons[15] && (gp.buttons[15].pressed || gp.buttons[15].value > 0.5);

    // Support DirectInput POV hat switch or secondary axes if D-pad buttons are not mapped to 12-15
    if (!dpadUp && !dpadDown && !dpadLeft && !dpadRight && gp.axes && gp.axes.length > 4) {
      for (let ax = 4; ax < gp.axes.length; ax++) {
        const val = gp.axes[ax];
        if (Math.abs(val) > 0.45) {
          if (ax % 2 === 0) {
            if (val < -0.45) dpadLeft = true;
            else if (val > 0.45) dpadRight = true;
          } else {
            if (val < -0.45) dpadUp = true;
            else if (val > 0.45) dpadDown = true;
          }
        }
      }
    }

    let dir = null;
    const deadzone = 0.35;

    if (dpadUp || stickY < -deadzone) dir = 'UP';
    else if (dpadDown || stickY > deadzone) dir = 'DOWN';
    else if (dpadLeft || stickX < -deadzone) dir = 'LEFT';
    else if (dpadRight || stickX > deadzone) dir = 'RIGHT';

    // 2. Check if any button or stick is deflected to activate controller mode
    let anyButtonPressed = false;
    for (let b = 0; b < gp.buttons.length; b++) {
      if (gp.buttons[b] && (gp.buttons[b].pressed || gp.buttons[b].value > 0.5)) {
        anyButtonPressed = true;
        break;
      }
    }

    if (dir !== null || anyButtonPressed) {
      if (!this.isControllerMode) {
        this.enterControllerMode();
      }
    }

    // 3. Process button presses (fresh down trigger per slot)
    const prevButtons = this.prevButtonsMap.get(slotIndex) || [];
    const isNewPress = (btnIndex) => {
      const isPressed = gp.buttons[btnIndex] && (gp.buttons[btnIndex].pressed || gp.buttons[btnIndex].value > 0.5);
      const wasPressed = prevButtons[btnIndex];
      return isPressed && !wasPressed;
    };

    // Button A (0): Select / Confirm / Edit
    if (isNewPress(0)) this.handleButtonA();

    // Button B (1): Back / Cancel / Close
    if (isNewPress(1)) this.handleButtonB();

    // Button X (2): Quick Sync
    if (isNewPress(2)) this.handleButtonX();

    // Button Y (3): Change Cover / Details / Search
    if (isNewPress(3)) this.handleButtonY();

    // LB (4): Tab Left
    if (isNewPress(4)) this.cycleFilterTab(-1);

    // RB (5): Tab Right
    if (isNewPress(5)) this.cycleFilterTab(1);

    // View / Back (8): Toggle Tutorial
    if (isNewPress(8)) this.toggleTutorial();

    // Menu / Start (9) or Guide (16): Toggle Settings
    if (isNewPress(9) || isNewPress(16)) this.toggleSettings();

    // Store button states for this gamepad
    this.prevButtonsMap.set(slotIndex, gp.buttons.map(b => b ? (b.pressed || b.value > 0.5) : false));

    return dir;
  }

  // Find all focusable elements in current active scope
  getFocusableElements() {
    // 1. If any acrylic modal backdrop is open, constrain focus strictly to that modal
    const openModals = Array.from(document.querySelectorAll('.modal-backdrop')).filter(m => {
      return m.classList.contains('open') || m.style.display === 'flex';
    });

    if (openModals.length > 0) {
      const topModal = openModals[openModals.length - 1];
      const modalSelector = [
        'button:not([disabled])',
        'input:not([disabled])',
        'select:not([disabled])',
        '.clickable',
        '.protection-option-card',
        '.tutorial-step-card'
      ].join(',');
      return Array.from(topModal.querySelectorAll(modalSelector)).filter(el => this.isElementVisible(el));
    }

    const titlebar = document.getElementById('appTitlebar');
    const overrideView = document.getElementById('overrideView');
    const settingsView = document.getElementById('settingsView');
    const libraryView = document.getElementById('libraryView');

    const focusables = [];

    // Titlebar items (available across all views: PC/FSE toggle, Buy Me a Coffee)
    if (titlebar) {
      const titlebarBtns = Array.from(titlebar.querySelectorAll('#btnToggleFse, #btnTitlebarDonate')).filter(el => this.isElementVisible(el));
      focusables.push(...titlebarBtns);
    }

    // 2. Artwork Override / Studio View
    if (overrideView && overrideView.style.display !== 'none' && overrideView.style.display !== '') {
      const studioSelector = [
        '#btnBackFromOverride',
        '#btnCancelOverridePage',
        '#btnApplyOverridePage',
        '#btnZoomOut',
        '#cropZoomSlider',
        '#btnZoomIn',
        '#btnAlignTop',
        '#btnAlignCenter',
        '#btnAlignBottom',
        '#btnFitBest',
        '#btnResetCrop',
        '#btnToggleGrid',
        '.btn-source-filter',
        '#overrideSearchInput',
        '#btnSearchAlternatives',
        '.match-item', // Artwork search results selectable via controller
        '#btnBrowseLocalCover',
        '#overrideUrlInput',
        '#btnLoadUrl'
      ].join(',');
      const studioElements = Array.from(overrideView.querySelectorAll(studioSelector)).filter(el => this.isElementVisible(el));
      focusables.push(...studioElements);
      return focusables;
    }

    // 3. Settings View
    if (settingsView && settingsView.style.display !== 'none' && settingsView.style.display !== '') {
      const settingsSelector = [
        '#btnBackToLibrary',
        '#btnSaveSettingsTop',
        '.switch input',
        '#btnOpenVaultFolder',
        '#btnRestartXboxApp',
        '#btnTestScheduler',
        '#btnOpenTaskSchedulerGui',
        '#btnClearXboxCache',
        '#btnFullReset',
        '#btnSettingsDonate',
        '#btnOpenTutorial'
      ].join(',');
      const settingsElements = Array.from(settingsView.querySelectorAll(settingsSelector)).filter(el => this.isElementVisible(el));
      focusables.push(...settingsElements);
      return focusables;
    }

    // 4. Game Library View
    if (libraryView && libraryView.style.display !== 'none') {
      // Header actions & filters
      const libraryControls = [
        '#btnSyncAll',
        '#btnRescan',
        '#btnRestoreVault',
        '#btnSettings',
        '.filter-pill',
        '#searchGamesInput',
        '#emptyState button'
      ].join(',');
      const controls = Array.from(libraryView.querySelectorAll(libraryControls)).filter(el => this.isElementVisible(el));
      focusables.push(...controls);

      // Game cards only (EXCLUDE inner overlay buttons so left/right navigation stays cleanly on game cards)
      const cards = Array.from(libraryView.querySelectorAll('.game-card')).filter(el => this.isElementVisible(el));
      focusables.push(...cards);
      return focusables;
    }

    return focusables;
  }

  isElementVisible(el) {
    if (!el || !el.getBoundingClientRect) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  focusDefaultElement() {
    const focusables = this.getFocusableElements();
    if (focusables.length === 0) return;

    // Prefer first game card if in library
    const firstGame = focusables.find(el => el.classList.contains('game-card'));
    if (firstGame) {
      this.setFocus(firstGame);
      return;
    }

    // In settings/modal, prefer primary button or active option
    const primaryBtn = focusables.find(el => el.classList.contains('btn-primary'));
    if (primaryBtn) {
      this.setFocus(primaryBtn);
      return;
    }

    // In studio, prefer search input or first match item
    const matchItem = focusables.find(el => el.classList.contains('match-item'));
    if (matchItem) {
      this.setFocus(matchItem);
      return;
    }

    // Otherwise choose first visible item
    this.setFocus(focusables[0]);
  }

  setFocus(el) {
    if (!el) return;

    if (this.currentFocusedElement && this.currentFocusedElement !== el) {
      this.currentFocusedElement.classList.remove('controller-focused');
    }

    this.currentFocusedElement = el;
    el.classList.add('controller-focused');

    try {
      el.focus({ preventScroll: true });
    } catch (e) {}

    // Smooth scroll into visible viewport
    el.scrollIntoView({
      behavior: 'smooth',
      block: 'nearest',
      inline: 'nearest'
    });

    this.updateHudHints();
  }

  navigateDirection(dir) {
    const focusables = this.getFocusableElements();
    if (focusables.length === 0) return;

    if (!this.currentFocusedElement || !document.body.contains(this.currentFocusedElement) || !this.isElementVisible(this.currentFocusedElement)) {
      this.focusDefaultElement();
      return;
    }

    const currentRect = this.currentFocusedElement.getBoundingClientRect();
    const currentCenter = {
      x: currentRect.left + currentRect.width / 2,
      y: currentRect.top + currentRect.height / 2
    };

    let bestCandidate = null;
    let minScore = Infinity;

    for (const el of focusables) {
      if (el === this.currentFocusedElement) continue;

      const rect = el.getBoundingClientRect();
      const center = {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2
      };

      const dx = center.x - currentCenter.x;
      const dy = center.y - currentCenter.y;

      let isStrictlyInDirection = false;
      let primaryDist = 0;
      let orthogonalDist = 0;

      switch (dir) {
        case 'UP':
          if (center.y < currentCenter.y - 4) {
            isStrictlyInDirection = true;
            primaryDist = currentCenter.y - center.y;
            orthogonalDist = Math.abs(dx);
          }
          break;
        case 'DOWN':
          if (center.y > currentCenter.y + 4) {
            isStrictlyInDirection = true;
            primaryDist = center.y - currentCenter.y;
            orthogonalDist = Math.abs(dx);
          }
          break;
        case 'LEFT':
          if (center.x < currentCenter.x - 4) {
            isStrictlyInDirection = true;
            primaryDist = currentCenter.x - center.x;
            orthogonalDist = Math.abs(dy);
          }
          break;
        case 'RIGHT':
          if (center.x > currentCenter.x + 4) {
            isStrictlyInDirection = true;
            primaryDist = center.x - currentCenter.x;
            orthogonalDist = Math.abs(dy);
          }
          break;
      }

      if (isStrictlyInDirection) {
        // Orthogonal penalty keeps navigation strictly in steady rows and columns
        const score = primaryDist + (orthogonalDist * 1.8);
        if (score < minScore) {
          minScore = score;
          bestCandidate = el;
        }
      }
    }

    // Grid edge wrapping for horizontal navigation (like console dashboards)
    if (!bestCandidate) {
      if (dir === 'RIGHT') {
        // Find next row down, pick leftmost element
        let nextRowMinY = Infinity;
        for (const el of focusables) {
          const rect = el.getBoundingClientRect();
          const cy = rect.top + rect.height / 2;
          if (cy > currentCenter.y + 15 && cy < nextRowMinY) {
            nextRowMinY = cy;
          }
        }
        if (nextRowMinY !== Infinity) {
          let leftmostInNextRow = null;
          let minX = Infinity;
          for (const el of focusables) {
            const rect = el.getBoundingClientRect();
            const cy = rect.top + rect.height / 2;
            const cx = rect.left + rect.width / 2;
            if (Math.abs(cy - nextRowMinY) < 25 && cx < minX) {
              minX = cx;
              leftmostInNextRow = el;
            }
          }
          if (leftmostInNextRow) bestCandidate = leftmostInNextRow;
        }
      } else if (dir === 'LEFT') {
        // Find previous row up, pick rightmost element
        let prevRowMaxY = -Infinity;
        for (const el of focusables) {
          const rect = el.getBoundingClientRect();
          const cy = rect.top + rect.height / 2;
          if (cy < currentCenter.y - 15 && cy > prevRowMaxY) {
            prevRowMaxY = cy;
          }
        }
        if (prevRowMaxY !== -Infinity) {
          let rightmostInPrevRow = null;
          let maxX = -Infinity;
          for (const el of focusables) {
            const rect = el.getBoundingClientRect();
            const cy = rect.top + rect.height / 2;
            const cx = rect.left + rect.width / 2;
            if (Math.abs(cy - prevRowMaxY) < 25 && cx > maxX) {
              maxX = cx;
              rightmostInPrevRow = el;
            }
          }
          if (rightmostInPrevRow) bestCandidate = rightmostInPrevRow;
        }
      }
    }

    if (bestCandidate) {
      this.setFocus(bestCandidate);
    }
  }

  handleButtonA() {
    if (!this.currentFocusedElement) return;

    const el = this.currentFocusedElement;

    // Checkboxes / Toggles
    if (el.tagName === 'INPUT' && el.type === 'checkbox') {
      el.checked = !el.checked;
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return;
    }

    // Match item in search results: click it to select artwork
    if (el.classList.contains('match-item')) {
      el.click();
      this.updateHudHints();
      return;
    }

    // Game card: opens studio directly
    if (el.classList.contains('game-card')) {
      const editBtn = el.querySelector('.btn-override');
      if (editBtn) {
        editBtn.click();
      } else {
        el.click();
      }
      this.updateHudHints();
      return;
    }

    // Default: simulate click
    el.click();
    this.updateHudHints();
  }

  handleButtonB() {
    // 1. If tutorial modal is open, close it
    const tutorialModal = document.getElementById('tutorialModal');
    if (tutorialModal && (tutorialModal.classList.contains('open') || tutorialModal.style.display === 'flex')) {
      if (window.ModalManager && window.ModalManager.closeTutorialModal) {
        window.ModalManager.closeTutorialModal();
      } else {
        tutorialModal.classList.remove('open');
        tutorialModal.style.display = 'none';
      }
      this.focusDefaultElement();
      return;
    }

    // 2. If add custom game modal is open, close it
    const addGameModal = document.getElementById('addGameModal');
    if (addGameModal && (addGameModal.classList.contains('open') || addGameModal.style.display === 'flex')) {
      if (window.ModalManager && window.ModalManager.closeAddGameModal) {
        window.ModalManager.closeAddGameModal();
      } else {
        addGameModal.classList.remove('open');
      }
      this.focusDefaultElement();
      return;
    }

    // 3. If override/cover studio view is open, return to Library
    const overrideView = document.getElementById('overrideView');
    if (overrideView && overrideView.style.display !== 'none' && overrideView.style.display !== '') {
      if (window.ModalManager && window.ModalManager.closeOverridePage) {
        window.ModalManager.closeOverridePage();
      } else {
        const backBtn = document.getElementById('btnBackFromOverride') || document.getElementById('btnCancelOverridePage');
        if (backBtn) backBtn.click();
      }
      this.focusDefaultElement();
      return;
    }

    // 4. If in Settings view, return to Library view
    const settingsView = document.getElementById('settingsView');
    if (settingsView && settingsView.style.display !== 'none' && settingsView.style.display !== '') {
      const backBtn = document.getElementById('btnBackToLibrary');
      if (backBtn) backBtn.click();
      this.focusDefaultElement();
      return;
    }

    // 5. If focusing a game card down in the library, jump focus to the active filter pill
    if (this.currentFocusedElement && this.currentFocusedElement.classList.contains('game-card')) {
      const activeFilter = document.querySelector('.filter-pill.active') || document.querySelector('.filter-pill');
      if (activeFilter) {
        this.setFocus(activeFilter);
      }
    }
  }

  handleButtonX() {
    if (!this.currentFocusedElement) return;

    // If a game card is focused, execute Quick Sync for this specific game
    if (this.currentFocusedElement.classList.contains('game-card')) {
      const syncBtn = this.currentFocusedElement.querySelector('.btn-quick-sync');
      if (syncBtn) {
        syncBtn.click();
        if (window.showToast) {
          window.showToast('Syncing Artwork', 'Pushed artwork to Xbox App cache folder.', 'success');
        }
      }
      return;
    }

    // If on library view outside game card, trigger "Sync All Artwork"
    const syncAllBtn = document.getElementById('btnSyncAll');
    if (syncAllBtn && this.isElementVisible(syncAllBtn)) {
      syncAllBtn.click();
    }
  }

  handleButtonY() {
    if (!this.currentFocusedElement) return;

    // If in studio, focus overrideSearchInput
    const overrideSearch = document.getElementById('overrideSearchInput');
    const overrideView = document.getElementById('overrideView');
    if (overrideView && overrideView.style.display !== 'none' && overrideSearch && this.isElementVisible(overrideSearch)) {
      this.setFocus(overrideSearch);
      overrideSearch.focus();
      return;
    }

    // If game card, open studio dialog directly
    if (this.currentFocusedElement.classList.contains('game-card')) {
      const editBtn = this.currentFocusedElement.querySelector('.btn-override');
      if (editBtn) {
        editBtn.click();
      } else {
        this.currentFocusedElement.click();
      }
      return;
    }

    // Otherwise focus the Search Input
    const searchInput = document.getElementById('searchGamesInput');
    if (searchInput && this.isElementVisible(searchInput)) {
      this.setFocus(searchInput);
      searchInput.focus();
    }
  }

  cycleFilterTab(direction) {
    const filters = Array.from(document.querySelectorAll('.filter-pill'));
    if (filters.length === 0) return;

    let activeIndex = filters.findIndex(b => b.classList.contains('active'));
    if (activeIndex === -1) activeIndex = 0;

    let nextIndex = activeIndex + direction;
    if (nextIndex < 0) nextIndex = filters.length - 1;
    if (nextIndex >= filters.length) nextIndex = 0;

    filters[nextIndex].click();
    this.setFocus(filters[nextIndex]);
  }

  toggleTutorial() {
    const tutorialModal = document.getElementById('tutorialModal');
    if (tutorialModal && tutorialModal.classList.contains('open')) {
      if (window.ModalManager && window.ModalManager.closeTutorialModal) {
        window.ModalManager.closeTutorialModal();
      }
    } else {
      if (window.ModalManager && window.ModalManager.openTutorialModal) {
        window.ModalManager.openTutorialModal();
      }
    }
    this.updateHudHints();
  }

  toggleSettings() {
    const settingsView = document.getElementById('settingsView');
    if (settingsView && settingsView.style.display !== 'none' && settingsView.style.display !== '') {
      // Close settings
      const backBtn = document.getElementById('btnBackToLibrary');
      if (backBtn) backBtn.click();
    } else {
      // Open settings
      const settingsBtn = document.getElementById('btnSettings');
      if (settingsBtn) settingsBtn.click();
    }
    setTimeout(() => {
      this.focusDefaultElement();
    }, 100);
  }

  updateHudHints() {
    if (!this.hudElement) return;

    // Detect context
    const openModals = Array.from(document.querySelectorAll('.modal-backdrop')).filter(m => {
      return m.classList.contains('open') || m.style.display === 'flex';
    });

    const isModalOpen = openModals.length > 0;
    const overrideView = document.getElementById('overrideView');
    const isOverride = overrideView && overrideView.style.display !== 'none' && overrideView.style.display !== '';
    const settingsView = document.getElementById('settingsView');
    const isSettings = settingsView && settingsView.style.display !== 'none' && settingsView.style.display !== '';
    const isCardFocused = this.currentFocusedElement && this.currentFocusedElement.classList.contains('game-card');
    const isMatchFocused = this.currentFocusedElement && this.currentFocusedElement.classList.contains('match-item');
    const isFseBtnFocused = this.currentFocusedElement && this.currentFocusedElement.id === 'btnToggleFse';

    let hintsHtml = '';

    if (isModalOpen) {
      hintsHtml = `
        <div class="controller-hud-item"><span class="btn-badge btn-badge-a">A</span> Select</div>
        <div class="controller-hud-item"><span class="btn-badge btn-badge-b">B</span> Close</div>
      `;
    } else if (isMatchFocused) {
      hintsHtml = `
        <div class="controller-hud-item"><span class="btn-badge btn-badge-a">A</span> Use Cover</div>
        <div class="controller-hud-item"><span class="btn-badge btn-badge-y">Y</span> Search</div>
        <div class="controller-hud-item"><span class="btn-badge btn-badge-b">B</span> Back to Library</div>
      `;
    } else if (isOverride) {
      hintsHtml = `
        <div class="controller-hud-item"><span class="btn-badge btn-badge-a">A</span> Select / Crop</div>
        <div class="controller-hud-item"><span class="btn-badge btn-badge-y">Y</span> Search</div>
        <div class="controller-hud-item"><span class="btn-badge btn-badge-b">B</span> Back to Library</div>
      `;
    } else if (isSettings) {
      hintsHtml = `
        <div class="controller-hud-item"><span class="btn-badge btn-badge-a">A</span> Toggle / Select</div>
        <div class="controller-hud-item"><span class="btn-badge btn-badge-b">B</span> Back to Library</div>
      `;
    } else if (isFseBtnFocused) {
      hintsHtml = `
        <div class="controller-hud-item"><span class="btn-badge btn-badge-a">A</span> Toggle Desktop / FSE</div>
        <div class="controller-hud-item"><span class="btn-badge btn-badge-b">B</span> Back to Library</div>
      `;
    } else if (isCardFocused) {
      hintsHtml = `
        <div class="controller-hud-item"><span class="btn-badge btn-badge-a">A</span> Studio / Edit</div>
        <div class="controller-hud-item"><span class="btn-badge btn-badge-x">X</span> Sync Game</div>
        <div class="controller-hud-item"><span class="btn-badge btn-badge-b">B</span> Top Filter</div>
        <div class="controller-hud-item"><span class="btn-badge btn-badge-pill">LB/RB</span> Filter</div>
        <div class="controller-hud-item"><span class="btn-badge btn-badge-pill">Start</span> Settings</div>
        <div class="controller-hud-item"><span class="btn-badge btn-badge-pill">View</span> Guide</div>
      `;
    } else {
      hintsHtml = `
        <div class="controller-hud-item"><span class="btn-badge btn-badge-a">A</span> Select</div>
        <div class="controller-hud-item"><span class="btn-badge btn-badge-x">X</span> Sync All</div>
        <div class="controller-hud-item"><span class="btn-badge btn-badge-pill">LB/RB</span> Filter</div>
        <div class="controller-hud-item"><span class="btn-badge btn-badge-pill">Start</span> Settings</div>
        <div class="controller-hud-item"><span class="btn-badge btn-badge-pill">View</span> Guide</div>
      `;
    }

    this.hudElement.innerHTML = hintsHtml;
  }
}

// Instantiate and expose globally
window.ControllerNav = new ControllerNavigationManager();
