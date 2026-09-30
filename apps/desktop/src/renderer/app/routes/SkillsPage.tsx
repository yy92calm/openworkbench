import type { AggregatedSkill, SkillsConfig } from '@workbench/shared';
import { Bot, FolderPlus, Puzzle, Save, Server, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

import { cn } from '@/lib/cn';
import { useI18n } from '@/lib/i18n';
import { useRuntimeStore } from '@/lib/runtime';
import {
  skillsAddSource,
  skillsApplyScheme,
  skillsConfig,
  skillsDeleteScheme,
  skillsList,
  skillsPickSource,
  skillsRemoveSource,
  skillsSaveScheme,
  skillsSchemes,
  skillsSetEnabled,
} from '@/lib/tauri';
import { toast } from '@/lib/toast';

type Tab = 'agents' | 'skills' | 'mcp' | 'sources';

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

const ghostButton =
  'flex shrink-0 items-center gap-1.5 rounded-input border border-border bg-surface px-3 py-1.5 text-[13px] text-text transition-colors hover:bg-surface-2 disabled:opacity-50';
const textField =
  'min-w-0 flex-1 rounded-input border border-border-soft bg-bg px-2.5 py-1.5 text-[13px] text-text outline-none placeholder:text-muted focus:border-accent/40';

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
              <TabButton active={tab === 'sources'} onClick={() => setTab('sources')}>
                <FolderPlus size={14} /> 来源与方案
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

            {tab === 'sources' && <SkillSourcesPanel />}
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

/**
 * External skill sources: scan folders the user chooses, enable individual
 * skills (linked into the deployed profile), and save/switch named groups.
 * The links are re-created on every profile deploy, so this panel only manages
 * the registry — the deployed profile is a mirror that gets pruned.
 */
function SkillSourcesPanel() {
  const [config, setConfig] = useState<SkillsConfig | null>(null);
  const [skills, setSkills] = useState<AggregatedSkill[]>([]);
  const [schemes, setSchemes] = useState<string[]>([]);
  const [schemeName, setSchemeName] = useState('');
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const [cfg, list, saved] = await Promise.all([skillsConfig(), skillsList(), skillsSchemes()]);
    setConfig(cfg);
    setSkills(list);
    setSchemes(saved);
  }, []);

  useEffect(() => {
    void refresh().catch((err) => toast.error(`无法读取技能配置：${messageOf(err)}`));
  }, [refresh]);

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await action();
      await refresh();
    } catch (err) {
      toast.error(messageOf(err));
    } finally {
      setBusy(false);
    }
  };

  const enabledNames = skills.filter((s) => s.enabled).map((s) => s.name);

  const addSource = () =>
    void run(async () => {
      const dir = await skillsPickSource();
      if (dir) await skillsAddSource(dir);
    });

  return (
    <div className="mt-5 space-y-4">
      <section className="rounded-card border border-border bg-surface p-5">
        <header className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-medium text-text">来源目录</h2>
            <p className="mt-0.5 text-xs text-muted">
              扫描这些文件夹里的技能（最多两层，如 group/skill）；启用后以软链接挂进已部署的
              profile，重启后自动重建。
            </p>
          </div>
          <button className={ghostButton} onClick={addSource} disabled={busy}>
            <FolderPlus size={13} />
            添加来源
          </button>
        </header>
        {config && config.sources.length > 0 ? (
          <ul className="mt-3 space-y-1.5">
            {config.sources.map((source) => (
              <li
                key={source}
                className="flex items-center gap-2 rounded-input bg-surface-2 px-2.5 py-1.5"
              >
                <span className="min-w-0 flex-1 truncate font-mono text-xs text-text">
                  {source}
                </span>
                <button
                  className="shrink-0 rounded p-0.5 text-muted hover:text-error disabled:opacity-40"
                  aria-label={`移除来源 ${source}`}
                  disabled={busy}
                  onClick={() => void run(() => skillsRemoveSource(source))}
                >
                  <X size={12} />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-xs text-muted">还没有来源目录。</p>
        )}
      </section>

      <section className="rounded-card border border-border bg-surface p-5">
        <h2 className="text-sm font-medium text-text">聚合技能（{skills.length}）</h2>
        {skills.length === 0 ? (
          <p className="mt-3 text-xs text-muted">来源目录中还没有发现技能。</p>
        ) : (
          <ul className="mt-3 space-y-1.5">
            {skills.map((skill) => (
              <li
                key={skill.name}
                className="flex items-center gap-2 rounded-input border border-border-soft px-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-[13px] text-text">{skill.name}</span>
                    {skill.conflict && (
                      <span className="shrink-0 rounded-full bg-warn/15 px-1.5 py-0.5 text-[10px] text-warn">
                        多来源重复
                      </span>
                    )}
                  </div>
                  <div className="truncate text-[11px] text-muted">
                    {skill.description || '无描述'} · {skill.sources.length} 个来源
                  </div>
                </div>
                <button
                  className={cn(
                    'shrink-0 rounded-input px-2.5 py-1 text-[12px] transition-colors disabled:opacity-40',
                    skill.enabled
                      ? 'bg-accent text-accent-fg'
                      : 'border border-border text-muted hover:text-text',
                  )}
                  disabled={busy || skill.conflict}
                  title={skill.conflict ? '在多个来源中重复，无法启用' : undefined}
                  onClick={() => void run(() => skillsSetEnabled(skill.name, !skill.enabled))}
                >
                  {skill.enabled ? '已启用' : '启用'}
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-card border border-border bg-surface p-5">
        <h2 className="text-sm font-medium text-text">方案</h2>
        <p className="mt-0.5 text-xs text-muted">
          把当前启用的一组技能存成方案，之后可一键切换（当前启用 {enabledNames.length} 个）。
        </p>
        <div className="mt-3 flex gap-2">
          <input
            value={schemeName}
            onChange={(e) => setSchemeName(e.target.value)}
            placeholder="方案名（如 日常 / 复盘）"
            className={textField}
          />
          <button
            className={ghostButton}
            disabled={busy || !schemeName.trim() || enabledNames.length === 0}
            onClick={() =>
              void run(async () => {
                await skillsSaveScheme(schemeName.trim(), enabledNames);
                setSchemeName('');
              })
            }
          >
            <Save size={13} />
            保存当前
          </button>
        </div>
        {schemes.length > 0 ? (
          <ul className="mt-3 space-y-1.5">
            {schemes.map((name) => (
              <li
                key={name}
                className="flex items-center gap-2 rounded-input border border-border-soft px-3 py-1.5"
              >
                <span className="min-w-0 flex-1 truncate text-[13px] text-text">{name}</span>
                <button
                  className="shrink-0 rounded-input border border-border px-2.5 py-1 text-[12px] text-text transition-colors hover:bg-surface-2 disabled:opacity-40"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      const result = await skillsApplyScheme(name);
                      if (result.skipped.length > 0) {
                        toast.error(`未生效：${result.skipped.join('、')}`);
                      }
                    })
                  }
                >
                  应用
                </button>
                <button
                  className="shrink-0 rounded p-0.5 text-muted hover:text-error disabled:opacity-40"
                  aria-label={`删除方案 ${name}`}
                  disabled={busy}
                  onClick={() => void run(() => skillsDeleteScheme(name))}
                >
                  <X size={12} />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-xs text-muted">还没有方案。</p>
        )}
      </section>
    </div>
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
