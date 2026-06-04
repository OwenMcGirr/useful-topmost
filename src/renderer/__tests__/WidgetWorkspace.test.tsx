import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import WidgetWorkspace from '../WidgetWorkspace';

function mockApi(opts: {
  providers?: Array<{ id: string; name: string; hostnames: string[] }>;
  webhookInfo?: {
    enabled: true;
    path: string;
    urlCandidates: string[];
    localUrlCandidates: string[];
    publicUrl?: string;
    publicBaseUrl?: string;
    cacheKey: 'webhook';
    lastReceivedAt?: string;
  };
  webhookTestResult?: { ok: true; receivedAt: string } | { ok: false; error: string };
} = {}) {
  let readyHandler: ((uuid: string) => void) | null = null;
  let errorHandler: ((uuid: string, error: string) => void) | null = null;
  let planHandler: ((uuid: string, providers: Array<{ name: string; hostname: string }>) => void) | null = null;
  const providers = opts.providers ?? [];
  const api = {
    chatStartWidget: vi.fn(async () => ({ uuid: 'new-widget' })),
    chatSendWidget: vi.fn(async () => ({ ok: true })),
    listWidgetChat: vi.fn(async () => [
      { id: '1', role: 'user', text: 'make a clock', created_at: 't1' }
    ]),
    htmlUrl: vi.fn(async (uuid: string) => `file:///${uuid}/index.html`),
    onWidgetReady: vi.fn((cb: any) => { readyHandler = cb; return () => {}; }),
    onWidgetError: vi.fn((cb: any) => { errorHandler = cb; return () => {}; }),
    onWidgetPlan: vi.fn((cb: any) => { planHandler = cb; return () => {}; }),
    deleteWidget: vi.fn(async () => ({ ok: true })),
    setWidgetProviders: vi.fn(async () => ({ ok: true })),
    setWidgetRefreshTtl: vi.fn(async () => ({ ok: true })),
    setWidgetRefreshMode: vi.fn(async () => ({ ok: true })),
    getWidgetWebhook: vi.fn(async () => opts.webhookInfo ?? ({
      enabled: true,
      path: '/api/widgets/new-widget/webhook/token',
      urlCandidates: ['http://localhost:32177/api/widgets/new-widget/webhook/token'],
      localUrlCandidates: ['http://localhost:32177/api/widgets/new-widget/webhook/token'],
      cacheKey: 'webhook' as const
    })),
    testWidgetWebhook: vi.fn(async () => opts.webhookTestResult ?? ({ ok: true, receivedAt: '2026-06-04T12:00:00.000Z' })),
    rotateWidgetWebhookToken: vi.fn(async () => ({
      enabled: true,
      path: '/api/widgets/new-widget/webhook/next-token',
      urlCandidates: ['http://localhost:32177/api/widgets/new-widget/webhook/next-token'],
      localUrlCandidates: ['http://localhost:32177/api/widgets/new-widget/webhook/next-token'],
      cacheKey: 'webhook' as const
    })),
    secrets: {
      list: vi.fn(async () => providers.map((p) => ({ ...p, auth: { type: 'header' as const, name: 'A' } })))
    }
  };
  return {
    api,
    fireReady: (uuid: string) => readyHandler?.(uuid),
    fireError: (uuid: string, error: string) => errorHandler?.(uuid, error),
    firePlan: (uuid: string, providers: Array<{ name: string; hostname: string }>) => planHandler?.(uuid, providers)
  };
}

beforeEach(() => {
  (window as any).api = undefined;
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function mockScrollIntoView() {
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
    configurable: true,
    value: vi.fn()
  });
  return HTMLElement.prototype.scrollIntoView as ReturnType<typeof vi.fn>;
}

function setScrollMetrics(el: HTMLElement, metrics: { scrollHeight: number; clientHeight: number; scrollTop: number }) {
  Object.defineProperty(el, 'scrollHeight', { configurable: true, value: metrics.scrollHeight });
  Object.defineProperty(el, 'clientHeight', { configurable: true, value: metrics.clientHeight });
  Object.defineProperty(el, 'scrollTop', { configurable: true, writable: true, value: metrics.scrollTop });
}

describe('WidgetWorkspace', () => {
  it('renders nothing when closed', () => {
    const { api } = mockApi();
    (window as any).api = api;
    const { container } = render(
      <WidgetWorkspace open={false} mode="create" widgetPreloadUrl="" onClose={() => {}} onCreated={() => {}} onSent={() => {}} onDeleted={() => {}} />
    );
    expect(container.textContent).toBe('');
  });

  it('shows New widget in create mode with placeholder preview', () => {
    const { api } = mockApi();
    (window as any).api = api;
    render(<WidgetWorkspace open={true} mode="create" widgetPreloadUrl="" onClose={() => {}} onCreated={() => {}} onSent={() => {}} onDeleted={() => {}} />);

    expect(screen.getByLabelText('Widget workspace')).toBeInTheDocument();
    expect(screen.queryByLabelText('Widget chat')).toBeNull();
    expect(screen.getByRole('heading', { name: /new widget/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /preview/i })).toBeInTheDocument();
    expect(screen.getByLabelText('Preview pane')).toBeInTheDocument();
    expect(screen.getByLabelText('Chat pane')).toBeInTheDocument();
    expect(screen.getByLabelText('Chat transcript')).toBeInTheDocument();
    expect(screen.getByText(/preview will appear here/i)).toBeInTheDocument();
  });

  it('collapses advanced refresh and provider controls by default', () => {
    const { api } = mockApi();
    (window as any).api = api;
    const { container } = render(
      <WidgetWorkspace open={true} mode="create" widgetPreloadUrl="" onClose={() => {}} onCreated={() => {}} onSent={() => {}} onDeleted={() => {}} />
    );

    const sections = Array.from(container.querySelectorAll('details'));
    const refresh = sections.find((section) => section.querySelector('summary')?.textContent === 'Refresh') as HTMLDetailsElement | undefined;
    const providers = sections.find((section) => section.querySelector('summary')?.textContent === 'Providers') as HTMLDetailsElement | undefined;

    expect(refresh).toBeDefined();
    expect(providers).toBeDefined();
    expect(refresh?.open).toBe(false);
    expect(providers?.open).toBe(false);
  });

  it('focuses the widget message box when create mode opens', async () => {
    const { api } = mockApi();
    (window as any).api = api;
    render(<WidgetWorkspace open={true} mode="create" widgetPreloadUrl="" onClose={() => {}} onCreated={() => {}} onSent={() => {}} onDeleted={() => {}} />);

    const textarea = screen.getByLabelText(/widget message/i);
    await waitFor(() => expect(textarea).toHaveFocus());
  });

  it('shows Edit widget, loads messages, and renders preview webview in edit mode', async () => {
    const { api } = mockApi();
    (window as any).api = api;
    const { container } = render(
      <WidgetWorkspace
        open={true}
        mode="edit"
        widget={{ uuid: 'u1', prompt: 'p', htmlUrl: 'file:///u1/index.html' }}
        widgetPreloadUrl="file:///preload.js"
        onClose={() => {}}
        onCreated={() => {}}
        onSent={() => {}}
      />
    );

    expect(screen.getByRole('heading', { name: /edit widget/i })).toBeInTheDocument();
    expect(await screen.findByText(/make a clock/i)).toBeInTheDocument();
    expect(container.querySelector('webview')?.getAttribute('src')).toContain('file:///u1/index.html');
  });

  it('scrolls to the bottom when edit chat loads', async () => {
    const scrollIntoView = mockScrollIntoView();
    const { api } = mockApi();
    (window as any).api = api;
    render(
      <WidgetWorkspace
        open={true}
        mode="edit"
        widget={{ uuid: 'u1', prompt: 'p', htmlUrl: 'file:///u1/index.html' }}
        widgetPreloadUrl=""
        onClose={() => {}}
        onCreated={() => {}}
        onSent={() => {}}
      />
    );

    expect(await screen.findByText(/make a clock/i)).toBeInTheDocument();
    expect(scrollIntoView).toHaveBeenCalled();
  });

  it('empty message cannot send', async () => {
    const { api } = mockApi();
    (window as any).api = api;
    render(<WidgetWorkspace open={true} mode="create" widgetPreloadUrl="" onClose={() => {}} onCreated={() => {}} onSent={() => {}} onDeleted={() => {}} />);

    expect(screen.getByRole('button', { name: /send/i })).toBeDisabled();
    expect(api.chatStartWidget).not.toHaveBeenCalled();
  });

  it('create send calls chatStartWidget and shows building preview', async () => {
    const { api } = mockApi();
    const onCreated = vi.fn();
    (window as any).api = api;
    render(<WidgetWorkspace open={true} mode="create" widgetPreloadUrl="" onClose={() => {}} onCreated={onCreated} onSent={() => {}} onDeleted={() => {}} />);

    await userEvent.type(screen.getByLabelText(/widget message/i), 'show weather');
    await userEvent.click(screen.getByRole('button', { name: /send/i }));

    await waitFor(() => expect(api.chatStartWidget).toHaveBeenCalledWith('show weather', [], 3_600_000));
    expect(onCreated).toHaveBeenCalledWith('new-widget', 'show weather', [], 3_600_000);
    expect(screen.getByText(/building preview/i)).toBeInTheDocument();
  });

  it('scrolls to the bottom after sending a create message', async () => {
    const scrollIntoView = mockScrollIntoView();
    const { api } = mockApi();
    (window as any).api = api;
    render(<WidgetWorkspace open={true} mode="create" widgetPreloadUrl="" onClose={() => {}} onCreated={() => {}} onSent={() => {}} onDeleted={() => {}} />);
    scrollIntoView.mockClear();

    await userEvent.type(screen.getByLabelText(/widget message/i), 'show weather');
    await userEvent.click(screen.getByRole('button', { name: /send/i }));

    expect(await screen.findByText('show weather')).toBeInTheDocument();
    expect(screen.getByText('Building…')).toBeInTheDocument();
    expect(scrollIntoView).toHaveBeenCalled();
  });

  it('does not start the close countdown immediately after creating a widget', async () => {
    const { api } = mockApi();
    const onClose = vi.fn();
    (window as any).api = api;
    render(<WidgetWorkspace open={true} mode="create" widgetPreloadUrl="" onClose={onClose} onCreated={() => {}} onSent={() => {}} onDeleted={() => {}} />);

    await userEvent.type(screen.getByLabelText(/widget message/i), 'show weather');
    await userEvent.click(screen.getByRole('button', { name: /send/i }));

    await waitFor(() => expect(api.chatStartWidget).toHaveBeenCalledWith('show weather', [], 3_600_000));
    expect(screen.getByText(/building preview/i)).toBeInTheDocument();
    expect(screen.queryByText(/closing in 3s/i)).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('starts the close countdown after the created widget is ready and closes when it expires', async () => {
    vi.useFakeTimers();
    const m = mockApi();
    const onClose = vi.fn();
    (window as any).api = m.api;
    render(<WidgetWorkspace open={true} mode="create" widgetPreloadUrl="" onClose={onClose} onCreated={() => {}} onSent={() => {}} onDeleted={() => {}} />);

    await act(async () => {
      fireEvent.change(screen.getByLabelText(/widget message/i), { target: { value: 'show weather' } });
      fireEvent.click(screen.getByRole('button', { name: /send/i }));
    });

    expect(screen.queryByText(/closing in 3s/i)).toBeNull();

    await act(async () => {
      m.fireReady('new-widget');
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(m.api.htmlUrl).toHaveBeenCalledWith('new-widget');
    expect(screen.getByText(/closing in 3s/i)).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByText(/closing in 2s/i)).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByText(/closing in 1s/i)).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not start the close countdown when a different widget is ready', async () => {
    vi.useFakeTimers();
    const m = mockApi();
    const onClose = vi.fn();
    (window as any).api = m.api;
    render(<WidgetWorkspace open={true} mode="create" widgetPreloadUrl="" onClose={onClose} onCreated={() => {}} onSent={() => {}} onDeleted={() => {}} />);

    await act(async () => {
      fireEvent.change(screen.getByLabelText(/widget message/i), { target: { value: 'show weather' } });
      fireEvent.click(screen.getByRole('button', { name: /send/i }));
    });

    await act(async () => {
      m.fireReady('other-widget');
      await Promise.resolve();
    });

    expect(screen.queryByText(/closing in 3s/i)).toBeNull();
    await act(async () => {
      vi.advanceTimersByTime(4000);
    });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('does not auto-close when the created widget fails', async () => {
    vi.useFakeTimers();
    const m = mockApi();
    const onClose = vi.fn();
    (window as any).api = m.api;
    render(<WidgetWorkspace open={true} mode="create" widgetPreloadUrl="" onClose={onClose} onCreated={() => {}} onSent={() => {}} onDeleted={() => {}} />);

    await act(async () => {
      fireEvent.change(screen.getByLabelText(/widget message/i), { target: { value: 'show weather' } });
      fireEvent.click(screen.getByRole('button', { name: /send/i }));
    });

    await act(async () => {
      m.fireError('new-widget', 'boom');
      await Promise.resolve();
    });

    expect(screen.queryByText(/closing in 3s/i)).toBeNull();
    await act(async () => {
      vi.advanceTimersByTime(4000);
    });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('cancels the ready-triggered close countdown when the user keeps interacting', async () => {
    vi.useFakeTimers();
    const m = mockApi();
    const onClose = vi.fn();
    (window as any).api = m.api;
    render(<WidgetWorkspace open={true} mode="create" widgetPreloadUrl="" onClose={onClose} onCreated={() => {}} onSent={() => {}} onDeleted={() => {}} />);

    const textarea = screen.getByLabelText(/widget message/i);
    await act(async () => {
      fireEvent.change(textarea, { target: { value: 'show weather' } });
      fireEvent.click(screen.getByRole('button', { name: /send/i }));
    });

    await act(async () => {
      m.fireReady('new-widget');
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByText(/closing in 3s/i)).toBeInTheDocument();
    fireEvent.pointerDown(textarea);

    expect(screen.getByText(/ctrl\+enter to send/i)).toBeInTheDocument();

    await act(async () => {
      vi.advanceTimersByTime(4000);
    });

    expect(onClose).not.toHaveBeenCalled();
  });

  it('edit send calls chatSendWidget', async () => {
    const { api } = mockApi();
    const onSent = vi.fn();
    (window as any).api = api;
    render(
      <WidgetWorkspace
        open={true}
        mode="edit"
        widget={{ uuid: 'u1', prompt: 'p', htmlUrl: 'file:///u1/index.html' }}
        widgetPreloadUrl=""
        onClose={() => {}}
        onCreated={() => {}}
        onSent={onSent}
        onDeleted={() => {}}
      />
    );

    await userEvent.type(screen.getByLabelText(/widget message/i), 'make it blue');
    await userEvent.click(screen.getByRole('button', { name: /send/i }));

    await waitFor(() => expect(api.chatSendWidget).toHaveBeenCalledWith('u1', 'make it blue'));
    expect(onSent).toHaveBeenCalledWith('u1', 'make it blue');
  });

  it('Ctrl+Enter sends', async () => {
    const { api } = mockApi();
    (window as any).api = api;
    render(<WidgetWorkspace open={true} mode="create" widgetPreloadUrl="" onClose={() => {}} onCreated={() => {}} onSent={() => {}} onDeleted={() => {}} />);

    await userEvent.type(screen.getByLabelText(/widget message/i), 'show time');
    await userEvent.keyboard('{Control>}{Enter}{/Control}');

    await waitFor(() => expect(api.chatStartWidget).toHaveBeenCalledWith('show time', [], 3_600_000));
  });

  it('provider section renders checkboxes and toggling persists via setWidgetProviders', async () => {
    const m = mockApi({ providers: [
      { id: 'p1', name: 'OpenWeather', hostnames: ['api.openweathermap.org'] },
      { id: 'p2', name: 'NASA', hostnames: ['api.nasa.gov'] }
    ]});
    (window as any).api = m.api;
    render(
      <WidgetWorkspace
        open={true}
        mode="edit"
        widget={{ uuid: 'u1', prompt: 'p', htmlUrl: 'file:///u1/index.html', selectedProviderIds: ['p1', 'p2'] }}
        widgetPreloadUrl=""
        onClose={() => {}}
        onCreated={() => {}}
        onSent={() => {}}
      />
    );

    const openWeather = await screen.findByLabelText(/allow openweather/i) as HTMLInputElement;
    const nasa = await screen.findByLabelText(/allow nasa/i) as HTMLInputElement;
    expect(openWeather.checked).toBe(true);
    expect(nasa.checked).toBe(true);

    await userEvent.click(nasa);

    await waitFor(() => expect(m.api.setWidgetProviders).toHaveBeenCalledWith('u1', ['p1']));
  });

  it('refresh dropdown shows the seven presets and defaults to 1 hour in create mode', async () => {
    const { api } = mockApi();
    (window as any).api = api;
    render(<WidgetWorkspace open={true} mode="create" widgetPreloadUrl="" onClose={() => {}} onCreated={() => {}} onSent={() => {}} onDeleted={() => {}} />);

    const select = await screen.findByLabelText(/refresh cadence/i) as HTMLSelectElement;
    const labels = Array.from(select.options).map((o) => o.textContent);
    expect(labels).toEqual(['Live', '1 min', '5 min', '15 min', '1 hour', '6 hours', 'Daily', 'Event-driven']);
    expect(select.value).toBe('3600000');
  });

  it('edit mode seeds refresh dropdown from widget.refreshTtlMs and toggling calls setWidgetRefreshTtl', async () => {
    const { api } = mockApi();
    (window as any).api = api;
    render(
      <WidgetWorkspace
        open={true}
        mode="edit"
        widget={{ uuid: 'u1', prompt: 'p', htmlUrl: 'file:///u1/index.html', refreshTtlMs: 86_400_000 }}
        widgetPreloadUrl=""
        onClose={() => {}}
        onCreated={() => {}}
        onSent={() => {}}
        onDeleted={() => {}}
      />
    );

    const select = await screen.findByLabelText(/refresh cadence/i) as HTMLSelectElement;
    expect(select.value).toBe('86400000');

    await userEvent.selectOptions(select, '300000');

    await waitFor(() => expect(api.setWidgetRefreshTtl).toHaveBeenCalledWith('u1', 300_000));
  });

  it('selecting event-driven enables webhook mode and shows local-only webhook setup', async () => {
    const { api } = mockApi();
    (window as any).api = api;
    render(
      <WidgetWorkspace
        open={true}
        mode="edit"
        widget={{ uuid: 'u1', prompt: 'p', htmlUrl: 'file:///u1/index.html' }}
        widgetPreloadUrl=""
        onClose={() => {}}
        onCreated={() => {}}
        onSent={() => {}}
        onDeleted={() => {}}
      />
    );

    const select = await screen.findByLabelText(/refresh cadence/i) as HTMLSelectElement;
    await userEvent.selectOptions(select, 'event');

    await waitFor(() => expect(api.setWidgetRefreshMode).toHaveBeenCalledWith('u1', 'event'));
    expect(api.getWidgetWebhook).toHaveBeenCalledWith('u1');
    expect(await screen.findByText('Webhook setup')).toBeInTheDocument();
    expect(screen.getByText('Local only')).toBeInTheDocument();
    expect(screen.getByText('This URL works on your local network. External services need a public URL.')).toBeInTheDocument();
    expect(screen.getByLabelText('Local webhook URL')).toHaveValue('http://localhost:32177/api/widgets/new-widget/webhook/token');
    expect(screen.queryByText('Cache key: webhook')).toBeNull();
  });

  it('shows public webhook setup when a public URL is configured', async () => {
    const { api } = mockApi({
      webhookInfo: {
        enabled: true,
        path: '/api/widgets/u1/webhook/token',
        urlCandidates: [
          'https://hooks.example.com/api/widgets/u1/webhook/token',
          'http://localhost:32177/api/widgets/u1/webhook/token'
        ],
        localUrlCandidates: ['http://localhost:32177/api/widgets/u1/webhook/token'],
        publicBaseUrl: 'https://hooks.example.com',
        publicUrl: 'https://hooks.example.com/api/widgets/u1/webhook/token',
        cacheKey: 'webhook'
      }
    });
    (window as any).api = api;
    render(
      <WidgetWorkspace
        open={true}
        mode="edit"
        widget={{ uuid: 'u1', prompt: 'p', htmlUrl: 'file:///u1/index.html', refreshMode: 'event' }}
        widgetPreloadUrl=""
        onClose={() => {}}
        onCreated={() => {}}
        onSent={() => {}}
        onDeleted={() => {}}
      />
    );

    expect(await screen.findByText('Public')).toBeInTheDocument();
    expect(screen.getByText('External services can send events to the public webhook URL.')).toBeInTheDocument();
    expect(screen.getByLabelText('Public webhook URL')).toHaveValue('https://hooks.example.com/api/widgets/u1/webhook/token');
    expect(screen.getByLabelText('Local webhook URL')).toHaveValue('http://localhost:32177/api/widgets/u1/webhook/token');
  });

  it('copies public and local webhook URLs separately', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const { api } = mockApi({
      webhookInfo: {
        enabled: true,
        path: '/api/widgets/u1/webhook/token',
        urlCandidates: [
          'https://hooks.example.com/api/widgets/u1/webhook/token',
          'http://localhost:32177/api/widgets/u1/webhook/token'
        ],
        localUrlCandidates: ['http://localhost:32177/api/widgets/u1/webhook/token'],
        publicBaseUrl: 'https://hooks.example.com',
        publicUrl: 'https://hooks.example.com/api/widgets/u1/webhook/token',
        cacheKey: 'webhook'
      }
    });
    (window as any).api = api;
    render(
      <WidgetWorkspace
        open={true}
        mode="edit"
        widget={{ uuid: 'u1', prompt: 'p', htmlUrl: 'file:///u1/index.html', refreshMode: 'event' }}
        widgetPreloadUrl=""
        onClose={() => {}}
        onCreated={() => {}}
        onSent={() => {}}
        onDeleted={() => {}}
      />
    );

    await userEvent.click(await screen.findByRole('button', { name: 'Copy public URL' }));
    await userEvent.click(screen.getByRole('button', { name: 'Copy local URL' }));

    expect(writeText).toHaveBeenNthCalledWith(1, 'https://hooks.example.com/api/widgets/u1/webhook/token');
    expect(writeText).toHaveBeenNthCalledWith(2, 'http://localhost:32177/api/widgets/u1/webhook/token');
  });

  it('tests the local webhook and shows success or failure status', async () => {
    const { api } = mockApi();
    (window as any).api = api;
    render(
      <WidgetWorkspace
        open={true}
        mode="edit"
        widget={{ uuid: 'u1', prompt: 'p', htmlUrl: 'file:///u1/index.html', refreshMode: 'event' }}
        widgetPreloadUrl=""
        onClose={() => {}}
        onCreated={() => {}}
        onSent={() => {}}
        onDeleted={() => {}}
      />
    );

    await userEvent.click(await screen.findByRole('button', { name: 'Test local webhook' }));

    await waitFor(() => expect(api.testWidgetWebhook).toHaveBeenCalledWith('u1'));
    expect(await screen.findByText('Test event received.')).toBeInTheDocument();
  });

  it('shows a terminal failure message when the local webhook test fails', async () => {
    const { api } = mockApi({ webhookTestResult: { ok: false, error: 'Local network server is off' } });
    (window as any).api = api;
    render(
      <WidgetWorkspace
        open={true}
        mode="edit"
        widget={{ uuid: 'u1', prompt: 'p', htmlUrl: 'file:///u1/index.html', refreshMode: 'event' }}
        widgetPreloadUrl=""
        onClose={() => {}}
        onCreated={() => {}}
        onSent={() => {}}
        onDeleted={() => {}}
      />
    );

    await userEvent.click(await screen.findByRole('button', { name: 'Test local webhook' }));

    expect(await screen.findByText('Local network server is off.')).toBeInTheDocument();
  });

  it('create call includes the selected refresh ttl as the third argument', async () => {
    const m = mockApi();
    const onCreated = vi.fn();
    (window as any).api = m.api;
    render(<WidgetWorkspace open={true} mode="create" widgetPreloadUrl="" onClose={() => {}} onCreated={onCreated} onSent={() => {}} onDeleted={() => {}} />);

    const select = await screen.findByLabelText(/refresh cadence/i) as HTMLSelectElement;
    await userEvent.selectOptions(select, '86400000');

    await userEvent.type(screen.getByLabelText(/widget message/i), 'show weather');
    await userEvent.click(screen.getByRole('button', { name: /send/i }));

    await waitFor(() => expect(m.api.chatStartWidget).toHaveBeenCalled());
    const args = m.api.chatStartWidget.mock.calls[0];
    expect(args[0]).toBe('show weather');
    expect(args[2]).toBe(86_400_000);
    expect(onCreated).toHaveBeenCalledWith('new-widget', 'show weather', expect.any(Array), 86_400_000);
  });

  it('create mode defaults to all providers selected and sends them with the create call', async () => {
    const m = mockApi({ providers: [
      { id: 'p1', name: 'OpenWeather', hostnames: ['api.openweathermap.org'] },
      { id: 'p2', name: 'NASA', hostnames: ['api.nasa.gov'] }
    ]});
    const onCreated = vi.fn();
    (window as any).api = m.api;
    render(<WidgetWorkspace open={true} mode="create" widgetPreloadUrl="" onClose={() => {}} onCreated={onCreated} onSent={() => {}} onDeleted={() => {}} />);

    await screen.findByLabelText(/allow openweather/i);
    await userEvent.type(screen.getByLabelText(/widget message/i), 'show weather');
    await userEvent.click(screen.getByRole('button', { name: /send/i }));

    await waitFor(() => expect(m.api.chatStartWidget).toHaveBeenCalled());
    const callArgs = m.api.chatStartWidget.mock.calls[0];
    expect(callArgs[0]).toBe('show weather');
    expect(new Set(callArgs[1] as string[])).toEqual(new Set(['p1', 'p2']));
  });

  it('shows empty-state message when no providers are configured', async () => {
    const m = mockApi({ providers: [] });
    (window as any).api = m.api;
    render(<WidgetWorkspace open={true} mode="create" widgetPreloadUrl="" onClose={() => {}} onCreated={() => {}} onSent={() => {}} onDeleted={() => {}} />);

    expect(await screen.findByText(/no providers configured/i)).toBeInTheDocument();
  });

  it('Delete widget button is hidden in create mode (no current uuid)', async () => {
    const { api } = mockApi();
    (window as any).api = api;
    render(
      <WidgetWorkspace
        open={true}
        mode="create"
        widgetPreloadUrl=""
        onClose={() => {}}
        onCreated={() => {}}
        onSent={() => {}}
        onDeleted={() => {}}
      />
    );

    expect(screen.queryByRole('button', { name: /delete widget/i })).toBeNull();
  });

  it('Delete widget button in edit mode requires a confirm click, then deletes', async () => {
    const { api } = mockApi();
    const onDeleted = vi.fn();
    const onClose = vi.fn();
    (window as any).api = api;
    render(
      <WidgetWorkspace
        open={true}
        mode="edit"
        widget={{ uuid: 'u1', prompt: 'p', htmlUrl: 'file:///u1/index.html' }}
        widgetPreloadUrl=""
        onClose={onClose}
        onCreated={() => {}}
        onSent={() => {}}
        onDeleted={onDeleted}
      />
    );

    const btn = await screen.findByRole('button', { name: /^delete widget$/i });
    await userEvent.click(btn);
    expect(api.deleteWidget).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /click to confirm/i })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /click to confirm/i }));
    await waitFor(() => expect(api.deleteWidget).toHaveBeenCalledWith('u1'));
    expect(onDeleted).toHaveBeenCalledWith('u1');
    expect(onClose).toHaveBeenCalled();
  });

  it('failed transcript message renders as a red-bordered alert with friendly heading; See details reveals the raw text', async () => {
    const m = mockApi();
    m.api.listWidgetChat = vi.fn(async () => [
      { id: 'm1', role: 'user', text: 'make a clock', created_at: 't1' },
      { id: 'm2', role: 'status', text: 'Failed: codex exited with code 1: rate limit exceeded', created_at: 't2', status: 'failed' }
    ]) as any;
    (window as any).api = m.api;
    render(
      <WidgetWorkspace
        open={true}
        mode="edit"
        widget={{ uuid: 'u1', prompt: 'p', htmlUrl: 'file:///u1/index.html' }}
        widgetPreloadUrl=""
        onClose={() => {}}
        onCreated={() => {}}
        onSent={() => {}}
        onDeleted={() => {}}
      />
    );

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/Codex is rate-limited/);
    expect(alert).toHaveTextContent(/Wait a minute/);
    expect(screen.queryByText(/codex exited with code 1: rate limit exceeded/i)).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: /see details/i }));
    expect(screen.getByText(/codex exited with code 1: rate limit exceeded/i)).toBeInTheDocument();
  });

  it('plan banner appears for missing providers and "Add provider" calls onAddProviderRequest', async () => {
    const m = mockApi({ providers: [
      { id: 'p1', name: 'Stripe', hostnames: ['api.stripe.com'] }
    ]});
    const onAddProviderRequest = vi.fn();
    (window as any).api = m.api;
    const { container } = render(
      <WidgetWorkspace
        open={true}
        mode="edit"
        widget={{ uuid: 'u1', prompt: 'p', htmlUrl: 'file:///u1/index.html' }}
        widgetPreloadUrl=""
        onClose={() => {}}
        onCreated={() => {}}
        onSent={() => {}}
        onDeleted={() => {}}
        onAddProviderRequest={onAddProviderRequest}
      />
    );

    // Wait for the panel to subscribe.
    await screen.findByLabelText(/widget message/i);

    await act(async () => {
      m.firePlan('u1', [
        { name: 'Cloudflare API', hostname: 'api.cloudflare.com' },
        { name: 'Stripe', hostname: 'api.stripe.com' } // already configured, should be filtered
      ]);
    });

    const banner = await screen.findByText(/This widget will use Cloudflare API\./i);
    expect(banner).toBeInTheDocument();
    const suggestions = Array.from(container.querySelectorAll('details'))
      .find((section) => section.querySelector('summary')?.textContent === 'Provider suggestions') as HTMLDetailsElement | undefined;
    expect(suggestions?.open).toBe(true);
    expect(screen.queryByText(/This widget will use Stripe/)).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: /^add provider$/i }));
    expect(onAddProviderRequest).toHaveBeenCalledWith('Cloudflare API');
  });

  it('plan banner ignores events for other widget uuids', async () => {
    const m = mockApi();
    (window as any).api = m.api;
    render(
      <WidgetWorkspace
        open={true}
        mode="edit"
        widget={{ uuid: 'u1', prompt: 'p', htmlUrl: 'file:///u1/index.html' }}
        widgetPreloadUrl=""
        onClose={() => {}}
        onCreated={() => {}}
        onSent={() => {}}
        onDeleted={() => {}}
      />
    );

    await screen.findByLabelText(/widget message/i);
    await act(async () => {
      m.firePlan('other-uuid', [{ name: 'Cloudflare API', hostname: 'api.cloudflare.com' }]);
    });
    expect(screen.queryByText(/This widget will use/i)).toBeNull();
  });

  it('refreshes preview after widget:ready in edit mode without auto-closing', async () => {
    vi.useFakeTimers();
    const m = mockApi();
    const onClose = vi.fn();
    (window as any).api = m.api;
    const { container } = render(
      <WidgetWorkspace
        open={true}
        mode="edit"
        widget={{ uuid: 'u1', prompt: 'p', htmlUrl: 'file:///u1/index.html' }}
        widgetPreloadUrl=""
        onClose={onClose}
        onCreated={() => {}}
        onSent={() => {}}
      />
    );

    await act(async () => {
      m.fireReady('u1');
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(m.api.htmlUrl).toHaveBeenCalledWith('u1');
    expect(container.querySelector('webview')?.getAttribute('src')).toContain('rev=');
    expect(screen.queryByText(/closing in 3s/i)).toBeNull();

    await act(async () => {
      vi.advanceTimersByTime(4000);
    });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('does not auto-scroll a Codex update when the user has scrolled up', async () => {
    const scrollIntoView = mockScrollIntoView();
    const m = mockApi();
    (window as any).api = m.api;
    render(
      <WidgetWorkspace
        open={true}
        mode="edit"
        widget={{ uuid: 'u1', prompt: 'p', htmlUrl: 'file:///u1/index.html' }}
        widgetPreloadUrl=""
        onClose={() => {}}
        onCreated={() => {}}
        onSent={() => {}}
      />
    );

    await screen.findByText(/make a clock/i);
    scrollIntoView.mockClear();
    const transcript = screen.getByLabelText('Chat transcript');
    setScrollMetrics(transcript, { scrollHeight: 1000, clientHeight: 300, scrollTop: 100 });
    fireEvent.scroll(transcript);

    await act(async () => {
      m.fireReady('u1');
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => expect(m.api.htmlUrl).toHaveBeenCalledWith('u1'));
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it('auto-scrolls a Codex update when the user is near the bottom', async () => {
    const scrollIntoView = mockScrollIntoView();
    const m = mockApi();
    (window as any).api = m.api;
    render(
      <WidgetWorkspace
        open={true}
        mode="edit"
        widget={{ uuid: 'u1', prompt: 'p', htmlUrl: 'file:///u1/index.html' }}
        widgetPreloadUrl=""
        onClose={() => {}}
        onCreated={() => {}}
        onSent={() => {}}
      />
    );

    await screen.findByText(/make a clock/i);
    scrollIntoView.mockClear();
    const transcript = screen.getByLabelText('Chat transcript');
    setScrollMetrics(transcript, { scrollHeight: 1000, clientHeight: 300, scrollTop: 680 });
    fireEvent.scroll(transcript);

    await act(async () => {
      m.fireReady('u1');
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => expect(m.api.htmlUrl).toHaveBeenCalledWith('u1'));
    expect(scrollIntoView).toHaveBeenCalled();
  });
});
