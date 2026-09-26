const { Tray, Menu, app, shell } = require('electron');
const path = require('path');
const config = require('./config');
const vault = require('./vault');
const injector = require('./injector');

class TrayManager {
  constructor() {
    this.tray = null;
    this.mainWindow = null;
    this.onSyncAllCallback = null;
  }

  init(mainWindow, callbacks = {}) {
    this.mainWindow = mainWindow;
    this.onSyncAllCallback = callbacks.onSyncAll;

    const iconPath = path.join(__dirname, '..', 'assets', 'icon.ico');
    this.tray = new Tray(iconPath);
    this.tray.setToolTip('Xbox Grid Sync - Artwork Protection Shield Active');

    this.tray.on('click', () => {
      this.toggleWindow();
    });

    this.tray.on('double-click', () => {
      this.showWindow();
    });

    this.updateContextMenu();
  }

  toggleWindow() {
    if (!this.mainWindow) return;
    if (this.mainWindow.isVisible()) {
      if (this.mainWindow.isFocused()) {
        this.mainWindow.hide();
      } else {
        this.mainWindow.focus();
      }
    } else {
      this.showWindow();
    }
  }

  showWindow() {
    if (!this.mainWindow) return;
    this.mainWindow.show();
    this.mainWindow.focus();
  }

  updateContextMenu() {
    if (!this.tray) return;

    const autoRestore = config.get('autoRestore');

    const contextMenu = Menu.buildFromTemplate([
      {
        label: 'Open Xbox Grid Sync',
        click: () => this.showWindow()
      },
      { type: 'separator' },
      {
        label: 'Sync All Artwork Now',
        click: () => {
          if (this.onSyncAllCallback) {
            this.onSyncAllCallback();
          }
        }
      },
      {
        label: 'Restart Xbox PC App',
        click: async () => {
          await injector.restartXboxApp();
        }
      },
      { type: 'separator' },
      {
        label: 'Auto-Restore Shield Active',
        type: 'checkbox',
        checked: autoRestore,
        click: (item) => {
          config.set('autoRestore', item.checked);
          this.updateContextMenu();
          if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            this.mainWindow.webContents.send('config:changed', config.get());
          }
        }
      },
      {
        label: 'Open Artwork Vault Folder',
        click: () => {
          shell.openPath(vault.vaultDir);
        }
      },
      { type: 'separator' },
      {
        label: 'Exit Xbox Grid Sync',
        click: () => {
          app.isQuitting = true;
          app.quit();
        }
      }
    ]);

    this.tray.setContextMenu(contextMenu);
  }

  destroy() {
    if (this.tray) {
      this.tray.destroy();
      this.tray = null;
    }
  }
}

module.exports = new TrayManager();
