import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { FencePreview } from './FencePreview';

// echarts is loaded lazily by the preview; intercept the dynamic import so
// jsdom never touches canvas/zrender internals.
const { initMock, chartMocks } = vi.hoisted(() => ({
  initMock: vi.fn(),
  chartMocks: [] as { setOption: ReturnType<typeof vi.fn> }[],
}));
vi.mock('echarts', () => ({ init: initMock }));

const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>';

beforeEach(() => {
  initMock.mockReset();
  chartMocks.length = 0;
  initMock.mockImplementation(() => {
    const chart = { setOption: vi.fn(), resize: vi.fn(), dispose: vi.fn() };
    chartMocks.push(chart);
    return chart;
  });
});

describe('FencePreview', () => {
  it('renders a closed html fence as a sandboxed iframe', () => {
    const { container } = render(
      <FencePreview language="html" content="<p>hi</p>" closed streaming={false} />,
    );
    const iframe = container.querySelector('iframe');
    expect(iframe).not.toBeNull();
    expect(iframe?.getAttribute('sandbox')).toBe('allow-scripts');
    expect(iframe?.getAttribute('srcdoc')).toBe('<p>hi</p>');
    // The raw source never shows as thread text.
    expect(screen.queryByText('<p>hi</p>')).toBeNull();
  });

  it('shows a pending card for an open fence that is still streaming', () => {
    const { container } = render(
      <FencePreview language="html" content="<p>half" closed={false} streaming />,
    );
    expect(screen.getByText('正在生成预览…')).toBeDefined();
    expect(container.querySelector('iframe')).toBeNull();
    expect(container.querySelector('pre')).toBeNull();
  });

  it('falls back to a code block when the message ended inside the fence', () => {
    const { container } = render(
      <FencePreview language="html" content="<p>half" closed={false} streaming={false} />,
    );
    expect(container.querySelector('pre')).not.toBeNull();
    expect(container.textContent).toContain('<p>half');
  });

  it('renders a valid svg fence as an <img> data URI', () => {
    const { container } = render(
      <FencePreview language="svg" content={SVG} closed streaming={false} />,
    );
    const img = container.querySelector('img');
    expect(img).not.toBeNull();
    expect(img?.getAttribute('src')?.startsWith('data:image/svg+xml;charset=utf-8,')).toBe(true);
    expect(img?.getAttribute('src')).toContain('%3Csvg');
  });

  it('strips an xml prolog before encoding an svg', () => {
    const { container } = render(
      <FencePreview
        language="svg"
        content={'<?xml version="1.0"?>' + SVG}
        closed
        streaming={false}
      />,
    );
    const src = container.querySelector('img')?.getAttribute('src') ?? '';
    expect(src).not.toContain('<?xml');
    expect(src).toContain('%3Csvg');
  });

  it('falls back to a code block for an invalid svg', () => {
    const { container } = render(
      <FencePreview language="svg" content="not svg at all" closed streaming={false} />,
    );
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('pre')).not.toBeNull();
  });

  it('initializes echarts once with the parsed option', async () => {
    render(
      <FencePreview
        language="echarts"
        content={'{"title":{"text":"t"}}'}
        closed
        streaming={false}
      />,
    );
    await waitFor(() => expect(initMock).toHaveBeenCalledTimes(1));
    expect(chartMocks[0].setOption).toHaveBeenCalledWith(
      { title: { text: 't' } },
      { notMerge: true },
    );
  });

  it('falls back to a code block for invalid echarts JSON and never inits', () => {
    const { container } = render(
      <FencePreview language="echarts" content="title: t, // not json" closed streaming={false} />,
    );
    expect(container.querySelector('pre')).not.toBeNull();
    expect(initMock).not.toHaveBeenCalled();
  });
});
