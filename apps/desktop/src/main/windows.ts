import { join } from 'node:path';

import { app, BrowserWindow, nativeImage, nativeTheme } from 'electron';

import { APP_NAMES, CHANNEL } from './constants';
import { getStore } from './store';

const WINDOW_STORE_KEY = 'windowState';

interface WindowState {
  x?: number;
  y?: number;
  width: number;
  height: number;
}

let mainWindow: BrowserWindow | null = null;

export function createMainWindow(): BrowserWindow {
  const store = getStore();
  const saved = store.get(WINDOW_STORE_KEY) as WindowState | undefined;
  const mode = nativeTheme.shouldUseDarkColors ? 'dark' : 'light';

  const win = new BrowserWindow({
    width: saved?.width ?? 1280,
    height: saved?.height ?? 800,
    x: saved?.x,
    y: saved?.y,
    show: false,
    title: APP_NAMES[CHANNEL],
    autoHideMenuBar: true,
    ...(process.platform === 'darwin'
      ? { titleBarStyle: 'hidden' as const, trafficLightPosition: { x: 14, y: 14 } }
      : {}),
    ...(process.platform === 'win32'
      ? {
          frame: false,
          titleBarStyle: 'hidden' as const,
          titleBarOverlay: {
            color: '#00000000',
            symbolColor: mode === 'dark' ? 'white' : 'black',
            height: 40,
          },
        }
      : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webviewTag: true,
    },
  });

  // Save window state on resize/move
  const saveState = () => {
    if (win.isMinimized() || !win.isVisible()) return;
    const bounds = win.getBounds();
    store.set(WINDOW_STORE_KEY, {
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
    });
  };
  win.on('resize', saveState);
  win.on('move', saveState);

  // Load the renderer
  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'));
  }

  win.once('ready-to-show', () => {
    win.show();
  });

  mainWindow = win;
  return win;
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}

export function setDockIcon(): void {
  if (process.platform !== 'darwin') return;
  const iconPath = join(app.getAppPath(), 'icons', 'icon.png');
  const icon = nativeImage.createFromPath(iconPath);
  if (!icon.isEmpty()) app.dock?.setIcon(icon);
}
