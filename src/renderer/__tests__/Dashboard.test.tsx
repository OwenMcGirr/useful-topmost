import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Dashboard from '../Dashboard';

function mockApi(opts: { onboardingDismissed?: boolean } = {}) {
  let readyHandler: ((uuid: string) => void) | null = null;
  let errorHandler: ((uuid: string, msg: string) => void) | null = null;
  const api = {
    listWidgets: vi.fn(async () => [] as any),
    createWidget: vi.fn(async (_p: string) => ({ uuid: 'new-uuid' })),
    deleteWidget: vi.fn(async () => ({ ok: true })),
    getWidgetMeta: vi.fn(async () => ({ prompt: 'p', created_at: '' })),
    htmlUrl: vi.fn(async (u: string) => `file:///${u}/index.html`),
    codexAvailable: vi.fn(async () => true),
    codexStatus: vi.fn(async () => ({ installed: true, authenticated: true })),
    widgetPreloadUrl: vi.fn(async () => 'file:///fake/widget.js'),
    onWidgetReady: vi.fn((cb: any) => { readyHandler = cb; return () => {}; }),
    onWidgetError: vi.fn((cb: any) => { errorHandler = cb; return () => {}; }),
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
    fireReady: (uuid: string) => readyHandler?.(uuid),
    fireError: (uuid: string, msg: string) => errorHandler?.(uuid, msg)
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

  it('+ button opens modal; submitting calls createWidget and adds a building tile', async () => {
    const m = mockApi();
    (window as any).api = m.api;

    render(<Dashboard />);
    await screen.findByRole('button', { name: '+' });

    await userEvent.click(screen.getByRole('button', { name: '+' }));
    await userEvent.type(screen.getByRole('textbox'), 'show weather');
    await userEvent.click(screen.getByRole('button', { name: /create/i }));

    expect(m.api.createWidget).toHaveBeenCalledWith('show weather');
    expect(await screen.findByText(/building widget/i)).toBeInTheDocument();
  });

  it('flips tile from building to live on widget:ready', async () => {
    const m = mockApi();
    (window as any).api = m.api;

    const { container } = render(<Dashboard />);
    await screen.findByRole('button', { name: '+' });

    await userEvent.click(screen.getByRole('button', { name: '+' }));
    await userEvent.type(screen.getByRole('textbox'), 'p');
    await userEvent.click(screen.getByRole('button', { name: /create/i }));

    m.fireReady('new-uuid');

    await waitFor(() => expect(container.querySelector('webview')).not.toBeNull());
  });

  it('flips tile from building to error on widget:error', async () => {
    const m = mockApi();
    (window as any).api = m.api;

    render(<Dashboard />);
    await screen.findByRole('button', { name: '+' });

    await userEvent.click(screen.getByRole('button', { name: '+' }));
    await userEvent.type(screen.getByRole('textbox'), 'p');
    await userEvent.click(screen.getByRole('button', { name: /create/i }));

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

  // ----- Onboarding overlay -----
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

    // Passive empty-state hint appears instead.
    expect(await screen.findByText(/no widgets yet/i)).toBeInTheDocument();
    expect(screen.queryByText(/welcome to useful-topmost/i)).toBeNull();
  });

  it('clicking an example chip persists dismissal and opens the prompt modal pre-filled', async () => {
    const m = mockApi({ onboardingDismissed: false });
    (window as any).api = m.api;

    render(<Dashboard />);

    const chipText = "a digital clock showing local time, updating every second";
    await userEvent.click(await screen.findByText(chipText));

    await waitFor(() => expect(m.api.onboarding.dismiss).toHaveBeenCalled());
    const input = screen.getByRole('textbox') as HTMLInputElement;
    expect(input.value).toBe(chipText);
  });

  it('clicking Dismiss persists and hides the overlay without opening the prompt modal', async () => {
    const m = mockApi({ onboardingDismissed: false });
    (window as any).api = m.api;

    render(<Dashboard />);
    await screen.findByText(/welcome to useful-topmost/i);

    await userEvent.click(screen.getByRole('button', { name: /dismiss/i }));

    await waitFor(() => expect(m.api.onboarding.dismiss).toHaveBeenCalled());
    expect(screen.queryByText(/welcome to useful-topmost/i)).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
  });
});
