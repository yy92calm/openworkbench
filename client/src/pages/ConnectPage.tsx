import { Radio, RadioTower } from 'lucide-react';
import { useEffect, useState } from 'react';

import { listDevices, loadConfig, saveConfig } from '@/lib/connection';

export function ConnectPage({ onConnected }: { onConnected: () => void }) {
  const [relayUrl, setRelayUrl] = useState('');
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Restore the previous session's relay + token so the user only has to
  // submit after a refresh. Device selection now happens post-login via the
  // global DeviceBar, so we never call connect() from here.
  useEffect(() => {
    const cfg = loadConfig();
    if (!cfg) return;
    setRelayUrl(cfg.relayUrl);
    setToken(cfg.token);
  }, []);

  const submit = async () => {
    if (!relayUrl || !token) return;
    setBusy(true);
    setError('');
    try {
      // listDevices is the token-verification step; if it succeeds, the
      // user is logged in. Save config with empty deviceId — the user picks
      // a device from the DeviceBar inside the main shell.
      await listDevices(relayUrl, token);
      saveConfig({ relayUrl, token, deviceId: '' });
      onConnected();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      style={{
        minHeight: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
    >
      <div style={{ width: '100%', maxWidth: 360 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <RadioTower size={20} style={{ color: 'var(--accent)' }} />
          <h1 style={{ fontSize: 20, fontWeight: 600 }}>Workbench Remote</h1>
        </div>
        <p style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 24 }}>
          使用账号令牌登录。登录后即可使用会话分享、设置等功能；会话/任务/文件需选择设备。
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="field">
            <label>中继服务器（ws:// 或 wss://）</label>
            <input
              value={relayUrl}
              onChange={(e) => setRelayUrl(e.target.value)}
              placeholder="ws://relay-host:12960"
              spellCheck={false}
              inputMode="url"
            />
          </div>
          <div className="field">
            <label>账号令牌（桌面端管理分配的登录凭证）</label>
            <input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="令牌"
              onKeyDown={(e) => {
                if (e.key === 'Enter') void submit();
              }}
            />
          </div>
          {error && <p style={{ color: 'var(--error)', fontSize: 13 }}>{error}</p>}
          <button
            className="btn-primary"
            disabled={busy || !relayUrl || !token}
            onClick={() => void submit()}
          >
            <Radio size={15} />
            {busy ? '验证中…' : '登录'}
          </button>
        </div>
      </div>
    </div>
  );
}
