import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Dashboard from '../Dashboard';

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
    getWidgetMeta: vi.fn(async () => ({ prompt: 'p', created_at: '' })),
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
    secrets: {
      list: vi.fn(async () => []),
      save: vi.fn(async () => ({ ok: true })),
      delete: vi.fn(async () => ({ ok: true }))
    },
    onboarding: {
      get: vi.fn(async () => ({ dismissed: opts.onboardingDismissed ?? false })),
      dismiss: vi.fn(async () => ({ ok: true }))
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

    await waitFor(() => expect(container.querySelectorAll('webview').length).toBe(2));
  });

  it('+ button opens chat panel; sending calls chatStartWidget and adds a building tile', async () => {
    const m = mockApi();
    (window as any).api = m.api;

    render(<Dashboard />);
    await screen.findByRole('button', { name: '+' });

    await userEvent.click(screen.getByRole('button', { name: '+' }));
    expect(screen.getByRole('heading', { name: /new widget/i })).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(/widget message/i), 'show weather');
    await userEvent.click(screen.getByRole('button', { name: /send/i }));

    expect(m.api.chatStartWidget).toHaveBeenCalledWith('show weather');
    expect(await screen.findByText(/building widget/i)).toBeInTheDocument();
  });

  it('flips tile from building to live on widget:ready', async () => {
    const m = mockApi();
    (window as any).api = m.api;

    const { container } = render(<Dashboard />);
    await screen.findByRole('button', { name: '+' });

    await userEvent.click(screen.getByRole('button', { name: '+' }));
    await userEvent.type(screen.getByLabelText(/widget message/i), 'p');
    await userEvent.click(screen.getByRole('button', { name: /send/i }));

    m.fireReady('new-uuid');

    await waitFor(() => expect(container.querySelector('webview')).not.toBeNull());
  });

  it('flips new tile from building to error on widget:error', async () => {
    const m = mockApi();
    (window as any).api = m.api;

    render(<Dashboard />);
    await screen.findByRole('button', { name: '+' });

    await userEvent.click(screen.getByRole('button', { name: '+' }));
    await userEvent.type(screen.getByLabelText(/widget message/i), 'p');
    await userEvent.click(screen.getByRole('button', { name: /send/i }));

    m.fireError('new-uuid', 'boom');

    expect(await screen.findByText(/boom/)).toBeInTheDocument();
  });

  it('renders a gear button that opens Settings', async () => {
    const m = mockApi();
    (window as any).api = m.api;

    render(<Dashboard />);

    await userEvent.click(await screen.findByRole('button', { name: /settings/i }));
    expect(await screen.findByRole('heading', { name: /settings/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /api providers/i })).toBeInTheDocument();
  });

  it('existing live tile opens chat and sends edits without replacing the live tile immediately', async () => {
    const m = mockApi({ onboardingDismissed: true });
    m.api.listWidgets.mockResolvedValueOnce([
      { uuid: 'a', prompt: 'clock', created_at: '' }
    ]);
    (window as any).api = m.api;

    const { container } = render(<Dashboard />);
    await waitFor(() => expect(container.querySelectorAll('webview').length).toBe(1));

    await userEvent.click(screen.getByRole('button', { name: /edit with chat/i }));
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

    await waitFor(() => expect(container.querySelectorAll('webview').length).toBe(1));
    expect(container.querySelector('webview')?.getAttribute('src')).toContain('rev=');
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
