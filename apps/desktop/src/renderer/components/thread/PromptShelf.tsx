import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';

/**
 * Shared card layout for decision surfaces (question & permission).
 * Inspired by Reasonix's PromptShelf pattern.
 *
 * Provides consistent header + body + footer structure.
 */
export function PromptShelf({
  icon,
  title,
  subtitle,
  tone = 'accent',
  headerRight,
  children,
  footer,
}: {
  icon: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  tone?: 'accent' | 'warn' | 'error';
  headerRight?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const borderColor = {
    accent: 'border-accent/40',
    warn: 'border-warn/40',
    error: 'border-error/40',
  }[tone];

  return (
    <div className={cn('rounded-card border bg-surface shadow-card', borderColor)}>
      <header className="flex items-center gap-2 border-b border-border px-4 py-2.5">
        <span className="shrink-0">{icon}</span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-text">{title}</div>
          {subtitle && <div className="text-xs text-muted">{subtitle}</div>}
        </div>
        {headerRight}
      </header>
      {children && <div className="px-4 py-3">{children}</div>}
      {footer && (
        <footer className="flex items-center gap-2 border-t border-border px-4 py-2.5">
          {footer}
        </footer>
      )}
    </div>
  );
}
