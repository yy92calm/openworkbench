// @vitest-environment node
// OpenCodeClient 核心契约测试：事件归一化、session 生命周期、状态流转。
// 通过 mockServer（OpenCode 协议 mock）独立于真实 sidecar 运行。
import { describe, expect, it } from 'vitest';

import { type MockOpenCode, startMockOpenCode } from './mockServer';
import { OpenCodeClient } from './OpenCodeClient';
import type { OpenCodeEvent } from './types';

async function waitFor(pred: () => boolean, timeout = 3000) {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > timeout) throw new Error('timeout');
    await new Promise((r) => setTimeout(r, 10));
  }
}

async function withServer(fn: (port: number) => Promise<void>): Promise<void> {
  const server: MockOpenCode = await startMockOpenCode(0);
  try {
    await fn(server.port);
  } finally {
    await server.close();
  }
}

describe('OpenCodeClient', () => {
  it('normalizes message.part.updated into text.updated / tool.updated / session.idle', async () => {
    await withServer(async (port) => {
      const events: OpenCodeEvent[] = [];
      const client = new OpenCodeClient({ baseUrl: `http://127.0.0.1:${port}` });
      client.onEvent((e) => events.push(e));

      await client.connect();
      const sessionId = await client.createSession();
      expect(sessionId).toBe('ses_mock');

      await client.sendPrompt(sessionId, 'run a literature review');
      await waitFor(() => events.some((e) => e.type === 'session.idle'));

      const types = events.map((e) => e.type);
      expect(types).toContain('text.updated');
      expect(types).toContain('tool.updated');
      expect(types).toContain('session.idle');

      // Deltas accumulate: the streamed text grows token by token, and the
      // final text-end part carries the full passage.
      const p1 = events
        .filter(
          (e): e is Extract<OpenCodeEvent, { type: 'text.updated' }> =>
            e.type === 'text.updated' && e.partId === 'p1',
        )
        .map((e) => e.text);
      expect(p1).toContain('Planning ');
      expect(p1[p1.length - 1]).toBe('Planning the analysis. ');

      // Tool parts map to running → success with the live title.
      const toolDone = events.find(
        (e): e is Extract<OpenCodeEvent, { type: 'tool.updated' }> =>
          e.type === 'tool.updated' && e.status === 'success',
      );
      expect(toolDone?.tool).toBe('literature-search');
      expect(toolDone?.title).toContain('PubMed');

      client.close();
    });
  });

  it('tracks session lifecycle: create / list / abort / delete', async () => {
    await withServer(async (port) => {
      const client = new OpenCodeClient({ baseUrl: `http://127.0.0.1:${port}` });
      await client.connect();

      const id = await client.createSession();
      const sessions = await client.listSessions();
      expect(sessions.map((s) => s.id)).toContain(id);

      await client.abortSession(id);
      await client.deleteSession(id);
      const after = await client.listSessions();
      expect(after.map((s) => s.id)).not.toContain(id);

      client.close();
    });
  });

  it('transitions status: offline → connecting → ready → offline', async () => {
    await withServer(async (port) => {
      const client = new OpenCodeClient({ baseUrl: `http://127.0.0.1:${port}` });
      expect(client.getStatus()).toBe('offline');

      await client.connect();
      expect(client.getStatus()).toBe('ready');

      client.close();
      expect(client.getStatus()).toBe('offline');
    });
  });
});
