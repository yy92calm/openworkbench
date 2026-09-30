// System tray + global show/hide hotkey.
//
// The app keeps running when its window is closed (window close is intercepted
// in windows.ts and hides instead), so the agent, the scheduler and the relay
// host stay alive. Getting back is either the tray icon or Shift+X.

import { app, globalShortcut, Menu, nativeImage, Tray } from 'electron';

import { APP_NAMES, CHANNEL } from './constants';
import { getLogger } from './logging';
import { appIconPath, getMainWindow } from './windows';

/** Global hotkey that toggles the main window (same action as the tray icon). */
export const TOGGLE_SHORTCUT = 'Shift+X';

let tray: Tray | null = null;
let shortcutRegistered = false;

/** Tray click and the hotkey share one definition so they cannot diverge. */
function toggleWindow(): void {
  const win = getMainWindow();
  if (!win) return;
  if (win.isVisible()) {
    win.hide();
  } else {
    win.show();
    win.focus();
  }
}

/** Create the tray icon. Failures (e.g. no app indicator support on some Linux
 *  desktops) are logged and degrade to "no tray", never crash the app. */
export function setupTray(): void {
  const logger = getLogger();
  try {
    const icon = nativeImage.createFromPath(appIconPath());
    if (icon.isEmpty()) throw new Error('tray icon could not be loaded');
    tray = new Tray(icon.resize({ width: 16, height: 16 }));
    tray.setToolTip(APP_NAMES[CHANNEL]);
    tray.on('click', toggleWindow);
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: '显示主窗口', click: toggleWindow },
        { type: 'separator' },
        { label: '退出', click: () => app.quit() },
      ]),
    );
  } catch (err) {
    logger.warn(`[tray] setup failed: ${err instanceof Error ? err.message : String(err)}`);
    tray = null;
  }
}

/** Register the global hotkey. Returns false when the combination is already
 *  taken by another app — surfaced in settings rather than failing silently. */
export function registerGlobalShortcut(): boolean {
  const logger = getLogger();
  try {
    shortcutRegistered = globalShortcut.register(TOGGLE_SHORTCUT, toggleWindow);
  } catch (err) {
    logger.warn(
      `[tray] hotkey registration threw: ${err instanceof Error ? err.message : String(err)}`,
    );
    shortcutRegistered = false;
  }
  if (!shortcutRegistered) {
    logger.warn(`[tray] hotkey ${TOGGLE_SHORTCUT} unavailable (already taken?)`);
  }
  return shortcutRegistered;
}

export interface WindowBehaviorStatus {
  shortcut: string;
  shortcutRegistered: boolean;
  trayAvailable: boolean;
}

/** Reported to the settings UI so a taken hotkey is visible to the user. */
export function windowBehaviorStatus(): WindowBehaviorStatus {
  return {
    shortcut: TOGGLE_SHORTCUT,
    shortcutRegistered,
    trayAvailable: tray !== null,
  };
}

export function disposeTray(): void {
  globalShortcut.unregisterAll();
  shortcutRegistered = false;
  tray?.destroy();
  tray = null;
}
