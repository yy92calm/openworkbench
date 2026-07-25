import { app } from "electron";
import contextMenu from "electron-context-menu";
import { homedir } from "node:os";
import { CHANNEL, APP_NAMES, APP_IDS } from "./constants";
import { registerIpcHandlers } from "./ipc";
import { getLogger } from "./logging";
import { createMainWindow, setDockIcon, getMainWindow } from "./windows";
import { setupAutoUpdater } from "./updater";
import { stopSidecar, deployBundledProfile, getBrowserMcp } from "./server";
import { killAllKernels } from "./kernel";
import { stopPreviewServer, startPreviewServer } from "./preview_server";
import { cronEngine, stopSchedulerApi } from "./scheduler";

contextMenu({ showSaveImageAs: true });

try {
  process.chdir(homedir());
} catch { /* ignore */ }

process.env.OPENCODE_DISABLE_EMBEDDED_WEB_UI = "true";

const logger = getLogger();

app.setName(APP_NAMES[CHANNEL]);
app.setAppUserModelId(APP_IDS[CHANNEL]);

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

app.on("second-instance", () => {
  const win = getMainWindow();
  if (win) {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  }
});

app.on("before-quit", () => {
  cronEngine.stop();
  stopSidecar();
  stopSchedulerApi();
  killAllKernels();
  stopPreviewServer();
});

app.on("will-quit", () => {
  cronEngine.stop();
  stopSidecar();
  stopSchedulerApi();
  killAllKernels();
  stopPreviewServer();
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    cronEngine.stop();
    stopSidecar();
    stopSchedulerApi();
    killAllKernels();
    stopPreviewServer();
    app.exit(0);
  });
}

void app.whenReady().then(async () => {
  logger.info("app starting", {
    version: app.getVersion(),
    channel: CHANNEL,
    packaged: app.isPackaged,
  });

  // Set the app's userData path per channel
  app.setPath("userData", app.getPath("appData") + "/" + APP_IDS[CHANNEL]);

  registerIpcHandlers();
  getBrowserMcp().start();
  setDockIcon();

  deployBundledProfile();

  startPreviewServer();

  const updater = setupAutoUpdater();

  const win = createMainWindow();
  win.on("closed", () => {
    // On macOS, keep the app running in the dock
  });
});