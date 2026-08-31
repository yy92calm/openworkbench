import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { I18nProvider } from '@/lib/i18n';

import { RemoteCard } from './RemoteCard';

const RELAY_CONFIG = {
  enabled: false,
  relayUrl: 'ws://relay.example:8080',
  deviceId: 'device-alpha',
  tokenSet: true,
};

describe('RemoteCard', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows the persisted device ID from the host config', async () => {
    const relayStatus = vi.fn().mockResolvedValue({ status: 'off', config: RELAY_CONFIG });
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText: vi.fn() } });
    (window as unknown as Record<string, unknown>).electronAPI = {
      ...((window as unknown as Record<string, unknown>).electronAPI as object),
      relayStatus,
      onRelayStatus: () => () => {},
    };

    render(
      <I18nProvider locale="en">
        <RemoteCard />
      </I18nProvider>,
    );

    await waitFor(() => {
      expect(screen.getByDisplayValue('device-alpha')).toBeInTheDocument();
    });
    expect(relayStatus).toHaveBeenCalled();
  });

  it('sends an edited device ID to relayStart on connect', async () => {
    const relayStatus = vi.fn().mockResolvedValue({ status: 'off', config: RELAY_CONFIG });
    const relayStart = vi.fn().mockResolvedValue('connecting');
    (window as unknown as Record<string, unknown>).electronAPI = {
      ...((window as unknown as Record<string, unknown>).electronAPI as object),
      relayStatus,
      relayStart,
      onRelayStatus: () => () => {},
    };

    render(
      <I18nProvider locale="en">
        <RemoteCard />
      </I18nProvider>,
    );

    const input = await screen.findByDisplayValue('device-alpha');
    await userEvent.clear(input);
    await userEvent.type(input, 'macbook-pro');

    await userEvent.click(screen.getByRole('button', { name: /save & connect/i }));

    await waitFor(() => {
      expect(relayStart).toHaveBeenCalledWith(expect.objectContaining({ deviceId: 'macbook-pro' }));
    });
  });

  it('reflects the persisted keep-awake setting and applies a toggle live', async () => {
    const relayStatus = vi.fn().mockResolvedValue({
      status: 'connected',
      config: { ...RELAY_CONFIG, keepAwake: true },
    });
    const relaySetKeepAwake = vi.fn().mockResolvedValue(undefined);
    (window as unknown as Record<string, unknown>).electronAPI = {
      ...((window as unknown as Record<string, unknown>).electronAPI as object),
      relayStatus,
      relaySetKeepAwake,
      onRelayStatus: () => () => {},
    };

    render(
      <I18nProvider locale="en">
        <RemoteCard />
      </I18nProvider>,
    );

    // Persisted keepAwake=true is reflected on the switch.
    const toggle = await screen.findByRole('switch');
    expect(toggle).toHaveAttribute('aria-checked', 'true');

    // Clicking applies the change live (no reconnect needed).
    await userEvent.click(toggle);
    await waitFor(() => {
      expect(relaySetKeepAwake).toHaveBeenCalledWith(false);
    });
    expect(toggle).toHaveAttribute('aria-checked', 'false');
  });
});
