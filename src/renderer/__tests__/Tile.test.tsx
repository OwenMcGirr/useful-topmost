import { afterEach, describe, it, expect, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Tile from '../Tile';

describe('Tile', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('shows building spinner when state is building', () => {
    render(
      <Tile
        uuid="u1"
        prompt="show weather"
        state={{ kind: 'building' }}
        htmlUrl=""
        widgetPreloadUrl=""
        onRefresh={() => {}}
        onDismiss={() => {}}
        onEditChat={() => {}}
        onTogglePinned={() => {}}
        onCycleSize={() => {}}
        onCancel={() => {}}
        onRetry={() => {}}
      />
    );
    expect(screen.getByText(/Building widget…/i)).toBeInTheDocument();
  });

  it('building tile shows a Cancel button that calls onCancel', async () => {
    const onCancel = vi.fn();
    render(
      <Tile
        uuid="u1"
        prompt="show weather"
        state={{ kind: 'building' }}
        htmlUrl=""
        widgetPreloadUrl=""
        onRefresh={() => {}}
        onDismiss={() => {}}
        onEditChat={() => {}}
        onTogglePinned={() => {}}
        onCycleSize={() => {}}
        onCancel={onCancel}
        onRetry={() => {}}
      />
    );
    await userEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalled();
  });

  it('renders the webview when state is live', () => {
    const { container } = render(
      <Tile
        uuid="u1"
        prompt="show weather"
        state={{ kind: 'live' }}
        htmlUrl="file:///path/index.html"
        widgetPreloadUrl=""
        onRefresh={() => {}}
        onDismiss={() => {}}
        onEditChat={() => {}}
        onTogglePinned={() => {}}
        onCycleSize={() => {}}
        onCancel={() => {}}
        onRetry={() => {}}
      />
    );
    const wv = container.querySelector('webview');
    expect(wv).not.toBeNull();
    expect(wv!.getAttribute('src')).toBe('file:///path/index.html');
  });

  it('renders bottom strip with summary name and updated-at time after load', async () => {
    const { container } = render(
      <Tile
        uuid="u1"
        prompt="show weather"
        state={{ kind: 'live' }}
        htmlUrl="file:///path/index.html"
        widgetPreloadUrl=""
        summary={{ name: 'Local Weather', sources: ['Open-Meteo'] }}
        refreshTtlMs={300_000}
        onRefresh={() => {}}
        onDismiss={() => {}}
        onEditChat={() => {}}
        onTogglePinned={() => {}}
        onCycleSize={() => {}}
        onCancel={() => {}}
        onRetry={() => {}}
      />
    );
    const strip = screen.getByLabelText('Widget details');
    expect(strip).toHaveTextContent('Local Weather');
    expect(strip).toHaveTextContent('Loading…');
    container.querySelector('webview')?.dispatchEvent(new Event('did-finish-load'));
    await waitFor(() => expect(strip).toHaveTextContent(/Updated at/));
  });

  it('bottom strip falls back to prompt', () => {
    render(
      <Tile
        uuid="u1"
        prompt="show weather"
        state={{ kind: 'live' }}
        htmlUrl="file:///path/index.html"
        widgetPreloadUrl=""
        onRefresh={() => {}}
        onDismiss={() => {}}
        onEditChat={() => {}}
        onTogglePinned={() => {}}
        onCycleSize={() => {}}
        onCancel={() => {}}
        onRetry={() => {}}
      />
    );
    const strip = screen.getByLabelText('Widget details');
    expect(strip).toHaveTextContent('show weather');
    expect(strip).toHaveTextContent('Loading…');
  });

  it('bottom strip renders for building and error states', () => {
    const { rerender } = render(
      <Tile
        uuid="u1"
        prompt="show weather"
        state={{ kind: 'building' }}
        htmlUrl=""
        widgetPreloadUrl=""
        onRefresh={() => {}}
        onDismiss={() => {}}
        onEditChat={() => {}}
        onTogglePinned={() => {}}
        onCycleSize={() => {}}
        onCancel={() => {}}
        onRetry={() => {}}
      />
    );
    expect(screen.getByLabelText('Widget details')).toHaveTextContent('show weather');

    rerender(
      <Tile
        uuid="u1"
        prompt="show weather"
        state={{ kind: 'error', message: 'boom' }}
        htmlUrl=""
        widgetPreloadUrl=""
        onRefresh={() => {}}
        onDismiss={() => {}}
        onEditChat={() => {}}
        onTogglePinned={() => {}}
        onCycleSize={() => {}}
        onCancel={() => {}}
        onRetry={() => {}}
      />
    );
    expect(screen.getByLabelText('Widget details')).toHaveTextContent('show weather');
  });

  it('live webview fills the content area above the bottom strip', () => {
    const { container } = render(
      <Tile
        uuid="u1"
        prompt="show weather"
        state={{ kind: 'live' }}
        htmlUrl="file:///path/index.html"
        widgetPreloadUrl=""
        onRefresh={() => {}}
        onDismiss={() => {}}
        onEditChat={() => {}}
        onTogglePinned={() => {}}
        onCycleSize={() => {}}
        onCancel={() => {}}
        onRetry={() => {}}
      />
    );
    const webview = container.querySelector('webview') as HTMLElement;
    expect(webview.style.width).toBe('100%');
    expect(webview.style.height).toBe('100%');
    expect(webview.style.position).toBe('');
    expect(webview.style.inset).toBe('');
    expect(screen.getByLabelText('Widget details')).toHaveStyle({ flex: '0 0 auto', height: '28px', zIndex: '1' });
  });

  it('error state shows a friendly title; See details reveals the raw message', async () => {
    render(
      <Tile
        uuid="u1"
        prompt="show weather"
        state={{ kind: 'error', message: 'codex exited with code 1: HTTP 401 Unauthorized' }}
        htmlUrl=""
        widgetPreloadUrl=""
        onRefresh={() => {}}
        onDismiss={() => {}}
        onEditChat={() => {}}
        onTogglePinned={() => {}}
        onCycleSize={() => {}}
        onCancel={() => {}}
        onRetry={() => {}}
      />
    );
    expect(screen.getByRole('alert')).toHaveTextContent(/Codex isn't signed in/);
    expect(screen.getByRole('alert')).toHaveTextContent(/`codex login`/);
    expect(screen.queryByText(/HTTP 401 Unauthorized/i)).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: /see details/i }));
    expect(screen.getByText(/HTTP 401 Unauthorized/i)).toBeInTheDocument();
  });

  it('shows error message + Retry + Delete when state is error', async () => {
    const onRetry = vi.fn();
    const onDismiss = vi.fn();
    render(
      <Tile
        uuid="u1"
        prompt="show weather"
        state={{ kind: 'error', message: 'codex exited with code 1' }}
        htmlUrl=""
        widgetPreloadUrl=""
        onRefresh={() => {}}
        onDismiss={onDismiss}
        onEditChat={() => {}}
        onTogglePinned={() => {}}
        onRetry={onRetry}
      />
    );
    // Friendly title is shown by default; raw stderr is hidden behind a toggle.
    expect(screen.getByText(/widget generation failed|codex exited without output|codex/i)).toBeInTheDocument();
    expect(screen.queryByText(/codex exited with code 1/i)).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: /see details/i }));
    expect(screen.getByText(/codex exited with code 1/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(onRetry).toHaveBeenCalled();
    const deleteBtn = screen.getByRole('button', { name: /delete/i });
    await userEvent.click(deleteBtn);
    expect(onDismiss).not.toHaveBeenCalled();
    await userEvent.click(deleteBtn);
    expect(onDismiss).toHaveBeenCalled();
  });

  it('chrome buttons call the right callbacks when live', async () => {
    const onRefresh = vi.fn();
    const onDismiss = vi.fn();
    const onEditChat = vi.fn();
    const onTogglePinned = vi.fn();
    render(
      <Tile
        uuid="u1"
        prompt="show weather"
        state={{ kind: 'live' }}
        htmlUrl="file:///x"
        widgetPreloadUrl=""
        onRefresh={onRefresh}
        onDismiss={onDismiss}
        onEditChat={onEditChat}
        onTogglePinned={onTogglePinned}
        onRetry={() => {}}
      />
    );
    await userEvent.click(screen.getByRole('button', { name: 'Pin' }));
    await userEvent.click(screen.getByRole('button', { name: /refresh/i }));
    await userEvent.click(screen.getByRole('button', { name: 'Edit with chat' }));
    const deleteBtn = screen.getByRole('button', { name: /delete/i });
    await userEvent.click(deleteBtn);
    await userEvent.click(deleteBtn);
    expect(onRefresh).toHaveBeenCalled();
    expect(onEditChat).toHaveBeenCalled();
    expect(onTogglePinned).toHaveBeenCalled();
    expect(onDismiss).toHaveBeenCalled();
  });

  it('schedules live tile reload using refreshTtlMs', () => {
    vi.useFakeTimers();
    const { container } = render(
      <Tile
        uuid="u1"
        prompt="show weather"
        state={{ kind: 'live' }}
        htmlUrl="file:///x"
        widgetPreloadUrl=""
        refreshTtlMs={60_000}
        onRefresh={() => {}}
        onDismiss={() => {}}
        onEditChat={() => {}}
        onTogglePinned={() => {}}
        onCycleSize={() => {}}
        onCancel={() => {}}
        onRetry={() => {}}
      />
    );
    const webview = container.querySelector('webview') as any;
    webview.reload = vi.fn();

    act(() => { vi.advanceTimersByTime(59_000); });
    expect(webview.reload).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(1_000); });
    expect(webview.reload).toHaveBeenCalledTimes(1);
  });

  it('uses 30 seconds for Live refresh', () => {
    vi.useFakeTimers();
    const { container } = render(
      <Tile
        uuid="u1"
        prompt="show weather"
        state={{ kind: 'live' }}
        htmlUrl="file:///x"
        widgetPreloadUrl=""
        refreshTtlMs={0}
        onRefresh={() => {}}
        onDismiss={() => {}}
        onEditChat={() => {}}
        onTogglePinned={() => {}}
        onCycleSize={() => {}}
        onCancel={() => {}}
        onRetry={() => {}}
      />
    );
    const webview = container.querySelector('webview') as any;
    webview.reload = vi.fn();

    act(() => { vi.advanceTimersByTime(30_000); });
    expect(webview.reload).toHaveBeenCalledTimes(1);
  });

  it('does not schedule automatic reload for event-driven tiles', () => {
    vi.useFakeTimers();
    const { container } = render(
      <Tile
        uuid="u1"
        prompt="show weather"
        state={{ kind: 'live' }}
        htmlUrl="file:///x"
        widgetPreloadUrl=""
        refreshMode="event"
        refreshTtlMs={1_000}
        onRefresh={() => {}}
        onDismiss={() => {}}
        onEditChat={() => {}}
        onTogglePinned={() => {}}
        onCycleSize={() => {}}
        onCancel={() => {}}
        onRetry={() => {}}
      />
    );
    const webview = container.querySelector('webview') as any;
    webview.reload = vi.fn();

    expect(screen.getByLabelText('Widget details')).toHaveTextContent('Waiting for event.');
    act(() => { vi.advanceTimersByTime(5_000); });
    expect(webview.reload).not.toHaveBeenCalled();
  });

  it('does not schedule reload for building or error tiles', () => {
    vi.useFakeTimers();
    const onRefresh = vi.fn();
    const { rerender } = render(
      <Tile
        uuid="u1"
        prompt="show weather"
        state={{ kind: 'building' }}
        htmlUrl=""
        widgetPreloadUrl=""
        refreshTtlMs={1_000}
        onRefresh={onRefresh}
        onDismiss={() => {}}
        onEditChat={() => {}}
        onTogglePinned={() => {}}
        onCycleSize={() => {}}
        onCancel={() => {}}
        onRetry={() => {}}
      />
    );

    act(() => { vi.advanceTimersByTime(5_000); });
    expect(onRefresh).not.toHaveBeenCalled();

    rerender(
      <Tile
        uuid="u1"
        prompt="show weather"
        state={{ kind: 'error', message: 'boom' }}
        htmlUrl=""
        widgetPreloadUrl=""
        refreshTtlMs={1_000}
        onRefresh={onRefresh}
        onDismiss={() => {}}
        onEditChat={() => {}}
        onTogglePinned={() => {}}
        onCycleSize={() => {}}
        onCancel={() => {}}
        onRetry={() => {}}
      />
    );
    act(() => { vi.advanceTimersByTime(5_000); });
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it('manual Refresh reloads webview immediately when available', async () => {
    const onRefresh = vi.fn();
    const { container } = render(
      <Tile
        uuid="u1"
        prompt="show weather"
        state={{ kind: 'live' }}
        htmlUrl="file:///x"
        widgetPreloadUrl=""
        onRefresh={onRefresh}
        onDismiss={() => {}}
        onEditChat={() => {}}
        onTogglePinned={() => {}}
        onCycleSize={() => {}}
        onCancel={() => {}}
        onRetry={() => {}}
      />
    );
    const webview = container.querySelector('webview') as any;
    webview.reload = vi.fn();

    await userEvent.click(screen.getByRole('button', { name: /refresh/i }));

    expect(webview.reload).toHaveBeenCalledTimes(1);
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it('delete requires a confirm click before dismissing', async () => {
    const onDismiss = vi.fn();
    render(
      <Tile
        uuid="u1"
        prompt="show weather"
        state={{ kind: 'live' }}
        htmlUrl="file:///x"
        widgetPreloadUrl=""
        onRefresh={() => {}}
        onDismiss={onDismiss}
        onEditChat={() => {}}
        onTogglePinned={() => {}}
        onCycleSize={() => {}}
        onCancel={() => {}}
        onRetry={() => {}}
      />
    );

    const btn = screen.getByRole('button', { name: /^delete$/i });
    await userEvent.click(btn);
    expect(onDismiss).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /click to confirm/i })).toBeInTheDocument();

    await userEvent.click(btn);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('shows pin for unpinned tiles and calls onTogglePinned', async () => {
    const onTogglePinned = vi.fn();
    render(
      <Tile
        uuid="u1"
        prompt="show weather"
        state={{ kind: 'building' }}
        htmlUrl=""
        widgetPreloadUrl=""
        onRefresh={() => {}}
        onDismiss={() => {}}
        onEditChat={() => {}}
        onTogglePinned={onTogglePinned}
        onRetry={() => {}}
      />
    );

    await userEvent.click(screen.getByRole('button', { name: 'Pin' }));

    expect(onTogglePinned).toHaveBeenCalled();
  });

  it('size button shows the current size and cycles via onCycleSize', async () => {
    const onCycleSize = vi.fn();
    const { rerender } = render(
      <Tile
        uuid="u1"
        prompt="show weather"
        state={{ kind: 'live' }}
        htmlUrl="file:///x"
        widgetPreloadUrl=""
        onRefresh={() => {}}
        onDismiss={() => {}}
        onEditChat={() => {}}
        onTogglePinned={() => {}}
        onCycleSize={onCycleSize}
        onRetry={() => {}}
      />
    );

    await userEvent.click(screen.getByRole('button', { name: /size 1×1/i }));
    expect(onCycleSize).toHaveBeenCalled();

    rerender(
      <Tile
        uuid="u1"
        prompt="show weather"
        state={{ kind: 'live' }}
        htmlUrl="file:///x"
        widgetPreloadUrl=""
        size="large"
        onRefresh={() => {}}
        onDismiss={() => {}}
        onEditChat={() => {}}
        onTogglePinned={() => {}}
        onCycleSize={onCycleSize}
        onRetry={() => {}}
      />
    );
    expect(screen.getByRole('button', { name: /size 2×2/i })).toBeInTheDocument();
  });

  it('geek-mode info button is hidden when geekMode is false', () => {
    render(
      <Tile
        uuid="u1"
        prompt="show weather"
        state={{ kind: 'live' }}
        htmlUrl="file:///x"
        widgetPreloadUrl=""
        onRefresh={() => {}}
        onDismiss={() => {}}
        onEditChat={() => {}}
        onTogglePinned={() => {}}
        onCycleSize={() => {}}
        onCancel={() => {}}
        onRetry={() => {}}
      />
    );
    expect(screen.queryByRole('button', { name: /data sources/i })).toBeNull();
  });

  it('geek-mode popover shows recent calls from window.api.getWidgetFetchLog', async () => {
    (window as any).api = {
      getWidgetFetchLog: vi.fn(async () => [
        { at: '2026-05-28T13:39:30.000Z', method: 'GET', url: 'https://api.cloudflare.com/client/v4/accounts', status: 200, durationMs: 287, responseBytes: 142 },
        { at: '2026-05-28T13:39:31.000Z', method: 'GET', url: 'https://api.cloudflare.com/client/v4/zones', status: 401, durationMs: 102, responseBytes: 24, errorBody: '{"error":"unauthorized"}' }
      ])
    };
    render(
      <Tile
        uuid="u1"
        prompt="show weather"
        state={{ kind: 'live' }}
        htmlUrl="file:///x"
        widgetPreloadUrl=""
        geekMode
        summary={{ sources: ['Cloudflare API'] }}
        onRefresh={() => {}}
        onDismiss={() => {}}
        onEditChat={() => {}}
        onTogglePinned={() => {}}
        onCycleSize={() => {}}
        onCancel={() => {}}
        onRetry={() => {}}
      />
    );

    await userEvent.click(screen.getByRole('button', { name: /data sources/i }));

    const dialog = await screen.findByRole('dialog', { name: /data sources/i });
    expect(dialog).toHaveTextContent(/Recent calls/i);
    expect(dialog).toHaveTextContent(/api\.cloudflare\.com\/client\/v4\/accounts/);
    expect(dialog).toHaveTextContent(/api\.cloudflare\.com\/client\/v4\/zones/);
    expect(dialog).toHaveTextContent(/200/);
    expect(dialog).toHaveTextContent(/401/);
    expect(dialog).toHaveTextContent(/unauthorized/);
  });

  it('geek-mode popover shows "No calls yet." when fetch log is empty', async () => {
    (window as any).api = {
      getWidgetFetchLog: vi.fn(async () => [])
    };
    render(
      <Tile
        uuid="u1"
        prompt="show clock"
        state={{ kind: 'live' }}
        htmlUrl="file:///x"
        widgetPreloadUrl=""
        geekMode
        summary={{ sources: [] }}
        onRefresh={() => {}}
        onDismiss={() => {}}
        onEditChat={() => {}}
        onTogglePinned={() => {}}
        onCycleSize={() => {}}
        onCancel={() => {}}
        onRetry={() => {}}
      />
    );

    await userEvent.click(screen.getByRole('button', { name: /data sources/i }));
    expect(await screen.findByText(/no calls yet/i)).toBeInTheDocument();
  });

  it('geek-mode info button shows the popover with summary sources', async () => {
    render(
      <Tile
        uuid="u1"
        prompt="show weather"
        state={{ kind: 'live' }}
        htmlUrl="file:///x"
        widgetPreloadUrl=""
        geekMode
        summary={{ sources: ['Open-Meteo', 'Hacker News API'] }}
        onRefresh={() => {}}
        onDismiss={() => {}}
        onEditChat={() => {}}
        onTogglePinned={() => {}}
        onCycleSize={() => {}}
        onCancel={() => {}}
        onRetry={() => {}}
      />
    );

    await userEvent.click(screen.getByRole('button', { name: /data sources/i }));

    const dialog = await screen.findByRole('dialog', { name: /data sources/i });
    expect(dialog).toHaveTextContent('Open-Meteo');
    expect(dialog).toHaveTextContent('Hacker News API');
  });

  it('geek-mode popover shows fallback when no summary is recorded', async () => {
    render(
      <Tile
        uuid="u1"
        prompt="show weather"
        state={{ kind: 'live' }}
        htmlUrl="file:///x"
        widgetPreloadUrl=""
        geekMode
        onRefresh={() => {}}
        onDismiss={() => {}}
        onEditChat={() => {}}
        onTogglePinned={() => {}}
        onCycleSize={() => {}}
        onCancel={() => {}}
        onRetry={() => {}}
      />
    );

    await userEvent.click(screen.getByRole('button', { name: /data sources/i }));

    expect(await screen.findByText(/no data sources recorded/i)).toBeInTheDocument();
  });

  it('geek-mode popover shows the no-external-sources message for empty sources', async () => {
    render(
      <Tile
        uuid="u1"
        prompt="show weather"
        state={{ kind: 'live' }}
        htmlUrl="file:///x"
        widgetPreloadUrl=""
        geekMode
        summary={{ sources: [] }}
        onRefresh={() => {}}
        onDismiss={() => {}}
        onEditChat={() => {}}
        onTogglePinned={() => {}}
        onCycleSize={() => {}}
        onCancel={() => {}}
        onRetry={() => {}}
      />
    );

    await userEvent.click(screen.getByRole('button', { name: /data sources/i }));
    expect(await screen.findByText(/uses no external sources/i)).toBeInTheDocument();
  });

  it('renders a pinned indicator badge only when pinned', () => {
    const { container, rerender } = render(
      <Tile
        uuid="u1"
        prompt="show weather"
        state={{ kind: 'live' }}
        htmlUrl="file:///x"
        widgetPreloadUrl=""
        onRefresh={() => {}}
        onDismiss={() => {}}
        onEditChat={() => {}}
        onTogglePinned={() => {}}
        onCycleSize={() => {}}
        onCancel={() => {}}
        onRetry={() => {}}
      />
    );
    expect(container.querySelector('[data-pin-indicator]')).toBeNull();

    rerender(
      <Tile
        uuid="u1"
        prompt="show weather"
        state={{ kind: 'live' }}
        htmlUrl="file:///x"
        widgetPreloadUrl=""
        pinned
        onRefresh={() => {}}
        onDismiss={() => {}}
        onEditChat={() => {}}
        onTogglePinned={() => {}}
        onCycleSize={() => {}}
        onCancel={() => {}}
        onRetry={() => {}}
      />
    );
    expect(container.querySelector('[data-pin-indicator]')).not.toBeNull();
  });

  it('shows unpin for pinned tiles and calls onTogglePinned', async () => {
    const onTogglePinned = vi.fn();
    render(
      <Tile
        uuid="u1"
        prompt="show weather"
        state={{ kind: 'building' }}
        htmlUrl=""
        widgetPreloadUrl=""
        pinned
        onRefresh={() => {}}
        onDismiss={() => {}}
        onEditChat={() => {}}
        onTogglePinned={onTogglePinned}
        onRetry={() => {}}
      />
    );

    await userEvent.click(screen.getByRole('button', { name: 'Unpin' }));

    expect(onTogglePinned).toHaveBeenCalled();
  });
});
