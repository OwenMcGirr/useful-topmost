import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SettingsModal from '../SettingsModal';

function mockApi(initial: any[] = []) {
  const state = [...initial];
  const api = {
    secrets: {
      list: vi.fn(async () => state.map(({ value: _v, ...rest }) => rest)),
      save: vi.fn(async (p: any) => {
        const idx = state.findIndex((x) => x.id === p.id);
        if (idx >= 0) state[idx] = { ...state[idx], ...p, value: p.value || state[idx].value };
        else state.push(p);
        return { ok: true };
      }),
      delete: vi.fn(async (id: string) => {
        const idx = state.findIndex((x) => x.id === id);
        if (idx >= 0) state.splice(idx, 1);
        return { ok: true };
      }),
      test: vi.fn(async (_id: string) => ({ ok: true, status: 200 }) as any),
      lookupProvider: vi.fn(async (_query: string) => ({ ok: false, error: 'not mocked' }) as any),
      cancelLookup: vi.fn(async () => ({ ok: true }) as any)
    },
    prefs: {
      get: vi.fn(async () => ({ geekMode: false })),
      setGeekMode: vi.fn(async () => ({ ok: true }))
    }
  };
  return { api, state };
}

beforeEach(() => {
  (window as any).api = undefined;
});

describe('SettingsModal', () => {
  it('renders nothing when open is false', () => {
    const { api } = mockApi();
    (window as any).api = api;
    const { container } = render(<SettingsModal open={false} onClose={() => {}} />);
    expect(container.textContent).toBe('');
  });

  it('shows Settings and defaults to API Providers', async () => {
    const { api } = mockApi([]);
    (window as any).api = api;
    render(<SettingsModal open={true} onClose={() => {}} />);

    expect(screen.getByRole('heading', { name: /settings/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /api providers/i })).toHaveAttribute('aria-current', 'page');
    expect(await screen.findByText(/no providers yet/i)).toBeInTheDocument();
  });

  it('lists existing providers by name', async () => {
    const { api } = mockApi([{
      id: '1', name: 'OpenWeather',
      hostnames: ['api.openweathermap.org'],
      auth: { type: 'query', param: 'appid' }, value: 'X'
    }]);
    (window as any).api = api;
    render(<SettingsModal open={true} onClose={() => {}} />);
    expect(await screen.findByText('OpenWeather')).toBeInTheDocument();
  });

  it('Add provider flow calls api.secrets.save with typed values', async () => {
    const { api } = mockApi([]);
    (window as any).api = api;
    render(<SettingsModal open={true} onClose={() => {}} />);

    await userEvent.click(await screen.findByRole('button', { name: /add provider/i }));
    await userEvent.type(screen.getByLabelText(/^name$/i), 'OpenWeather');
    await userEvent.type(screen.getByLabelText(/hostnames/i), 'api.openweathermap.org');
    await userEvent.type(screen.getByLabelText(/param/i), 'appid');
    await userEvent.type(screen.getByLabelText(/^value$/i), 'SECRET');
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => expect(api.secrets.save).toHaveBeenCalled());
    const arg = api.secrets.save.mock.calls[0][0];
    expect(arg).toMatchObject({
      name: 'OpenWeather',
      hostnames: ['api.openweathermap.org'],
      auth: { type: 'query', param: 'appid' },
      value: 'SECRET'
    });
    expect(typeof arg.id).toBe('string');
    expect(arg.id.length).toBeGreaterThan(0);
  });

  it('switching auth-type to header shows header fields and hides param', async () => {
    const { api } = mockApi([]);
    (window as any).api = api;
    render(<SettingsModal open={true} onClose={() => {}} />);
    await userEvent.click(await screen.findByRole('button', { name: /add provider/i }));

    await userEvent.selectOptions(screen.getByLabelText(/auth type/i), 'header');

    expect(screen.queryByLabelText(/param/i)).toBeNull();
    expect(screen.getByLabelText(/header name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^scheme$/i)).toBeInTheDocument();
  });

  it('selecting Bearer scheme saves prefix "Bearer " with trailing space', async () => {
    const { api } = mockApi([]);
    (window as any).api = api;
    render(<SettingsModal open={true} onClose={() => {}} />);

    await userEvent.click(await screen.findByRole('button', { name: /add provider/i }));
    await userEvent.type(screen.getByLabelText(/^name$/i), 'Auth Provider');
    await userEvent.type(screen.getByLabelText(/hostnames/i), 'api.example.com');
    await userEvent.selectOptions(screen.getByLabelText(/auth type/i), 'header');
    await userEvent.type(screen.getByLabelText(/header name/i), 'Authorization');
    await userEvent.selectOptions(screen.getByLabelText(/^scheme$/i), 'bearer');
    await userEvent.type(screen.getByLabelText(/^value$/i), 'TOKEN');
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => expect(api.secrets.save).toHaveBeenCalled());
    const arg = api.secrets.save.mock.calls[0][0];
    expect(arg.auth).toEqual({ type: 'header', name: 'Authorization', prefix: 'Bearer ' });
  });

  it('None scheme omits the prefix field on save', async () => {
    const { api } = mockApi([]);
    (window as any).api = api;
    render(<SettingsModal open={true} onClose={() => {}} />);

    await userEvent.click(await screen.findByRole('button', { name: /add provider/i }));
    await userEvent.type(screen.getByLabelText(/^name$/i), 'Auth Provider');
    await userEvent.type(screen.getByLabelText(/hostnames/i), 'api.example.com');
    await userEvent.selectOptions(screen.getByLabelText(/auth type/i), 'header');
    await userEvent.type(screen.getByLabelText(/header name/i), 'X-API-Key');
    await userEvent.type(screen.getByLabelText(/^value$/i), 'KEY');
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => expect(api.secrets.save).toHaveBeenCalled());
    const arg = api.secrets.save.mock.calls[0][0];
    expect(arg.auth).toEqual({ type: 'header', name: 'X-API-Key' });
  });

  it('describe-an-API lookup fills the form and shows the source URL on success', async () => {
    const { api } = mockApi([]);
    api.secrets.lookupProvider = vi.fn(async (_query: string) => ({
      ok: true,
      provider: {
        name: 'Stripe',
        hostnames: ['api.stripe.com'],
        auth: { type: 'header', name: 'Authorization', scheme: 'bearer' },
        source: 'https://stripe.com/docs/api/authentication'
      }
    })) as any;
    (window as any).api = api;
    render(<SettingsModal open={true} onClose={() => {}} />);

    await userEvent.click(await screen.findByRole('button', { name: /add provider/i }));
    await userEvent.type(screen.getByLabelText(/describe an api/i), 'Stripe');
    await userEvent.click(screen.getByRole('button', { name: /^search$/i }));

    await waitFor(() => expect(api.secrets.lookupProvider).toHaveBeenCalledWith('Stripe'));
    expect((screen.getByLabelText(/^name$/i) as HTMLInputElement).value).toBe('Stripe');
    expect((screen.getByLabelText(/hostnames/i) as HTMLTextAreaElement).value).toBe('api.stripe.com');
    expect((screen.getByLabelText(/^scheme$/i) as HTMLSelectElement).value).toBe('bearer');
    expect(await screen.findByText(/stripe\.com\/docs\/api\/authentication/i)).toBeInTheDocument();
  });

  it('describe-an-API lookup shows inline error and leaves form untouched on failure', async () => {
    const { api } = mockApi([]);
    api.secrets.lookupProvider = vi.fn(async (_query: string) => ({
      ok: false,
      error: 'no official docs found'
    })) as any;
    (window as any).api = api;
    render(<SettingsModal open={true} onClose={() => {}} />);

    await userEvent.click(await screen.findByRole('button', { name: /add provider/i }));
    await userEvent.type(screen.getByLabelText(/describe an api/i), 'made-up');
    await userEvent.click(screen.getByRole('button', { name: /^search$/i }));

    expect(await screen.findByText(/no official docs found/i)).toBeInTheDocument();
    expect((screen.getByLabelText(/^name$/i) as HTMLInputElement).value).toBe('');
  });

  it('describe-an-API field is hidden when editing an existing provider', async () => {
    const { api } = mockApi([{
      id: 'p1', name: 'X', hostnames: ['x.com'],
      auth: { type: 'query', param: 'k' }, value: 'V'
    }]);
    (window as any).api = api;
    render(<SettingsModal open={true} onClose={() => {}} />);

    await userEvent.click(await screen.findByRole('button', { name: /edit/i }));

    expect(screen.queryByLabelText(/describe an api/i)).toBeNull();
  });

  it('editing a header provider with "Bearer " prefix selects the Bearer scheme', async () => {
    const { api } = mockApi([{
      id: 'p1', name: 'Auth Provider',
      hostnames: ['api.example.com'],
      auth: { type: 'header', name: 'Authorization', prefix: 'Bearer ' },
      value: 'TOKEN'
    }]);
    (window as any).api = api;
    render(<SettingsModal open={true} onClose={() => {}} />);

    await userEvent.click(await screen.findByRole('button', { name: /edit/i }));

    expect((screen.getByLabelText(/^scheme$/i) as HTMLSelectElement).value).toBe('bearer');
  });

  it('Save with empty name shows inline error and does NOT call save', async () => {
    const { api } = mockApi([]);
    (window as any).api = api;
    render(<SettingsModal open={true} onClose={() => {}} />);
    await userEvent.click(await screen.findByRole('button', { name: /add provider/i }));

    await userEvent.type(screen.getByLabelText(/hostnames/i), 'api.x.com');
    await userEvent.type(screen.getByLabelText(/param/i), 'k');
    await userEvent.type(screen.getByLabelText(/^value$/i), 'v');
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }));

    expect(screen.getByText(/name is required/i)).toBeInTheDocument();
    expect(api.secrets.save).not.toHaveBeenCalled();
  });

  it('editing an existing entry pre-fills metadata and leaves value blank', async () => {
    const { api } = mockApi([{
      id: 'p1', name: 'OpenWeather',
      hostnames: ['api.openweathermap.org', 'pro.openweathermap.org'],
      auth: { type: 'query', param: 'appid' }, value: 'EXISTING'
    }]);
    (window as any).api = api;
    render(<SettingsModal open={true} onClose={() => {}} />);

    await userEvent.click(await screen.findByRole('button', { name: /edit/i }));

    expect((screen.getByLabelText(/^name$/i) as HTMLInputElement).value).toBe('OpenWeather');
    expect((screen.getByLabelText(/hostnames/i) as HTMLTextAreaElement).value)
      .toBe('api.openweathermap.org\npro.openweathermap.org');
    expect((screen.getByLabelText(/^value$/i) as HTMLInputElement).value).toBe('');
  });

  it('Test on an entry calls api.secrets.test and shows the HTTP status', async () => {
    const { api } = mockApi([{
      id: 'p1', name: 'X', hostnames: ['x.com'],
      auth: { type: 'query', param: 'k' }, value: 'V'
    }]);
    api.secrets.test = vi.fn(async (_id: string) => ({ ok: true, status: 200 })) as any;
    (window as any).api = api;
    render(<SettingsModal open={true} onClose={() => {}} />);

    const row = (await screen.findByText('X')).closest('[data-row]') as HTMLElement;
    await userEvent.click(within(row).getByRole('button', { name: /^test$/i }));

    await waitFor(() => expect(api.secrets.test).toHaveBeenCalledWith('p1'));
    expect(await within(row).findByText(/OK \(HTTP 200\)/i)).toBeInTheDocument();
  });

  it('Test on an entry reports 401 as auth rejected', async () => {
    const { api } = mockApi([{
      id: 'p1', name: 'X', hostnames: ['x.com'],
      auth: { type: 'query', param: 'k' }, value: 'V'
    }]);
    api.secrets.test = vi.fn(async (_id: string) => ({ ok: true, status: 401 })) as any;
    (window as any).api = api;
    render(<SettingsModal open={true} onClose={() => {}} />);

    const row = (await screen.findByText('X')).closest('[data-row]') as HTMLElement;
    await userEvent.click(within(row).getByRole('button', { name: /^test$/i }));

    expect(await within(row).findByText(/auth rejected/i)).toBeInTheDocument();
  });

  it('Delete on an entry calls api.secrets.delete and refreshes', async () => {
    const { api, state } = mockApi([{
      id: 'p1', name: 'X', hostnames: ['x.com'],
      auth: { type: 'query', param: 'k' }, value: 'V'
    }]);
    (window as any).api = api;
    render(<SettingsModal open={true} onClose={() => {}} />);

    const row = (await screen.findByText('X')).closest('[data-row]') as HTMLElement;
    await userEvent.click(within(row).getByRole('button', { name: /delete/i }));

    await waitFor(() => expect(api.secrets.delete).toHaveBeenCalledWith('p1'));
    await waitFor(() => expect(state).toHaveLength(0));
  });

  it('Widgets section lists every widget with edit + delete; empty list shows hint', async () => {
    const { api } = mockApi([]);
    (api as any).listWidgets = vi.fn(async () => []);
    (window as any).api = api;
    const { rerender } = render(<SettingsModal open={true} onClose={() => {}} />);

    await userEvent.click(await screen.findByRole('button', { name: /^widgets$/i }));
    expect(await screen.findByText(/no widgets yet/i)).toBeInTheDocument();

    (api as any).listWidgets = vi.fn(async () => [
      { uuid: 'a', prompt: 'show weather', created_at: '2026-05-01T12:00:00Z', pinned: true },
      { uuid: 'b', prompt: 'top hn stories', created_at: '2026-05-15T12:00:00Z' }
    ]);
    rerender(<SettingsModal open={false} onClose={() => {}} />);
    rerender(<SettingsModal open={true} onClose={() => {}} />);
    await userEvent.click(await screen.findByRole('button', { name: /^widgets$/i }));

    expect(await screen.findByText('show weather')).toBeInTheDocument();
    expect(screen.getByText('top hn stories')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^edit$/i })).toHaveLength(2);
  });

  it('Widgets section: prefers summary.name over prompt; falls back when missing', async () => {
    const { api } = mockApi([]);
    (api as any).listWidgets = vi.fn(async () => [
      { uuid: 'a', prompt: 'make it blue', created_at: '', summary: { sources: [], name: 'Local Weather' } },
      { uuid: 'b', prompt: 'top hn stories', created_at: '' }
    ]);
    (window as any).api = api;
    render(<SettingsModal open={true} onClose={() => {}} />);

    await userEvent.click(await screen.findByRole('button', { name: /^widgets$/i }));

    expect(await screen.findByText('Local Weather')).toBeInTheDocument();
    expect(screen.queryByText('make it blue')).toBeNull();
    expect(screen.getByText('top hn stories')).toBeInTheDocument();
  });

  it('Widgets section: clicking Edit invokes onEditWidget with the row uuid', async () => {
    const { api } = mockApi([]);
    (api as any).listWidgets = vi.fn(async () => [
      { uuid: 'a', prompt: 'show weather', created_at: '' }
    ]);
    const onEditWidget = vi.fn();
    (window as any).api = api;
    render(<SettingsModal open={true} onClose={() => {}} onEditWidget={onEditWidget} />);

    await userEvent.click(await screen.findByRole('button', { name: /^widgets$/i }));
    await userEvent.click(await screen.findByRole('button', { name: /^edit$/i }));

    expect(onEditWidget).toHaveBeenCalledWith('a');
  });

  it('Widgets section: Delete requires two clicks, then invokes onDeleteWidget and removes the row', async () => {
    const { api } = mockApi([]);
    (api as any).listWidgets = vi.fn(async () => [
      { uuid: 'a', prompt: 'show weather', created_at: '' },
      { uuid: 'b', prompt: 'top hn stories', created_at: '' }
    ]);
    const onDeleteWidget = vi.fn();
    (window as any).api = api;
    render(<SettingsModal open={true} onClose={() => {}} onDeleteWidget={onDeleteWidget} />);

    await userEvent.click(await screen.findByRole('button', { name: /^widgets$/i }));

    const row = (await screen.findByText('show weather')).closest('[data-row]') as HTMLElement;
    await userEvent.click(within(row).getByRole('button', { name: /^delete$/i }));
    expect(onDeleteWidget).not.toHaveBeenCalled();

    await userEvent.click(within(row).getByRole('button', { name: /click to confirm/i }));
    expect(onDeleteWidget).toHaveBeenCalledWith('a');
    expect(screen.queryByText('show weather')).toBeNull();
    expect(screen.getByText('top hn stories')).toBeInTheDocument();
  });

  it('Geek Mode section toggle hydrates from prefs and persists changes', async () => {
    const { api } = mockApi([]);
    api.prefs.get = vi.fn(async () => ({ geekMode: false }));
    api.prefs.setGeekMode = vi.fn(async () => ({ ok: true }));
    (window as any).api = api;
    render(<SettingsModal open={true} onClose={() => {}} />);

    await userEvent.click(await screen.findByRole('button', { name: /geek mode/i }));

    const checkbox = await screen.findByLabelText(/show data source info/i) as HTMLInputElement;
    expect(checkbox.checked).toBe(false);

    await userEvent.click(checkbox);

    await waitFor(() => expect(api.prefs.setGeekMode).toHaveBeenCalledWith(true));
    expect(checkbox.checked).toBe(true);
  });

  it('shows update status and calls the supplied update handler from the Updates section', async () => {
    const { api } = mockApi([]);
    const onCheckUpdates = vi.fn();
    (window as any).api = api;
    render(
      <SettingsModal
        open={true}
        onClose={() => {}}
        updateState={{ status: 'not-available' }}
        onCheckUpdates={onCheckUpdates}
      />
    );

    await userEvent.click(screen.getByRole('button', { name: /^updates$/i }));

    expect(screen.getByRole('heading', { name: /^updates$/i })).toBeInTheDocument();
    expect(screen.getByText(/up to date/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /check for updates/i }));

    expect(onCheckUpdates).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: /restart to update/i })).toBeNull();
  });

  it('disables Check for updates while the updater is busy (checking / downloading / downloaded)', async () => {
    const { api } = mockApi([]);
    (window as any).api = api;
    const { rerender } = render(
      <SettingsModal open={true} onClose={() => {}} updateState={{ status: 'checking' }} />
    );
    await userEvent.click(await screen.findByRole('button', { name: /^updates$/i }));
    expect(screen.getByRole('button', { name: /check for updates/i })).toBeDisabled();

    rerender(<SettingsModal open={true} onClose={() => {}} updateState={{ status: 'downloading', percent: 40 }} />);
    expect(screen.getByRole('button', { name: /check for updates/i })).toBeDisabled();

    rerender(<SettingsModal open={true} onClose={() => {}} updateState={{ status: 'downloaded', version: '2026.1.0-alpha.21' }} />);
    expect(screen.getByRole('button', { name: /check for updates/i })).toBeDisabled();

    rerender(<SettingsModal open={true} onClose={() => {}} updateState={{ status: 'not-available' }} />);
    expect(screen.getByRole('button', { name: /check for updates/i })).not.toBeDisabled();
  });

  it('shows restart action for downloaded updates and calls the supplied restart handler', async () => {
    const { api } = mockApi([]);
    const onRestartUpdate = vi.fn();
    (window as any).api = api;
    render(
      <SettingsModal
        open={true}
        onClose={() => {}}
        updateState={{ status: 'downloaded', version: '2026.1.0-alpha.10' }}
        onRestartUpdate={onRestartUpdate}
      />
    );

    await userEvent.click(screen.getByRole('button', { name: /^updates$/i }));

    expect(screen.getByText('Update 2026.1.0-alpha.10 ready')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /restart to update/i }));

    expect(onRestartUpdate).toHaveBeenCalledTimes(1);
  });
});
