import { app } from "electron";
import { randomUUID } from "node:crypto";
import contextMenu from "electron-context-menu";
import { homedir } from "node:os";
import { CHANNEL, APP_NAMES, APP_IDS } from "./constants";
import { registerIpcHandlers, relayHost } from "./ipc";
import { getLogger } from "./logging";
import { getStore } from "./store";
import { createMainWindow, setDockIcon, getMainWindow } from "./windows";
import { setupAutoUpdater } from "./updater";
import { stopSidecar, deployBundledProfile, getBrowserMcp } from "./server";
import { killAllKernels } from "./kernel";
import { stopPreviewServer, startPreviewServer } from "./preview_server";
import { cronEngine, stopSchedulerApi } from "./scheduler";
import type { RelayHostConfig } from "./relayHost";

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

  // Auto-connect the remote relay if the user left it enabled. Only when the
  // config is complete: a deviceId/token generated here would register a random
  // one-off device (garbage in the relay device list) or fail auth with a token
  // that isn't in any account. Incomplete config waits for the settings page.
  const relayCfg = getStore().get("relay") as Partial<RelayHostConfig> | undefined;
  if (relayCfg?.enabled && relayCfg.deviceId && relayCfg.token) {
    relayHost.start({
      enabled: true,
      relayUrl: relayCfg.relayUrl ?? "ws://43.133.82.137:8080",
      deviceId: relayCfg.deviceId,
      token: relayCfg.token,
    });
  }

  startPreviewServer();

  const updater = setupAutoUpdater();

  const win = createMainWindow();
  win.on("closed", () => {
    // On macOS, keep the app running in the dock
  });
});