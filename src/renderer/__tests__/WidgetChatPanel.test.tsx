import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import WidgetChatPanel from '../WidgetChatPanel';

function mockApi(opts: { providers?: Array<{ id: string; name: string; hostnames: string[] }> } = {}) {
  let readyHandler: ((uuid: string) => void) | null = null;
  let errorHandler: ((uuid: string, error: string) => void) | null = null;
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
    setWidgetProviders: vi.fn(async () => ({ ok: true })),
    secrets: {
      list: vi.fn(async () => providers.map((p) => ({ ...p, auth: { type: 'header' as const, name: 'A' } })))
    }
  };
  return {
    api,
    fireReady: (uuid: string) => readyHandler?.(uuid),
    fireError: (uuid: string, error: string) => errorHandler?.(uuid, error)
  };
}

beforeEach(() => {
  (window as any).api = undefined;
});

describe('WidgetChatPanel', () => {
  it('renders nothing when closed', () => {
    const { api } = mockApi();
    (window as any).api = api;
    const { container } = render(
      <WidgetChatPanel open={false} mode="create" widgetPreloadUrl="" onClose={() => {}} onCreated={() => {}} onSent={() => {}} />
    );
    expect(container.textContent).toBe('');
  });

  it('shows New widget in create mode with placeholder preview', () => {
    const { api } = mockApi();
    (window as any).api = api;
    render(<WidgetChatPanel open={true} mode="create" widgetPreloadUrl="" onClose={() => {}} onCreated={() => {}} onSent={() => {}} />);

    expect(screen.getByRole('heading', { name: /new widget/i })).toBeInTheDocument();
    expect(screen.getByText(/preview will appear here/i)).toBeInTheDocument();
  });

  it('shows Edit widget, loads messages, and renders preview webview in edit mode', async () => {
    const { api } = mockApi();
    (window as any).api = api;
    const { container } = render(
      <WidgetChatPanel
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

  it('empty message cannot send', async () => {
    const { api } = mockApi();
    (window as any).api = api;
    render(<WidgetChatPanel open={true} mode="create" widgetPreloadUrl="" onClose={() => {}} onCreated={() => {}} onSent={() => {}} />);

    expect(screen.getByRole('button', { name: /send/i })).toBeDisabled();
    expect(api.chatStartWidget).not.toHaveBeenCalled();
  });

  it('create send calls chatStartWidget and shows building preview', async () => {
    const { api } = mockApi();
    const onCreated = vi.fn();
    (window as any).api = api;
    render(<WidgetChatPanel open={true} mode="create" widgetPreloadUrl="" onClose={() => {}} onCreated={onCreated} onSent={() => {}} />);

    await userEvent.type(screen.getByLabelText(/widget message/i), 'show weather');
    await userEvent.click(screen.getByRole('button', { name: /send/i }));

    await waitFor(() => expect(api.chatStartWidget).toHaveBeenCalledWith('show weather', []));
    expect(onCreated).toHaveBeenCalledWith('new-widget', 'show weather', []);
    expect(screen.getByText(/building preview/i)).toBeInTheDocument();
  });

  it('edit send calls chatSendWidget', async () => {
    const { api } = mockApi();
    const onSent = vi.fn();
    (window as any).api = api;
    render(
      <WidgetChatPanel
        open={true}
        mode="edit"
        widget={{ uuid: 'u1', prompt: 'p', htmlUrl: 'file:///u1/index.html' }}
        widgetPreloadUrl=""
        onClose={() => {}}
        onCreated={() => {}}
        onSent={onSent}
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
    render(<WidgetChatPanel open={true} mode="create" widgetPreloadUrl="" onClose={() => {}} onCreated={() => {}} onSent={() => {}} />);

    await userEvent.type(screen.getByLabelText(/widget message/i), 'show time');
    await userEvent.keyboard('{Control>}{Enter}{/Control}');

    await waitFor(() => expect(api.chatStartWidget).toHaveBeenCalledWith('show time', []));
  });

  it('provider section renders checkboxes and toggling persists via setWidgetProviders', async () => {
    const m = mockApi({ providers: [
      { id: 'p1', name: 'OpenWeather', hostnames: ['api.openweathermap.org'] },
      { id: 'p2', name: 'NASA', hostnames: ['api.nasa.gov'] }
    ]});
    (window as any).api = m.api;
    render(
      <WidgetChatPanel
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

  it('create mode defaults to all providers selected and sends them with the create call', async () => {
    const m = mockApi({ providers: [
      { id: 'p1', name: 'OpenWeather', hostnames: ['api.openweathermap.org'] },
      { id: 'p2', name: 'NASA', hostnames: ['api.nasa.gov'] }
    ]});
    const onCreated = vi.fn();
    (window as any).api = m.api;
    render(<WidgetChatPanel open={true} mode="create" widgetPreloadUrl="" onClose={() => {}} onCreated={onCreated} onSent={() => {}} />);

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
    render(<WidgetChatPanel open={true} mode="create" widgetPreloadUrl="" onClose={() => {}} onCreated={() => {}} onSent={() => {}} />);

    expect(await screen.findByText(/no providers configured/i)).toBeInTheDocument();
  });

  it('refreshes preview after widget:ready', async () => {
    const m = mockApi();
    (window as any).api = m.api;
    const { container } = render(
      <WidgetChatPanel
        open={true}
        mode="edit"
        widget={{ uuid: 'u1', prompt: 'p', htmlUrl: 'file:///u1/index.html' }}
        widgetPreloadUrl=""
        onClose={() => {}}
        onCreated={() => {}}
        onSent={() => {}}
      />
    );

    m.fireReady('u1');

    await waitFor(() => expect(m.api.htmlUrl).toHaveBeenCalledWith('u1'));
    expect(container.querySelector('webview')?.getAttribute('src')).toContain('rev=');
  });
});
