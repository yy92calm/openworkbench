// RelayHost keep-awake lifecycle: the sleep blocker is held while the relay
// connection intent is active (keepAwake + not stopped) and released on stop()
// or a live toggle. Electron / ws / store are stubbed — no real sockets.
import { powerSaveBlocker } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { RelayHost, type RelayHostConfig } from './relayHost';

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/workbench-test' },
  powerSaveBlocker: { start: vi.fn(() => 42), stop: vi.fn() },
}));

vi.mock('electron-log', () => ({
  default: {
    initialize: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    transports: {
      file: {
        resolvePath: undefined,
        getFile: () => ({ path: '/tmp/workbench-test/logs/workbench.log' }),
      },
    },
  },
}));

vi.mock('ws', () => ({
  WebSocket: class {
    onopen: unknown;
    onmessage: unknown;
    onclose: unknown;
    onerror: unknown;
    on(_event: string, _cb: unknown) {}
    close() {}
  },
}));

vi.mock('./store', () => ({
  getStore: () => ({ get: () => undefined, set: () => {} }),
}));

const cfg = (over: Partial<RelayHostConfig> = {}): RelayHostConfig => ({
  enabled: true,
  relayUrl: 'ws://relay.test:8080',
  deviceId: 'device-1',
  token: 't',
  keepAwake: false,
  ...over,
});

describe('RelayHost keep-awake', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('holds the sleep blocker when started with keepAwake', () => {
    const host = new RelayHost();
    host.start(cfg({ keepAwake: true }));
    expect(powerSaveBlocker.start).toHaveBeenCalledWith('prevent-display-sleep');
    host.stop();
  });

  it('holds no blocker when keepAwake is off', () => {
    const host = new RelayHost();
    host.start(cfg({ keepAwake: false }));
    expect(powerSaveBlocker.start).not.toHaveBeenCalled();
    host.stop();
  });

  it('releases the blocker on stop()', () => {
    const host = new RelayHost();
    host.start(cfg({ keepAwake: true }));
    expect(powerSaveBlocker.start).toHaveBeenCalledTimes(1);
    host.stop();
    expect(powerSaveBlocker.stop).toHaveBeenCalledTimes(1);
  });

  it('setKeepAwake(false) releases the blocker live without a reconnect', () => {
    const host = new RelayHost();
    host.start(cfg({ keepAwake: true }));
    expect(powerSaveBlocker.start).toHaveBeenCalledTimes(1);

    host.setKeepAwake(false);
    expect(powerSaveBlocker.stop).toHaveBeenCalledTimes(1);

    // Re-enabling holds it again; toggling while already on must not double-hold.
    host.setKeepAwake(true);
    host.setKeepAwake(true);
    expect(powerSaveBlocker.start).toHaveBeenCalledTimes(2);
    host.stop();
  });
});
