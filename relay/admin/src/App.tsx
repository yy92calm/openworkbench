import { KeyRound, LogOut, Plus, ShieldCheck, Trash2, Users } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import {
  type AdminAccount,
  createAccount,
  deleteAccount,
  deleteDevice,
  listAccounts,
  login,
  logout,
  UnauthorizedError,
} from '@/lib/api';

export function App() {
  const [authed, setAuthed] = useState<boolean | null>(null); // null = checking
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');

  useEffect(() => {
    // Restore session: try a privileged call; 401 → show login.
    listAccounts()
      .then(() => setAuthed(true))
      .catch(() => setAuthed(false));
  }, []);

  const submitLogin = async () => {
    setLoginError('');
    try {
      await login(password);
      setAuthed(true);
    } catch (err) {
      setLoginError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleLogout = async () => {
    try {
      await logout();
    } finally {
      setAuthed(false);
    }
  };

  if (authed === null) {
    return <Centered>加载中…</Centered>;
  }
  if (!authed) {
    return (
      <Centered>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submitLogin();
          }}
          style={{ width: '100%', maxWidth: 320 }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <ShieldCheck size={20} style={{ color: 'var(--accent)' }} />
            <h1 style={{ fontSize: 20, fontWeight: 600 }}>中继管理</h1>
          </div>
          <p style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 22 }}>
            输入管理员密码以管理账号令牌与设备。
          </p>
          <div className="field" style={{ marginBottom: 14 }}>
            <label>管理员密码</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="密码"
              autoFocus
            />
          </div>
          {loginError && (
            <p style={{ color: 'var(--error)', fontSize: 13, marginBottom: 10 }}>{loginError}</p>
          )}
          <button
            className="btn-primary"
            type="submit"
            disabled={!password}
            style={{ width: '100%' }}
          >
            <KeyRound size={15} />
            登录
          </button>
        </form>
      </Centered>
    );
  }

  return <Dashboard onLogout={() => void handleLogout()} onUnauthorized={() => setAuthed(false)} />;
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        minHeight: '100dvh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
    >
      {children}
    </div>
  );
}

function Dashboard({
  onLogout,
  onUnauthorized,
}: {
  onLogout: () => void;
  onUnauthorized: () => void;
}) {
  const [accounts, setAccounts] = useState<AdminAccount[] | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [error, setError] = useState('');
  // New-account form
  const [newToken, setNewToken] = useState('');
  const [newNote, setNewNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const refresh = useCallback(async () => {
    try {
      setAccounts((await listAccounts()).accounts);
      setError('');
    } catch (err) {
      if (err instanceof UnauthorizedError) onUnauthorized();
      else setError(err instanceof Error ? err.message : String(err));
    }
  }, [onUnauthorized]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const addAccount = async () => {
    if (!newToken.trim()) return;
    setBusy(true);
    setMsg('');
    try {
      await createAccount(newToken.trim(), newNote.trim() || undefined);
      setNewToken('');
      setNewNote('');
      setMsg('账号已添加');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const removeAccount = async (token: string) => {
    if (!confirm(`删除账号 ${token}？其设备列表将一并删除。`)) return;
    try {
      await deleteAccount(token);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const removeDevice = async (token: string, device: string) => {
    if (!confirm(`从账号 ${token} 移除设备 ${device}？`)) return;
    try {
      await deleteDevice(token, device);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const totalDevices = accounts?.reduce((n, a) => n + a.devices.length, 0) ?? 0;

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '32px 20px 64px' }}>
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 20,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <ShieldCheck size={20} style={{ color: 'var(--accent)' }} />
          <h1 style={{ fontSize: 20, fontWeight: 600 }}>中继管理</h1>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>
            {accounts ? `${accounts.length} 账号 / ${totalDevices} 设备` : '…'}
          </span>
          <button
            className="btn-ghost"
            onClick={onLogout}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}
          >
            <LogOut size={13} />
            退出
          </button>
        </div>
      </header>

      {/* New account */}
      <div className="card" style={{ padding: 16, marginBottom: 16 }}>
        <h2
          style={{
            fontSize: 14,
            fontWeight: 600,
            marginBottom: 10,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          <Users size={15} style={{ color: 'var(--accent)' }} />
          新增账号令牌
        </h2>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <div className="field" style={{ flex: '2 1 200px' }}>
            <label>令牌（即客户端登录凭证，请用强随机值）</label>
            <input
              value={newToken}
              onChange={(e) => setNewToken(e.target.value)}
              placeholder="token"
              spellCheck={false}
            />
          </div>
          <div className="field" style={{ flex: '1 1 140px' }}>
            <label>备注（可选）</label>
            <input
              value={newNote}
              onChange={(e) => setNewNote(e.target.value)}
              placeholder="用户名 / 用途"
            />
          </div>
          <button
            className="btn-primary"
            disabled={busy || !newToken.trim()}
            onClick={() => void addAccount()}
            style={{ alignSelf: 'flex-end' }}
          >
            <Plus size={15} />
            添加
          </button>
        </div>
        {msg && <p style={{ color: 'var(--ok)', fontSize: 13, marginTop: 8 }}>{msg}</p>}
      </div>

      {error && <p style={{ color: 'var(--error)', fontSize: 13, marginBottom: 12 }}>{error}</p>}

      {/* Accounts */}
      {accounts === null ? (
        <p style={{ color: 'var(--muted)', fontSize: 14 }}>加载中…</p>
      ) : accounts.length === 0 ? (
        <p style={{ color: 'var(--muted)', fontSize: 14 }}>
          还没有账号。用上面的表单添加第一个令牌。
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {accounts.map((acc) => (
            <div key={acc.token} className="card">
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '14px 16px',
                  cursor: 'pointer',
                  flexWrap: 'wrap',
                }}
                onClick={() => setExpanded(expanded === acc.token ? null : acc.token)}
              >
                <span
                  style={{
                    fontFamily: 'ui-monospace, monospace',
                    fontSize: 13,
                    flex: '1 1 140px',
                    wordBreak: 'break-all',
                  }}
                >
                  {acc.token}
                </span>
                {acc.note && (
                  <span style={{ fontSize: 12, color: 'var(--muted)' }}>{acc.note}</span>
                )}
                <span style={{ fontSize: 12, color: 'var(--muted)', whiteSpace: 'nowrap' }}>
                  {acc.devices.filter((d) => d.online).length}/{acc.devices.length} 在线
                </span>
                <button
                  className="btn-danger"
                  onClick={(e) => {
                    e.stopPropagation();
                    void removeAccount(acc.token);
                  }}
                  title="删除账号"
                >
                  <Trash2 size={13} />
                </button>
              </div>

              {expanded === acc.token && (
                <div style={{ borderTop: '1px solid var(--border)', padding: '8px 16px 14px' }}>
                  {acc.devices.length === 0 ? (
                    <p style={{ color: 'var(--muted)', fontSize: 13, padding: '8px 0' }}>
                      该账号还没有注册设备（桌面端开启远程访问后出现）。
                    </p>
                  ) : (
                    <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 4 }}>
                      <tbody>
                        {acc.devices.map((d) => (
                          <tr key={d.device} style={{ fontSize: 13 }}>
                            <td
                              style={{ padding: '7px 4px', fontFamily: 'ui-monospace, monospace' }}
                            >
                              {d.device}
                            </td>
                            <td style={{ padding: '7px 4px', textAlign: 'right' }}>
                              <span
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: 5,
                                  color: d.online ? 'var(--ok)' : 'var(--muted)',
                                }}
                              >
                                <span
                                  className={`dot ${d.online ? 'dot-online' : 'dot-offline'}`}
                                />
                                {d.online ? '在线' : '离线'}
                              </span>
                            </td>
                            <td style={{ padding: '2px 4px', textAlign: 'right', width: 44 }}>
                              <button
                                className="btn-danger"
                                onClick={() => void removeDevice(acc.token, d.device)}
                                title="移除设备"
                              >
                                <Trash2 size={12} />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
