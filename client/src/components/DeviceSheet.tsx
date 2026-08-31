import { RadioTower, RefreshCw, X } from 'lucide-react';
import { useEffect, useState } from 'react';

import { connect, listDevices, loadConfig, type RelayDeviceInfo } from '@/lib/connection';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Called after a device is successfully connected. */
  onConnected?: () => void;
}

/** Bottom-up sheet for picking a device. Replaces the modal switcher that
 *  used to live inside SessionsPage. */
export function DeviceSheet({ open, onClose, onConnected }: Props) {
  const [devices, setDevices] = useState<RelayDeviceInfo[] | null>(null);
  const [chosen, setChosen] = useState('');
  const [busy, setBusy] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState('');
  const cfg = loadConfig();

  useEffect(() => {
    if (!open) return;
    setDevices(null);
    setChosen('');
    setError('');
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const refresh = async () => {
    if (!cfg) {
      setError('未登录');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const list = await listDevices(cfg.relayUrl, cfg.token);
      setDevices(list);
      const online = list.filter((d) => d.online);
      // Auto-select only when there is exactly one online device — never
      // silently pick an offline one.
      setChosen(list.length === 1 && online.length === 1 ? list[0].device : '');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const apply = async () => {
    if (!chosen || !cfg) return;
    setConnecting(true);
    setError('');
    try {
      await connect({ relayUrl: cfg.relayUrl, deviceId: chosen, token: cfg.token });
      onConnected?.();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setConnecting(false);
    }
  };

  if (!open) return null;

  const onlineFirst = [...(devices ?? [])].sort((a, b) => Number(b.online) - Number(a.online));

  return (
    <>
      <div className="sheet-backdrop" onClick={onClose} />
      <div className="device-sheet" role="dialog" aria-label="选择设备">
        <div className="sheet-handle" aria-hidden />
        <div className="sheet-header">
          <RadioTower size={16} style={{ color: 'var(--accent)' }} />
          <h2 className="sheet-title">选择设备</h2>
          <button onClick={onClose} aria-label="关闭" className="icon-btn">
            <X size={16} />
          </button>
        </div>

        {error && <p className="sheet-error">{error}</p>}

        {devices === null ? (
          <p className="sheet-empty">加载中…</p>
        ) : devices.length === 0 ? (
          <p className="sheet-empty">
            该账号还没有注册任何设备——请先在桌面端设置 → 远程访问 中开启连接。
          </p>
        ) : (
          <div className="sheet-list">
            {onlineFirst.map((d) => (
              <button
                key={d.device}
                onClick={() => setChosen(d.device)}
                className={`sheet-item ${chosen === d.device ? 'selected' : ''} ${d.online ? '' : 'offline'}`}
              >
                <span
                  className="sheet-item-dot"
                  style={{ background: d.online ? 'var(--ok)' : 'var(--muted)' }}
                />
                <span className="sheet-item-id">{d.device}</span>
                <span className="sheet-item-status">{d.online ? '在线' : '离线'}</span>
              </button>
            ))}
          </div>
        )}

        <div className="sheet-actions">
          <button
            className="btn-secondary"
            onClick={() => void refresh()}
            disabled={busy}
            aria-label="刷新"
          >
            <RefreshCw size={14} />
            刷新
          </button>
          <button
            className="btn-primary"
            onClick={() => void apply()}
            disabled={!chosen || connecting}
          >
            {connecting ? '连接中…' : '连接'}
          </button>
        </div>
      </div>
    </>
  );
}
