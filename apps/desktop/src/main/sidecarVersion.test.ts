import { afterEach, describe, expect, it, vi } from 'vitest';

import { checkSidecarVersion, normalizeVersion } from './sidecarVersion';

describe('normalizeVersion', () => {
  it('drops a leading v and trims whitespace', () => {
    expect(normalizeVersion('v1.2.3')).toBe('1.2.3');
    expect(normalizeVersion('V1.2.3')).toBe('1.2.3');
    expect(normalizeVersion(' 1.2.3 \n')).toBe('1.2.3');
  });
});

describe('checkSidecarVersion', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reports the failure instead of throwing when the network is down', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('offline');
      }),
    );
    const status = await checkSidecarVersion();
    expect(status.error).toBe('offline');
    expect(status.latest).toBeNull();
    expect(status.isLatest).toBeNull();
  });

  it('surfaces a non-2xx response as an error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 403 })),
    );
    const status = await checkSidecarVersion();
    expect(status.error).toBe('GitHub responded 403');
    expect(status.latest).toBeNull();
  });

  it('reads the latest tag and leaves the comparison unknown without a probe', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ tag_name: 'v9.9.9' }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
      ),
    );
    const status = await checkSidecarVersion();
    expect(status.latest).toBe('9.9.9');
    expect(status.error).toBeNull();
    // The bundled binary cannot be probed in tests, so no verdict is claimed.
    expect(status.current).toBeNull();
    expect(status.isLatest).toBeNull();
  });

  it('errors out when the payload has no tag_name', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ message: 'Not Found' }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
      ),
    );
    const status = await checkSidecarVersion();
    expect(status.error).toBe('release payload has no tag_name');
  });
});
