import { dialog } from 'electron';
import updater from 'electron-updater';
const { autoUpdater } = updater;
import { UPDATER_ENABLED } from './constants';
import { getStore } from './store';

const STORE_KEY = 'updater.ready';

export function setupAutoUpdater(): void {
  if (!UPDATER_ENABLED) return;
  autoUpdater.channel = 'latest';
  autoUpdater.allowPrerelease = false;
  autoUpdater.allowDowngrade = true;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;

  autoUpdater.on('update-available', (info) => {
    const store = getStore('workbench.updater');
    store.set(STORE_KEY, { version: info.version });
  });

  autoUpdater.on('download-progress', () => {});
  autoUpdater.on('update-downloaded', () => {});

  void autoUpdater.checkForUpdates();
}

export async function checkForUpdates(alertOnUpToDate = false): Promise<void> {
  if (!UPDATER_ENABLED) return;
  try {
    const result = await autoUpdater.checkForUpdates();
    if (!result || !result.updateInfo) {
      if (alertOnUpToDate) {
        await dialog.showMessageBox({
          type: 'info',
          message: "You're up to date.",
          title: 'No Updates',
        });
      }
      return;
    }

    const response = await dialog.showMessageBox({
      type: 'info',
      message: `Update ${result.updateInfo.version} available. Download now?`,
      title: 'Update Available',
      buttons: ['Download', 'Later'],
      defaultId: 0,
      cancelId: 1,
    });

    if (response.response === 0) {
      await autoUpdater.downloadUpdate();
      const installResponse = await dialog.showMessageBox({
        type: 'info',
        message: `Update ${result.updateInfo.version} downloaded. Restart now?`,
        title: 'Update Ready',
        buttons: ['Restart', 'Later'],
        defaultId: 0,
        cancelId: 1,
      });
      if (installResponse.response === 0) {
        autoUpdater.quitAndInstall();
      }
    }
  } catch {
    if (alertOnUpToDate) {
      await dialog.showMessageBox({
        type: 'error',
        message: 'Update check failed.',
        title: 'Update Error',
      });
    }
  }
}
