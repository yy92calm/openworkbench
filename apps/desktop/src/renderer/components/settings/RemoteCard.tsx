import { Check, Copy, Radio, RadioTower } from 'lucide-react';
import { useEffect, useState } from 'react';

import { cn } from '@/lib/cn';
import { useI18n } from '@/lib/i18n';

type RelayStatus = 'off' | 'connecting' | 'connected' | 'error';

const STATUS_META: Record<RelayStatus, { label: string; dot: string }> = {
  off: { label: '未连接', dot: 'bg-muted' },
  connecting: { label: '连接中…', dot: 'bg-warn animate-pulse' },
  connected: { label: '已连接', dot: 'bg-ok' },
  error: { label: '连接失败', dot: 'bg-error' },
};

/** Remote access card: connect this Workbench instance to the public relay so
 *  the mobile/web client can drive sessions from anywhere. */
export function RemoteCard() {
  const { t } = useI18n();
  const [status, setStatus] = useState<RelayStatus>('off');
  const [relayUrl, setRelayUrl] = useState('ws://43.133.82.137:8080');
  const [deviceId, setDeviceId] = useState('');
  const [token, setToken] = useState('');
  const [tokenSet, setTokenSet] = useState(false);
  const [keepAwake, setKeepAwake] = useState(false);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = async () => {
    const { status: s, config } = await window.electronAPI.relayStatus();
    setStatus(s);
    setRelayUrl(config.relayUrl);
    setDeviceId(config.deviceId);
    setTokenSet(config.tokenSet);
    setKeepAwake(config.keepAwake);
  };

  useEffect(() => {
    void load();
    const off = window.electronAPI.onRelayStatus((s) => setStatus(s as RelayStatus));
    return off;
  }, []);

  const connect = async () => {
    setBusy(true);
    try {
      const s = await window.electronAPI.relayStart({ relayUrl, deviceId, token, keepAwake });
      setStatus(s as RelayStatus);
      setTokenSet(true);
      setToken('');
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    setBusy(true);
    try {
      await window.electronAPI.relayStop();
      setStatus('off');
    } finally {
      setBusy(false);
    }
  };

  const toggleKeepAwake = async () => {
    const next = !keepAwake;
    setKeepAwake(next);
    await window.electronAPI.relaySetKeepAwake(next);
  };

  const copyDevice = async () => {
    await navigator.clipboard.writeText(deviceId);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const meta = STATUS_META[status];

  return (
    <section className="mt-5 rounded-card border border-border bg-surface shadow-card">
      <header className="border-b border-border px-5 py-3">
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-1.5 text-[15px] font-medium text-text">
            <RadioTower size={15} className="text-accent" />
            {t('settings.remote.title')}
          </h2>
          <span className="flex items-center gap-1.5 rounded-full bg-surface-2 px-2.5 py-0.5 text-xs text-muted ring-1 ring-border">
            <span className={cn('h-1.5 w-1.5 rounded-full', meta.dot)} />
            {meta.label}
          </span>
        </div>
        <p className="mt-0.5 text-xs text-muted">{t('settings.remote.subtitle')}</p>
      </header>
      <div className="space-y-3 px-5 py-4">
        <label className="block">
          <span className="text-xs text-muted">{t('settings.remote.relayUrl')}</span>
          <input
            value={relayUrl}
            onChange={(e) => setRelayUrl(e.target.value)}
            placeholder="ws://your-server:8080"
            spellCheck={false}
            className="mt-1 h-9 w-full rounded-input border border-border bg-surface px-3 font-mono text-[13px] text-text outline-none placeholder:text-muted focus:border-accent/60"
          />
        </label>
        <div className="flex gap-3">
          <label className="block flex-1">
            <span className="text-xs text-muted">{t('settings.remote.deviceId')}</span>
            <div className="mt-1 flex h-9 items-center gap-1 rounded-input border border-border bg-surface px-3 font-mono text-[13px] text-text">
              <input
                value={deviceId}
                onChange={(e) => setDeviceId(e.target.value)}
                placeholder="必填"
                spellCheck={false}
                className="min-w-0 flex-1 bg-transparent text-[13px] text-text outline-none placeholder:text-muted"
              />
              <button
                onClick={() => void copyDevice()}
                disabled={!deviceId}
                className="text-muted hover:text-text disabled:opacity-40"
                aria-label="复制设备 ID"
              >
                {copied ? <Check size={13} className="text-ok" /> : <Copy size={13} />}
              </button>
            </div>
            <p className="mt-1 text-[11px] text-muted">{t('settings.remote.deviceIdHint')}</p>
          </label>
          <label className="block flex-1">
            <span className="text-xs text-muted">{t('settings.remote.token')}</span>
            <input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder={tokenSet ? '••••••••（已设置，留空保持不变）' : '必填'}
              spellCheck={false}
              className="mt-1 h-9 w-full rounded-input border border-border bg-surface px-3 font-mono text-[13px] text-text outline-none placeholder:text-muted focus:border-accent/60"
            />
          </label>
        </div>
        <div className="flex items-center justify-between rounded-input border border-border bg-surface px-3 py-2">
          <span className="text-xs text-text">{t('settings.remote.keepAwake')}</span>
          <button
            onClick={() => void toggleKeepAwake()}
            role="switch"
            aria-checked={keepAwake}
            aria-label={t('settings.remote.keepAwake')}
            className={cn(
              'relative h-5 w-9 shrink-0 rounded-full transition-colors',
              keepAwake ? 'bg-accent' : 'bg-surface-2',
            )}
          >
            <span
              className={cn(
                'absolute top-0.5 h-4 w-4 rounded-full bg-surface shadow transition-transform',
                keepAwake ? 'left-[18px]' : 'left-0.5',
              )}
            />
          </button>
        </div>
        <div className="flex items-center gap-3 pt-1">
          {status === 'off' || status === 'error' ? (
            <button
              onClick={() => void connect()}
              disabled={busy || !relayUrl || !deviceId}
              className="flex h-9 shrink-0 items-center gap-1.5 rounded-input bg-accent px-3.5 text-[13px] font-medium text-accent-fg transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              <Radio size={14} />
              {t('settings.remote.connect')}
            </button>
          ) : (
            <button
              onClick={() => void disconnect()}
              disabled={busy}
              className="flex h-9 shrink-0 items-center gap-1.5 rounded-input border border-border bg-surface px-3.5 text-[13px] text-text transition-colors hover:bg-surface-2 disabled:opacity-50"
            >
              {t('settings.remote.disconnect')}
            </button>
          )}
          <p className="text-xs text-muted">{t('settings.remote.note')}</p>
        </div>
      </div>
    </section>
  );
}
