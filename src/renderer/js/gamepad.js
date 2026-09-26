/**
 * Xbox Grid Sync - Handheld & Windows Controller Navigation Engine
 * Provides native gamepad navigation, spatial focus, faint glows, cursor hiding,
 * and context-sensitive HUD button hints for Windows 11 & handheld gaming PCs (ROG Ally, Legion Go, etc.).
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

    // Button state tracking (to detect single press vs hold)
    this.prevButtons = [];

    // Mouse tracking to detect real mouse moves vs accidental jitter
    this.lastMouseX = -1;
    this.lastMouseY = -1;

    this.hudElement = null;

    this.init();
  }

  init() {
    this.createHudOverlay();
    this.setupMouseListeners();
    this.startPollingLoop();
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

  setupMouseListeners() {
    window.addEventListener('mousemove', (e) => {
      if (this.lastMouseX === -1) {
        this.lastMouseX = e.clientX;
        this.lastMouseY = e.clientY;
        return;
      }

      const dx = Math.abs(e.clientX - this.lastMouseX);
      const dy = Math.abs(e.clientY - this.lastMouseY);

      // Only switch to mouse mode if mouse actually moved intentionally (> 3px)
      if (dx > 3 || dy > 3) {
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
    let gp = null;
    for (let i = 0; i < gamepads.length; i++) {
      if (gamepads[i] && gamepads[i].connected) {
        gp = gamepads[i];
        break;
      }
    }

    if (!gp) return;

    const now = performance.now();

    // Check stick & D-pad directional input
    const stickX = gp.axes && gp.axes.length > 0 ? gp.axes[0] : 0;
    const stickY = gp.axes && gp.axes.length > 1 ? gp.axes[1] : 0;

    const dpadUp = gp.buttons[12] && gp.buttons[12].pressed;
    const dpadDown = gp.buttons[13] && gp.buttons[13].pressed;
    const dpadLeft = gp.buttons[14] && gp.buttons[14].pressed;
    const dpadRight = gp.buttons[15] && gp.buttons[15].pressed;

    let dir = null;
    const deadzone = 0.45;

    if (dpadUp || stickY < -deadzone) dir = 'UP';
    else if (dpadDown || stickY > deadzone) dir = 'DOWN';
    else if (dpadLeft || stickX < -deadzone) dir = 'LEFT';
    else if (dpadRight || stickX > deadzone) dir = 'RIGHT';

    // Check if any button or stick is pressed to activate controller mode
    let anyButtonPressed = false;
    for (let b = 0; b < gp.buttons.length; b++) {
      if (gp.buttons[b] && gp.buttons[b].pressed) {
        anyButtonPressed = true;
        break;
      }
    }

    if (dir !== null || anyButtonPressed) {
      if (!this.isControllerMode) {
        this.enterControllerMode();
      }
    }

    // Directional navigation repeat handling
    if (dir !== null) {
      if (this.activeDirection !== dir) {
        this.activeDirection = dir;
        this.directionHoldStart = now;
        this.lastDirectionTime = now;
        this.navigateDirection(dir);
      } else {
        const holdTime = now - this.directionHoldStart;
        if (holdTime > this.initialRepeatDelay) {
          if (now - this.lastDirectionTime > this.repeatInterval) {
            this.lastDirectionTime = now;
            this.navigateDirection(dir);
          }
        }
      }
    } else {
      this.activeDirection = null;
    }

    // Process button presses (trigger on fresh down)
    const isNewPress = (btnIndex) => {
      const isPressed = gp.buttons[btnIndex] && gp.buttons[btnIndex].pressed;
      const wasPressed = this.prevButtons[btnIndex];
      return isPressed && !wasPressed;
    };

    // Button A (0): Select / Click
    if (isNewPress(0)) {
      this.handleButtonA();
    }

    // Button B (1): Back / Cancel / Close
    if (isNewPress(1)) {
      this.handleButtonB();
    }

    // Button X (2): Quick Sync
    if (isNewPress(2)) {
      this.handleButtonX();
    }

    // Button Y (3): Change Cover / Details
    if (isNewPress(3)) {
      this.handleButtonY();
    }

    // LB (4): Tab Left
    if (isNewPress(4)) {
      this.cycleFilterTab(-1);
    }

    // RB (5): Tab Right
    if (isNewPress(5)) {
      this.cycleFilterTab(1);
    }

    // View / Back (8): Open Tutorial / Guide
    if (isNewPress(8)) {
      if (window.ModalManager && window.ModalManager.openTutorialModal) {
        window.ModalManager.openTutorialModal();
        this.updateHudHints();
      }
    }

    // Menu / Start (9): Toggle Settings
    if (isNewPress(9)) {
      this.toggleSettings();
    }

    // Store button states for next frame
    this.prevButtons = gp.buttons.map(b => b ? b.pressed : false);
  }

  // Find all focusable elements in current active scope
  getFocusableElements() {
    let container = document.body;

    // Check if any modal is open
    const openModals = Array.from(document.querySelectorAll('.modal')).filter(m => {
      return m.classList.contains('open') || m.style.display === 'flex' || m.style.display === 'block';
    });

    if (openModals.length > 0) {
      container = openModals[openModals.length - 1]; // Topmost open modal
    } else {
      const settingsView = document.getElementById('settingsView');
      if (settingsView && settingsView.style.display !== 'none' && settingsView.style.display !== '') {
        container = settingsView;
      } else {
        const libraryView = document.getElementById('libraryView');
        if (libraryView && libraryView.style.display !== 'none') {
          container = libraryView;
        }
      }
    }

    // Selector for interactive elements
    const selector = [
      '.game-card',
      'button:not([disabled])',
      'input:not([disabled])',
      'select:not([disabled])',
      '.filter-btn',
      '.switch input',
      '.clickable',
      '.cover-option'
    ].join(',');

    const elements = Array.from(container.querySelectorAll(selector)).filter(el => {
      return this.isElementVisible(el);
    });

    return elements;
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

      // Check if candidate is strictly in the requested direction
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
        // Weighted distance score: heavily penalize orthogonal drift to keep rows/columns stable
        const score = primaryDist + (orthogonalDist * 2.4);
        if (score < minScore) {
          minScore = score;
          bestCandidate = el;
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

    // If focusing a checkbox / toggle slider, trigger its click
    if (el.tagName === 'INPUT' && el.type === 'checkbox') {
      el.checked = !el.checked;
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return;
    }

    // If game card, open cover picker or click
    if (el.classList.contains('game-card')) {
      const artBtn = el.querySelector('.btn-change-art') || el.querySelector('.card-cover-container');
      if (artBtn) {
        artBtn.click();
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
    // 1. If tutorial modal open, close it
    const tutorialModal = document.getElementById('tutorialModal');
    if (tutorialModal && tutorialModal.style.display === 'flex') {
      if (window.ModalManager && window.ModalManager.closeTutorialModal) {
        window.ModalManager.closeTutorialModal();
      } else {
        tutorialModal.style.display = 'none';
      }
      this.focusDefaultElement();
      return;
    }

    // 2. If cover picker modal open, close it
    const coverModal = document.getElementById('coverModal');
    if (coverModal && coverModal.classList.contains('open')) {
      const closeBtn = coverModal.querySelector('.modal-close-btn') || document.getElementById('btnCloseCoverModal');
      if (closeBtn) closeBtn.click();
      this.focusDefaultElement();
      return;
    }

    // 3. If add custom game modal open, close it
    const addGameModal = document.getElementById('addGameModal');
    if (addGameModal && addGameModal.classList.contains('open')) {
      const closeBtn = addGameModal.querySelector('.modal-close-btn');
      if (closeBtn) closeBtn.click();
      this.focusDefaultElement();
      return;
    }

    // 4. If in Settings view, go back to Library view
    const settingsView = document.getElementById('settingsView');
    if (settingsView && settingsView.style.display !== 'none' && settingsView.style.display !== '') {
      const backBtn = document.getElementById('btnBackToLibrary');
      if (backBtn) backBtn.click();
      this.focusDefaultElement();
      return;
    }

    // 5. If focusing a game card down in the library, jump to top filter/action bar
    if (this.currentFocusedElement && this.currentFocusedElement.classList.contains('game-card')) {
      const firstFilter = document.querySelector('.filter-btn.active') || document.querySelector('.filter-btn');
      if (firstFilter) {
        this.setFocus(firstFilter);
      }
    }
  }

  handleButtonX() {
    if (!this.currentFocusedElement) return;

    // If a game card is focused, execute Sync for this specific game
    if (this.currentFocusedElement.classList.contains('game-card')) {
      const syncBtn = this.currentFocusedElement.querySelector('.btn-sync');
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

    // If game card, open cover picker dialog directly
    if (this.currentFocusedElement.classList.contains('game-card')) {
      const changeArtBtn = this.currentFocusedElement.querySelector('.btn-change-art');
      if (changeArtBtn) {
        changeArtBtn.click();
      }
      return;
    }

    // Otherwise focus the Search Input
    const searchInput = document.getElementById('searchInput');
    if (searchInput && this.isElementVisible(searchInput)) {
      this.setFocus(searchInput);
    }
  }

  cycleFilterTab(direction) {
    const filters = Array.from(document.querySelectorAll('.filter-btn'));
    if (filters.length === 0) return;

    let activeIndex = filters.findIndex(b => b.classList.contains('active'));
    if (activeIndex === -1) activeIndex = 0;

    let nextIndex = activeIndex + direction;
    if (nextIndex < 0) nextIndex = filters.length - 1;
    if (nextIndex >= filters.length) nextIndex = 0;

    filters[nextIndex].click();
    this.setFocus(filters[nextIndex]);
  }

  toggleSettings() {
    const settingsView = document.getElementById('settingsView');
    if (settingsView && settingsView.style.display !== 'none' && settingsView.style.display !== '') {
      // Close settings
      const backBtn = document.getElementById('btnBackToLibrary');
      if (backBtn) backBtn.click();
    } else {
      // Open settings
      const settingsBtn = document.getElementById('btnOpenSettings');
      if (settingsBtn) settingsBtn.click();
    }
    setTimeout(() => {
      this.focusDefaultElement();
    }, 100);
  }

  updateHudHints() {
    if (!this.hudElement) return;

    // Detect context
    const openModals = Array.from(document.querySelectorAll('.modal')).filter(m => {
      return m.classList.contains('open') || m.style.display === 'flex' || m.style.display === 'block';
    });

    const isModalOpen = openModals.length > 0;
    const settingsView = document.getElementById('settingsView');
    const isSettings = settingsView && settingsView.style.display !== 'none' && settingsView.style.display !== '';
    const isCardFocused = this.currentFocusedElement && this.currentFocusedElement.classList.contains('game-card');

    let hintsHtml = '';

    if (isModalOpen) {
      hintsHtml = `
        <div class="controller-hud-item"><span class="btn-badge btn-badge-a">A</span> Select</div>
        <div class="controller-hud-item"><span class="btn-badge btn-badge-b">B</span> Close</div>
      `;
    } else if (isSettings) {
      hintsHtml = `
        <div class="controller-hud-item"><span class="btn-badge btn-badge-a">A</span> Toggle / Select</div>
        <div class="controller-hud-item"><span class="btn-badge btn-badge-b">B</span> Back to Library</div>
      `;
    } else if (isCardFocused) {
      hintsHtml = `
        <div class="controller-hud-item"><span class="btn-badge btn-badge-a">A</span> Change Cover</div>
        <div class="controller-hud-item"><span class="btn-badge btn-badge-x">X</span> Sync Game</div>
        <div class="controller-hud-item"><span class="btn-badge btn-badge-b">B</span> Top</div>
        <div class="controller-hud-item"><span class="btn-badge btn-badge-pill">LB/RB</span> Filter</div>
        <div class="controller-hud-item"><span class="btn-badge btn-badge-pill">Start</span> Settings</div>
      `;
    } else {
      hintsHtml = `
        <div class="controller-hud-item"><span class="btn-badge btn-badge-a">A</span> Select</div>
        <div class="controller-hud-item"><span class="btn-badge btn-badge-x">X</span> Sync All</div>
        <div class="controller-hud-item"><span class="btn-badge btn-badge-pill">LB/RB</span> Filter</div>
        <div class="controller-hud-item"><span class="btn-badge btn-badge-pill">Start</span> Settings</div>
      `;
    }

    this.hudElement.innerHTML = hintsHtml;
  }
}

// Instantiate and expose globally
window.ControllerNav = new ControllerNavigationManager();
