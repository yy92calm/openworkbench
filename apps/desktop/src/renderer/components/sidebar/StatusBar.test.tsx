import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { useRuntimeStore } from '@/lib/runtime';

import { StatusBar } from './StatusBar';

afterEach(() => {
  useRuntimeStore.setState({ sandbox: null });
});

describe('StatusBar sandbox segment', () => {
  it('stays hidden until the first IPC status lands', () => {
    render(<StatusBar />);
    expect(screen.queryByText(/沙盒/)).toBeNull();
  });

  it('shows an enforced sandbox with its mode', () => {
    useRuntimeStore.setState({
      sandbox: {
        platform: 'seatbelt',
        config: { mode: 'workspace-write', network: 'open', required: false },
        effective: true,
        detail: 'Seatbelt sandbox active',
      },
    });
    render(<StatusBar />);
    expect(screen.getByText('沙盒 workspace-write')).toBeInTheDocument();
    expect(screen.getByTitle('Seatbelt sandbox active')).toBeInTheDocument();
  });

  it('flags a silent fallback as 未生效', () => {
    useRuntimeStore.setState({
      sandbox: {
        platform: 'unsupported',
        config: { mode: 'workspace-write', network: 'open', required: false },
        effective: false,
        detail: 'OS-level sandbox is not supported on win32',
      },
    });
    render(<StatusBar />);
    expect(screen.getByText('沙盒 workspace-write 未生效')).toBeInTheDocument();
    expect(screen.getByTitle('OS-level sandbox is not supported on win32')).toBeInTheDocument();
  });

  it('shows full-access as deliberately configured, not broken', () => {
    useRuntimeStore.setState({
      sandbox: {
        platform: 'seatbelt',
        config: { mode: 'full-access', network: 'open', required: false },
        effective: false,
        detail: 'full-access mode, sandbox disabled',
      },
    });
    render(<StatusBar />);
    expect(screen.getByText('沙盒 full-access')).toBeInTheDocument();
    expect(screen.queryByText(/未生效/)).toBeNull();
  });
});
