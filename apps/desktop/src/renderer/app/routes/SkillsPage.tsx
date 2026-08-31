import { Bot, Puzzle, Server } from 'lucide-react';
import { useEffect, useState } from 'react';

import { cn } from '@/lib/cn';
import { useI18n } from '@/lib/i18n';
import { useRuntimeStore } from '@/lib/runtime';

type Tab = 'agents' | 'skills' | 'mcp';

export function SkillsPage() {
  const { t } = useI18n();
  const { skills, agents, mcpServers, status, loadCatalog, loadMcpServers, toggleMcpServer } =
    useRuntimeStore();
  const connected = status === 'ready';
  const [tab, setTab] = useState<Tab>('agents');

  useEffect(() => {
    if (connected) {
      void loadCatalog();
      void loadMcpServers();
    }
  }, [connected, loadCatalog, loadMcpServers]);

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-6xl px-8 py-8">
        <h1 className="text-xl font-semibold tracking-tight text-text">{t('skills.title')}</h1>
        <p className="mt-1 text-sm text-muted">{t('skills.subtitle')}</p>

        {connected ? (
          <>
            <div className="mt-6 flex gap-1 rounded-card border border-border bg-surface-2 p-1">
              <TabButton active={tab === 'agents'} onClick={() => setTab('agents')}>
                <Bot size={14} /> Agents ({agents.length})
              </TabButton>
              <TabButton active={tab === 'skills'} onClick={() => setTab('skills')}>
                <Puzzle size={14} /> Skills ({skills.length})
              </TabButton>
              <TabButton active={tab === 'mcp'} onClick={() => setTab('mcp')}>
                <Server size={14} /> 我的数据源 ({mcpServers.length})
              </TabButton>
            </div>

            {tab === 'agents' &&
              (agents.length === 0 ? (
                <Empty>{t('skills.noAgents')}</Empty>
              ) : (
                <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-4">
                  {agents.map((a) => (
                    <Card
                      key={a.name}
                      name={a.name}
                      desc={a.description}
                      tags={a.mode ? [a.mode] : []}
                    />
                  ))}
                </div>
              ))}

            {tab === 'skills' &&
              (skills.length === 0 ? (
                <Empty>{t('skills.noSkills')}</Empty>
              ) : (
                <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-4">
                  {skills.map((s) => (
                    <Card
                      key={s.name}
                      name={s.name}
                      desc={s.description}
                      tags={sourceOf(s.location, t) ? [sourceOf(s.location, t)!] : []}
                    />
                  ))}
                </div>
              ))}

            {tab === 'mcp' &&
              (mcpServers.length === 0 ? (
                <Empty>暂无数据源</Empty>
              ) : (
                <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-4">
                  {mcpServers.map((s) => (
                    <McpCard
                      key={s.name}
                      name={s.name}
                      status={s.status}
                      config={s.config}
                      onToggle={(enabled) => toggleMcpServer(s.name, enabled)}
                    />
                  ))}
                </div>
              ))}
          </>
        ) : (
          <div className="mt-6 rounded-card border border-border bg-surface p-5 text-sm text-muted">
            {t('skills.disconnected')}
          </div>
        )}
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex flex-1 items-center justify-center gap-1.5 rounded-[5px] px-4 py-1.5 text-[13px] transition-colors',
        active ? 'bg-surface text-text shadow-card' : 'text-muted hover:text-text',
      )}
    >
      {children}
    </button>
  );
}

function Card({ name, desc, tags }: { name: string; desc: string; tags: string[] }) {
  const { t } = useI18n();
  return (
    <div className="flex flex-col rounded-card border border-border bg-surface p-4">
      <div className="mb-1 text-sm font-medium text-text">{name}</div>
      <div className="min-h-[2.5rem] text-xs leading-relaxed text-muted line-clamp-2">
        {desc || t('skills.noDesc')}
      </div>
      {tags.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {tags.map((tag) => (
            <span
              key={tag}
              className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] text-muted ring-1 ring-border"
            >
              {tag}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function McpCard({
  name,
  status,
  config,
  onToggle,
}: {
  name: string;
  status: string;
  config?: { type: string; url?: string; command?: string[]; enabled?: boolean };
  onToggle: (enabled: boolean) => void;
}) {
  const isConnected = status === 'connected';
  const isEnabled = config?.enabled !== false;
  const typeLabel = config?.type === 'remote' ? 'remote' : config?.type === 'local' ? 'local' : '';
  const detail =
    config?.type === 'remote'
      ? config.url
      : config?.type === 'local'
        ? config.command?.join(' ')
        : '';

  return (
    <div className="flex flex-col rounded-card border border-border bg-surface p-4">
      <div className="mb-1 flex items-center justify-between">
        <div className="text-sm font-medium text-text">{name}</div>
        <label className="relative inline-flex cursor-pointer items-center">
          <input
            type="checkbox"
            className="peer sr-only"
            checked={isEnabled}
            onChange={(e) => onToggle(e.target.checked)}
          />
          <div className="h-5 w-9 rounded-full bg-border peer-checked:bg-accent transition-colors" />
          <div className="absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform peer-checked:translate-x-4" />
        </label>
      </div>
      <div className="flex items-center gap-1.5">
        <span
          className={cn(
            'h-1.5 w-1.5 rounded-full',
            isConnected ? 'bg-ok' : status === 'failed' ? 'bg-error' : 'bg-muted',
          )}
        />
        <span className="text-xs text-muted">
          {isConnected
            ? '已连接'
            : status === 'failed'
              ? '连接失败'
              : status === 'disabled'
                ? '已停用'
                : status}
        </span>
      </div>
      <div className="mt-1.5 min-h-[2.5rem] text-xs leading-relaxed text-muted line-clamp-2">
        {typeLabel && (
          <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] ring-1 ring-border mr-1">
            {typeLabel}
          </span>
        )}
        {detail && <span className="break-all">{detail}</span>}
      </div>
    </div>
  );
}

function sourceOf(location?: string, t?: (key: string) => string): string | undefined {
  if (!location) return undefined;
  if (location.includes('/builtin/')) return t?.('skills.builtin') ?? 'built-in';
  if (location.includes('/.opencode/')) return t?.('skills.project') ?? 'project';
  return t?.('skills.user') ?? 'user';
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="mt-8 text-center text-sm text-muted">{children}</div>;
}
