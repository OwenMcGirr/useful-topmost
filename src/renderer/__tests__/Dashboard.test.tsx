import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Dashboard from '../Dashboard';
import { TILE_MIN_WIDTH } from '../dashboard-grid';

let resizeCallback: ResizeObserverCallback | null = null;

class ResizeObserverMock {
  callback: ResizeObserverCallback;

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    resizeCallback = callback;
  }

  observe() {}
  disconnect() {}
  unobserve() {}
}

function triggerDashboardResize(width = 880, height = 680) {
  act(() => {
    resizeCallback?.([
      {
        contentRect: {
          width,
          height,
          x: 0,
          y: 0,
          top: 0,
          left: 0,
          right: width,
          bottom: height,
          toJSON: () => ({})
        }
      } as ResizeObserverEntry
    ], {} as ResizeObserver);
  });
}

function widgets(count: number, pinned: string[] = []) {
  return Array.from({ length: count }, (_, index) => ({
    uuid: `widget-${index + 1}`,
    prompt: `widget ${index + 1}`,
    created_at: '',
    pinned: pinned.includes(`widget-${index + 1}`)
  }));
}

function renderedWidgetSrcs(container: HTMLElement) {
  return Array.from(container.querySelectorAll('webview')).map((webview) => webview.getAttribute('src') ?? '');
}

function dashboardTile(container: HTMLElement, uuid: string) {
  return container.querySelector(`[data-dashboard-tile="${uuid}"]`) as HTMLElement;
}

function px(value: string) {
  return Number.parseFloat(value.replace('px', ''));
}

function renderedDashboardTiles(container: HTMLElement) {
  return Array.from(container.querySelectorAll('[data-dashboard-tile]')) as HTMLElement[];
}

function mockApi(opts: { onboardingDismissed?: boolean } = {}) {
  const readyHandlers: Array<(uuid: string) => void> = [];
  const errorHandlers: Array<(uuid: string, msg: string) => void> = [];
  const api = {
    listWidgets: vi.fn(async () => [] as any),
    createWidget: vi.fn(async (_p: string) => ({ uuid: 'new-uuid' })),
    chatStartWidget: vi.fn(async (_p: string) => ({ uuid: 'new-uuid' })),
    chatSendWidget: vi.fn(async () => ({ ok: true })),
    listWidgetChat: vi.fn(async () => []),
    deleteWidget: vi.fn(async () => ({ ok: true })),
    cancelWidget: vi.fn(async () => ({ ok: true })),
    setWidgetPinned: vi.fn(async () => ({ ok: true })),
    setWidgetSize: vi.fn(async () => ({ ok: true })),
    setWidgetProviders: vi.fn(async () => ({ ok: true })),
    setWidgetRefreshTtl: vi.fn(async () => ({ ok: true })),
    getWidgetMeta: vi.fn(async () => ({ prompt: 'p', created_at: '' })),
    getWidgetFetchLog: vi.fn(async () => []),
    htmlUrl: vi.fn(async (u: string) => `file:///${u}/index.html`),
    codexAvailable: vi.fn(async () => true),
    codexStatus: vi.fn(async () => ({ installed: true, authenticated: true })),
    widgetPreloadUrl: vi.fn(async () => 'file:///fake/widget.js'),
    onWidgetReady: vi.fn((cb: any) => {
      readyHandlers.push(cb);
      return () => {
        const idx = readyHandlers.indexOf(cb);
        if (idx >= 0) readyHandlers.splice(idx, 1);
      };
    }),
    onWidgetError: vi.fn((cb: any) => {
      errorHandlers.push(cb);
      return () => {
        const idx = errorHandlers.indexOf(cb);
        if (idx >= 0) errorHandlers.splice(idx, 1);
      };
    }),
    onWidgetPlan: vi.fn(() => () => {}),
    secrets: {
      list: vi.fn(async () => []),
      save: vi.fn(async () => ({ ok: true })),
      delete: vi.fn(async () => ({ ok: true }))
    },
    onboarding: {
      get: vi.fn(async () => ({ dismissed: opts.onboardingDismissed ?? false })),
      dismiss: vi.fn(async () => ({ ok: true }))
    },
    prefs: {
      get: vi.fn(async () => ({ geekMode: false })),
      setGeekMode: vi.fn(async () => ({ ok: true }))
    },
    startup: {
      get: vi.fn(async () => ({ enabled: false, supported: true, platform: 'win32' })),
      setEnabled: vi.fn(async (enabled: boolean) => ({ ok: true, state: { enabled, supported: true, platform: 'win32' } }))
    },
    updates: {
      getState: vi.fn(async () => ({ status: 'idle' })),
      checkNow: vi.fn(async () => ({ status: 'not-available' })),
      restart: vi.fn(async () => undefined),
      onState: vi.fn(() => () => {})
    }
  };
  return {
    api,
    fireReady: (uuid: string) => readyHandlers.forEach((cb) => cb(uuid)),
    fireError: (uuid: string, msg: string) => errorHandlers.forEach((cb) => cb(uuid, msg))
  };
}

beforeEach(() => {
  (window as any).api = undefined;
  resizeCallback = null;
  vi.stubGlobal('ResizeObserver', ResizeObserverMock);
  Object.defineProperty(window, 'innerWidth', { value: 880, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: 680, configurable: true });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Dashboard', () => {
  it('renders a tile per widget returned by listWidgets', async () => {
    const m = mockApi();
    m.api.listWidgets.mockResolvedValueOnce([
      { uuid: 'a', prompt: 'first', created_at: '' },
      { uuid: 'b', prompt: 'second', created_at: '' }
    ]);
    (window as any).api = m.api;

    const { container } = render(<Dashboard />);
    triggerDashboardResize();

    await waitFor(() => expect(container.querySelectorAll('webview').length).toBe(2));
  });

  it('renders all widgets when count is less than or equal to capacity', async () => {
    const m = mockApi({ onboardingDismissed: true });
    m.api.listWidgets.mockResolvedValueOnce(widgets(4));
    (window as any).api = m.api;

    const { container } = render(<Dashboard />);
    triggerDashboardResize();

    await waitFor(() => expect(container.querySelectorAll('webview').length).toBe(4));
    expect(screen.queryByRole('button', { name: /shuffle widgets/i })).toBeNull();
  });

  it('fills the dashboard with one widget', async () => {
    const m = mockApi({ onboardingDismissed: true });
    m.api.listWidgets.mockResolvedValueOnce(widgets(1));
    (window as any).api = m.api;

    const { container } = render(<Dashboard />);
    triggerDashboardResize();

    await waitFor(() => expect(container.querySelectorAll('webview').length).toBe(1));
    const tile = dashboardTile(container, 'widget-1');

    expect(px(tile.style.left)).toBe(12);
    expect(px(tile.style.top)).toBe(12);
    expect(px(tile.style.width)).toBe(856);
    expect(px(tile.style.height)).toBe(656);
  });

  it('fills the dashboard with two widgets', async () => {
    const m = mockApi({ onboardingDismissed: true });
    m.api.listWidgets.mockResolvedValueOnce(widgets(2));
    (window as any).api = m.api;

    const { container } = render(<Dashboard />);
    triggerDashboardResize();

    await waitFor(() => expect(container.querySelectorAll('webview').length).toBe(2));
    const first = dashboardTile(container, 'widget-1');
    const second = dashboardTile(container, 'widget-2');

    expect(px(first.style.height)).toBe(656);
    expect(px(second.style.height)).toBe(656);
    expect(px(first.style.width) + px(second.style.width) + 12).toBe(856);
    expect(px(first.style.width)).toBeGreaterThanOrEqual(TILE_MIN_WIDTH);
    expect(px(second.style.width)).toBeGreaterThanOrEqual(TILE_MIN_WIDTH);
  });

  it('does not keep fewer widgets in a compact centered grid', async () => {
    const m = mockApi({ onboardingDismissed: true });
    m.api.listWidgets.mockResolvedValueOnce(widgets(3));
    (window as any).api = m.api;

    const { container } = render(<Dashboard />);
    triggerDashboardResize();

    await waitFor(() => expect(container.querySelectorAll('webview').length).toBe(3));
    const tiles = ['widget-1', 'widget-2', 'widget-3'].map((uuid) => dashboardTile(container, uuid));
    const rightEdge = Math.max(...tiles.map((tile) => px(tile.style.left) + px(tile.style.width)));
    const bottomEdge = Math.max(...tiles.map((tile) => px(tile.style.top) + px(tile.style.height)));

    expect(rightEdge).toBe(868);
    expect(bottomEdge).toBe(668);
    expect(tiles.every((tile) => px(tile.style.width) >= TILE_MIN_WIDTH)).toBe(true);
  });

  it('renders only capacity widgets when widget count exceeds capacity', async () => {
    const m = mockApi({ onboardingDismissed: true });
    m.api.listWidgets.mockResolvedValueOnce(widgets(5));
    (window as any).api = m.api;

    const { container } = render(<Dashboard />);
    triggerDashboardResize();

    await waitFor(() => expect(container.querySelectorAll('webview').length).toBe(4));
    expect(container.querySelectorAll('webview').length).not.toBe(5);
    expect(screen.getByRole('button', { name: /shuffle widgets/i })).toBeInTheDocument();
  });

  it('shows a visible-count badge when tiles exceed capacity', async () => {
    const m = mockApi({ onboardingDismissed: true });
    m.api.listWidgets.mockResolvedValueOnce(widgets(7));
    (window as any).api = m.api;

    const { container } = render(<Dashboard />);
    triggerDashboardResize();
    await waitFor(() => expect(container.querySelectorAll('webview').length).toBe(4));

    expect(screen.getByLabelText(/visible widgets/i).textContent).toBe('4 of 7');
  });

  it('fills the final page when it has fewer widgets than capacity', async () => {
    const m = mockApi({ onboardingDismissed: true });
    m.api.listWidgets.mockResolvedValueOnce(widgets(7));
    (window as any).api = m.api;

    const { container } = render(<Dashboard />);
    triggerDashboardResize();
    await waitFor(() => expect(container.querySelectorAll('webview').length).toBe(4));

    await userEvent.click(screen.getByRole('button', { name: /next page/i }));
    await waitFor(() => expect(container.querySelectorAll('webview').length).toBe(3));
    const tiles = ['widget-5', 'widget-6', 'widget-7'].map((uuid) => dashboardTile(container, uuid));
    const rightEdge = Math.max(...tiles.map((tile) => px(tile.style.left) + px(tile.style.width)));
    const bottomEdge = Math.max(...tiles.map((tile) => px(tile.style.top) + px(tile.style.height)));

    expect(rightEdge).toBe(868);
    expect(bottomEdge).toBe(668);
    expect(tiles.every((tile) => px(tile.style.width) >= TILE_MIN_WIDTH)).toBe(true);
  });

  it('next-page button advances to a deterministic slice of the unpinned tiles', async () => {
    const m = mockApi({ onboardingDismissed: true });
    m.api.listWidgets.mockResolvedValueOnce(widgets(8));
    (window as any).api = m.api;

    const { container } = render(<Dashboard />);
    triggerDashboardResize();
    await waitFor(() => expect(container.querySelectorAll('webview').length).toBe(4));

    await userEvent.click(screen.getByRole('button', { name: /next page/i }));
    await waitFor(() => expect(container.querySelectorAll('webview').length).toBe(4));
    const page1 = renderedWidgetSrcs(container);

    await userEvent.click(screen.getByRole('button', { name: /next page/i }));
    await waitFor(() => {
      const current = renderedWidgetSrcs(container);
      expect(current).not.toEqual(page1);
    });
    const page0 = renderedWidgetSrcs(container);

    expect(new Set([...page0, ...page1]).size).toBe(8);
  });

  it('clicking shuffle changes the visible set when another set is possible', async () => {
    const m = mockApi({ onboardingDismissed: true });
    m.api.listWidgets.mockResolvedValueOnce(widgets(5));
    (window as any).api = m.api;

    const { container } = render(<Dashboard />);
    triggerDashboardResize();
    await waitFor(() => expect(container.querySelectorAll('webview').length).toBe(4));
    const before = renderedWidgetSrcs(container);

    await userEvent.click(screen.getByRole('button', { name: /shuffle widgets/i }));

    await waitFor(() => expect(renderedWidgetSrcs(container)).not.toEqual(before));
  });

  it('auto-rotates the visible widget set after 60 seconds', async () => {
    let intervalCallback: TimerHandler | undefined;
    const intervalSpy = vi.spyOn(window, 'setInterval').mockImplementation((handler: TimerHandler, timeout?: number) => {
      if (timeout === 60_000) intervalCallback = handler;
      return 1;
    });
    const clearSpy = vi.spyOn(window, 'clearInterval').mockImplementation(() => undefined);
    const m = mockApi({ onboardingDismissed: true });
    m.api.listWidgets.mockResolvedValueOnce(widgets(5));
    (window as any).api = m.api;

    const { container } = render(<Dashboard />);
    triggerDashboardResize();
    await waitFor(() => expect(container.querySelectorAll('webview').length).toBe(4));
    const before = renderedWidgetSrcs(container);
    expect(intervalSpy).toHaveBeenCalledWith(expect.any(Function), 60_000);
    const random = vi.spyOn(Math, 'random')
      .mockReturnValueOnce(0.9)
      .mockReturnValueOnce(0.8)
      .mockReturnValueOnce(0.7)
      .mockReturnValueOnce(0.6);

    act(() => {
      if (typeof intervalCallback === 'function') intervalCallback();
    });

    await waitFor(() => expect(renderedWidgetSrcs(container)).not.toEqual(before));
    random.mockRestore();
    clearSpy.mockRestore();
  });

  it('hidden widgets are not deleted', async () => {
    const m = mockApi({ onboardingDismissed: true });
    m.api.listWidgets.mockResolvedValueOnce(widgets(5));
    (window as any).api = m.api;

    const { container } = render(<Dashboard />);
    triggerDashboardResize();

    await waitFor(() => expect(container.querySelectorAll('webview').length).toBe(4));
    expect(m.api.deleteWidget).not.toHaveBeenCalled();
  });

  it('loads pinned state and keeps pinned widgets visible when overflowing', async () => {
    const m = mockApi({ onboardingDismissed: true });
    m.api.listWidgets.mockResolvedValueOnce(widgets(5, ['widget-5']));
    (window as any).api = m.api;

    const { container } = render(<Dashboard />);
    triggerDashboardResize();

    await waitFor(() => expect(renderedWidgetSrcs(container).some((src) => src.includes('widget-5'))).toBe(true));
    expect(screen.getAllByRole('button', { name: 'Unpin' })).toHaveLength(1);
  });

  it('shuffle changes only unpinned filler when pinned widgets fit', async () => {
    const m = mockApi({ onboardingDismissed: true });
    m.api.listWidgets.mockResolvedValueOnce(widgets(5, ['widget-5']));
    (window as any).api = m.api;

    const { container } = render(<Dashboard />);
    triggerDashboardResize();
    await waitFor(() => expect(container.querySelectorAll('webview').length).toBe(4));
    const before = renderedWidgetSrcs(container);
    expect(before.some((src) => src.includes('widget-5'))).toBe(true);

    await userEvent.click(screen.getByRole('button', { name: /shuffle widgets/i }));

    await waitFor(() => {
      const after = renderedWidgetSrcs(container);
      expect(after).not.toEqual(before);
      expect(after.some((src) => src.includes('widget-5'))).toBe(true);
    });
  });

  it('auto-rotation keeps pinned widgets visible when pinned widgets fit', async () => {
    let intervalCallback: TimerHandler | undefined;
    vi.spyOn(window, 'setInterval').mockImplementation((handler: TimerHandler, timeout?: number) => {
      if (timeout === 60_000) intervalCallback = handler;
      return 1;
    });
    vi.spyOn(window, 'clearInterval').mockImplementation(() => undefined);
    const m = mockApi({ onboardingDismissed: true });
    m.api.listWidgets.mockResolvedValueOnce(widgets(5, ['widget-5']));
    (window as any).api = m.api;

    const { container } = render(<Dashboard />);
    triggerDashboardResize();
    await waitFor(() => expect(container.querySelectorAll('webview').length).toBe(4));

    act(() => {
      if (typeof intervalCallback === 'function') intervalCallback();
    });

    await waitFor(() => expect(renderedWidgetSrcs(container).some((src) => src.includes('widget-5'))).toBe(true));
  });

  it('shows only pinned widgets when pinned widgets exceed capacity', async () => {
    const m = mockApi({ onboardingDismissed: true });
    m.api.listWidgets.mockResolvedValueOnce(widgets(5, ['widget-1', 'widget-2', 'widget-3', 'widget-4', 'widget-5']));
    (window as any).api = m.api;

    const { container } = render(<Dashboard />);
    triggerDashboardResize(464, 364);

    await waitFor(() => expect(container.querySelectorAll('webview').length).toBe(1));
    expect(screen.queryAllByRole('button', { name: 'Pin' })).toHaveLength(0);
  });

  it('clicking pin and unpin persists and updates tile state', async () => {
    const m = mockApi({ onboardingDismissed: true });
    m.api.listWidgets.mockResolvedValueOnce(widgets(1));
    (window as any).api = m.api;

    render(<Dashboard />);

    await userEvent.click(await screen.findByRole('button', { name: 'Pin' }));
    expect(m.api.setWidgetPinned).toHaveBeenCalledWith('widget-1', true);
    expect(await screen.findByRole('button', { name: 'Unpin' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Unpin' }));
    expect(m.api.setWidgetPinned).toHaveBeenCalledWith('widget-1', false);
    expect(await screen.findByRole('button', { name: 'Pin' })).toBeInTheDocument();
  });

  it('cycling widget size changes layout weight optimistically', async () => {
    const m = mockApi({ onboardingDismissed: true });
    m.api.listWidgets.mockResolvedValueOnce(widgets(2));
    (window as any).api = m.api;

    const { container } = render(<Dashboard />);
    triggerDashboardResize();
    await waitFor(() => expect(container.querySelectorAll('webview').length).toBe(2));
    const before = px(dashboardTile(container, 'widget-1').style.width);

    await userEvent.click(screen.getAllByRole('button', { name: /size 1/i })[0]);

    await waitFor(() => expect(px(dashboardTile(container, 'widget-1').style.width)).toBeGreaterThan(before));
    expect(m.api.setWidgetSize).toHaveBeenCalledWith('widget-1', 'wide');
    expect(renderedDashboardTiles(container).every((tile) => px(tile.style.width) >= TILE_MIN_WIDTH)).toBe(true);
  });

  it('keeps mixed widget sizes at least the minimum width', async () => {
    const m = mockApi({ onboardingDismissed: true });
    m.api.listWidgets.mockResolvedValueOnce([
      { uuid: 'large', prompt: 'large', created_at: '', size: 'large' },
      { uuid: 'small-1', prompt: 'small 1', created_at: '' },
      { uuid: 'small-2', prompt: 'small 2', created_at: '' }
    ]);
    (window as any).api = m.api;

    const { container } = render(<Dashboard />);
    triggerDashboardResize(1200, 800);

    await waitFor(() => expect(container.querySelectorAll('webview').length).toBe(3));
    expect(renderedDashboardTiles(container).every((tile) => px(tile.style.width) >= TILE_MIN_WIDTH)).toBe(true);
  });

  it('failed size cycle rolls back the weighted layout', async () => {
    const m = mockApi({ onboardingDismissed: true });
    m.api.listWidgets.mockResolvedValueOnce(widgets(2));
    m.api.setWidgetSize.mockRejectedValueOnce(new Error('nope'));
    (window as any).api = m.api;

    const { container } = render(<Dashboard />);
    triggerDashboardResize();
    await waitFor(() => expect(container.querySelectorAll('webview').length).toBe(2));
    const before = px(dashboardTile(container, 'widget-1').style.width);

    await userEvent.click(screen.getAllByRole('button', { name: /size 1/i })[0]);

    await waitFor(() => expect(px(dashboardTile(container, 'widget-1').style.width)).toBe(before));
  });

  it('failed pin IPC reverts tile state', async () => {
    const m = mockApi({ onboardingDismissed: true });
    m.api.listWidgets.mockResolvedValueOnce(widgets(1));
    m.api.setWidgetPinned.mockRejectedValueOnce(new Error('nope'));
    (window as any).api = m.api;

    render(<Dashboard />);

    await userEvent.click(await screen.findByRole('button', { name: 'Pin' }));

    expect(await screen.findByRole('button', { name: 'Pin' })).toBeInTheDocument();
  });

  it('building tile can be pinned', async () => {
    const m = mockApi();
    (window as any).api = m.api;

    render(<Dashboard />);
    await userEvent.click(await screen.findByRole('button', { name: /new widget/i }));
    await userEvent.type(screen.getByLabelText(/widget message/i), 'show weather');
    await userEvent.click(screen.getByRole('button', { name: /send/i }));
    await userEvent.click(await screen.findByRole('button', { name: 'Pin' }));

    expect(m.api.setWidgetPinned).toHaveBeenCalledWith('new-uuid', true);
  });

  it('error tile can be pinned', async () => {
    const m = mockApi();
    (window as any).api = m.api;

    render(<Dashboard />);
    await userEvent.click(await screen.findByRole('button', { name: /new widget/i }));
    await userEvent.type(screen.getByLabelText(/widget message/i), 'p');
    await userEvent.click(screen.getByRole('button', { name: /send/i }));
    m.fireError('new-uuid', 'boom');

    await userEvent.click(await screen.findByRole('button', { name: 'Pin' }));

    expect(m.api.setWidgetPinned).toHaveBeenCalledWith('new-uuid', true);
  });

  it('+ button opens chat panel; sending calls chatStartWidget and adds a building tile', async () => {
    const m = mockApi();
    (window as any).api = m.api;

    render(<Dashboard />);
    await screen.findByRole('button', { name: /new widget/i });

    await userEvent.click(screen.getByRole('button', { name: /new widget/i }));
    expect(screen.getByRole('heading', { name: /new widget/i })).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(/widget message/i), 'show weather');
    await userEvent.click(screen.getByRole('button', { name: /send/i }));

    expect(m.api.chatStartWidget).toHaveBeenCalledWith('show weather', [], 3_600_000);
    expect(await screen.findByText(/building widget/i)).toBeInTheDocument();
  });

  it('flips tile from building to live on widget:ready', async () => {
    const m = mockApi();
    (window as any).api = m.api;

    const { container } = render(<Dashboard />);
    await screen.findByRole('button', { name: /new widget/i });

    await userEvent.click(screen.getByRole('button', { name: /new widget/i }));
    await userEvent.type(screen.getByLabelText(/widget message/i), 'p');
    await userEvent.click(screen.getByRole('button', { name: /send/i }));

    m.fireReady('new-uuid');

    await waitFor(() => expect(container.querySelector('webview')).not.toBeNull());
  });

  it('flips new tile from building to error on widget:error', async () => {
    const m = mockApi();
    (window as any).api = m.api;

    render(<Dashboard />);
    await screen.findByRole('button', { name: /new widget/i });

    await userEvent.click(screen.getByRole('button', { name: /new widget/i }));
    await userEvent.type(screen.getByLabelText(/widget message/i), 'p');
    await userEvent.click(screen.getByRole('button', { name: /send/i }));

    m.fireError('new-uuid', 'boom');

    // 'boom' doesn't match a known pattern, so the tile shows the default
    // friendly title. Raw stderr is hidden until "See details" is clicked.
    expect(await screen.findByText(/widget generation failed/i)).toBeInTheDocument();
  });

  it('renders a gear button that opens Settings', async () => {
    const m = mockApi();
    (window as any).api = m.api;

    render(<Dashboard />);

    await userEvent.click(await screen.findByRole('button', { name: /settings/i }));
    expect(await screen.findByRole('heading', { name: /settings/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /api providers/i })).toBeInTheDocument();
  });

  it('renders dashboard controls dock with Settings and New widget controls', async () => {
    const m = mockApi();
    (window as any).api = m.api;

    render(<Dashboard />);

    expect(await screen.findByRole('group', { name: /dashboard controls/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /settings/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /new widget/i })).toBeInTheDocument();
  });

  it('reveals dashboard controls when the pointer enters the reveal zone', async () => {
    vi.useFakeTimers();
    const m = mockApi({ onboardingDismissed: true });
    (window as any).api = m.api;

    render(<Dashboard />);
    const controls = screen.getByRole('group', { name: /dashboard controls/i });
    const dock = controls.querySelector('[data-visible]') as HTMLElement;
    expect(dock).toHaveAttribute('data-visible', 'true');

    act(() => {
      vi.advanceTimersByTime(1800);
    });
    expect(dock).toHaveAttribute('data-visible', 'false');

    fireEvent.pointerEnter(controls);

    expect(dock).toHaveAttribute('data-visible', 'true');
  });

  it('existing live tile opens chat and sends edits without replacing the live tile immediately', async () => {
    const m = mockApi({ onboardingDismissed: true });
    m.api.listWidgets.mockResolvedValueOnce([
      { uuid: 'a', prompt: 'clock', created_at: '' }
    ]);
    (window as any).api = m.api;

    const { container } = render(<Dashboard />);
    await waitFor(() => expect(container.querySelectorAll('webview').length).toBe(1));

    await userEvent.click(screen.getByRole('button', { name: 'Edit with chat' }));
    expect(await screen.findByRole('heading', { name: /edit widget/i })).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(/widget message/i), 'make it blue');
    await userEvent.click(screen.getByRole('button', { name: /send/i }));

    expect(m.api.chatSendWidget).toHaveBeenCalledWith('a', 'make it blue');
    expect(container.querySelectorAll('webview').length).toBe(1);
    expect(screen.getByText(/building preview/i)).toBeInTheDocument();
  });

  it('widget:ready for edited uuid refreshes same tile', async () => {
    const m = mockApi({ onboardingDismissed: true });
    m.api.listWidgets.mockResolvedValueOnce([
      { uuid: 'a', prompt: 'clock', created_at: '' }
    ]);
    (window as any).api = m.api;

    const { container } = render(<Dashboard />);
    await waitFor(() => expect(container.querySelectorAll('webview').length).toBe(1));

    m.fireReady('a');

    await waitFor(() => expect(renderedWidgetSrcs(container).some((src) => src.includes('rev='))).toBe(true));
  });

  it('shows the welcome overlay when tiles are empty and onboarding is not dismissed', async () => {
    const m = mockApi({ onboardingDismissed: false });
    (window as any).api = m.api;

    render(<Dashboard />);

    expect(await screen.findByText(/welcome to useful-topmost/i)).toBeInTheDocument();
  });

  it('does not show the welcome overlay when there are widgets', async () => {
    const m = mockApi({ onboardingDismissed: false });
    m.api.listWidgets.mockResolvedValueOnce([
      { uuid: 'a', prompt: 'clock', created_at: '' }
    ]);
    (window as any).api = m.api;

    const { container } = render(<Dashboard />);
    await waitFor(() => expect(container.querySelectorAll('webview').length).toBe(1));
    expect(screen.queryByText(/welcome to useful-topmost/i)).toBeNull();
  });

  it('does not show the welcome overlay when onboarding is already dismissed', async () => {
    const m = mockApi({ onboardingDismissed: true });
    (window as any).api = m.api;

    render(<Dashboard />);

    expect(await screen.findByText(/no widgets yet/i)).toBeInTheDocument();
    expect(screen.queryByText(/welcome to useful-topmost/i)).toBeNull();
  });

  it('clicking an example chip persists dismissal and opens chat pre-filled', async () => {
    const m = mockApi({ onboardingDismissed: false });
    (window as any).api = m.api;

    render(<Dashboard />);

    const chipText = "a digital clock showing local time, updating every second";
    await userEvent.click(await screen.findByText(chipText));

    await waitFor(() => expect(m.api.onboarding.dismiss).toHaveBeenCalled());
    const input = screen.getByLabelText(/widget message/i) as HTMLTextAreaElement;
    expect(input.value).toBe(chipText);
  });

  it('pressing N opens the new-widget chat', async () => {
    const m = mockApi({ onboardingDismissed: true });
    (window as any).api = m.api;

    render(<Dashboard />);
    await screen.findByText(/no widgets yet/i);

    await userEvent.keyboard('n');

    expect(await screen.findByLabelText(/widget message/i)).toBeInTheDocument();
  });

  it('pressing Escape closes the open chat panel', async () => {
    const m = mockApi({ onboardingDismissed: true });
    (window as any).api = m.api;

    render(<Dashboard />);
    await screen.findByText(/no widgets yet/i);

    await userEvent.keyboard('n');
    expect(await screen.findByLabelText(/widget message/i)).toBeInTheDocument();

    await userEvent.keyboard('{Escape}');
    expect(screen.queryByLabelText(/widget message/i)).toBeNull();
  });

  it('pressing Ctrl+, opens the settings modal', async () => {
    const m = mockApi({ onboardingDismissed: true });
    (window as any).api = m.api;

    render(<Dashboard />);
    await screen.findByText(/no widgets yet/i);

    await userEvent.keyboard('{Control>},{/Control}');

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('clicking Dismiss persists and hides the overlay without opening chat', async () => {
    const m = mockApi({ onboardingDismissed: false });
    (window as any).api = m.api;

    render(<Dashboard />);
    await screen.findByText(/welcome to useful-topmost/i);

    await userEvent.click(screen.getByRole('button', { name: /dismiss/i }));

    await waitFor(() => expect(m.api.onboarding.dismiss).toHaveBeenCalled());
    expect(screen.queryByText(/welcome to useful-topmost/i)).toBeNull();
    expect(screen.queryByLabelText(/widget message/i)).toBeNull();
  });
});
