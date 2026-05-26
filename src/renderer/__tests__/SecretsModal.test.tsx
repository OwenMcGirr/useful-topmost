import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SecretsModal from '../SecretsModal';

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
      })
    }
  };
  return { api, state };
}

beforeEach(() => {
  (window as any).api = undefined;
});

describe('SecretsModal', () => {
  it('renders nothing when open is false', () => {
    const { api } = mockApi();
    (window as any).api = api;
    const { container } = render(<SecretsModal open={false} onClose={() => {}} />);
    expect(container.textContent).toBe('');
  });

  it('shows "No providers yet" when list is empty', async () => {
    const { api } = mockApi([]);
    (window as any).api = api;
    render(<SecretsModal open={true} onClose={() => {}} />);
    expect(await screen.findByText(/no providers yet/i)).toBeInTheDocument();
  });

  it('lists existing providers by name', async () => {
    const { api } = mockApi([{
      id: '1', name: 'OpenWeather',
      hostnames: ['api.openweathermap.org'],
      auth: { type: 'query', param: 'appid' }, value: 'X'
    }]);
    (window as any).api = api;
    render(<SecretsModal open={true} onClose={() => {}} />);
    expect(await screen.findByText('OpenWeather')).toBeInTheDocument();
  });

  it('Add → fill form → Save calls api.secrets.save with typed values', async () => {
    const { api } = mockApi([]);
    (window as any).api = api;
    render(<SecretsModal open={true} onClose={() => {}} />);

    await userEvent.click(await screen.findByRole('button', { name: /add provider/i }));
    await userEvent.type(screen.getByLabelText(/^name$/i), 'OpenWeather');
    await userEvent.type(screen.getByLabelText(/hostnames/i), 'api.openweathermap.org');
    // auth.type defaults to 'query'; param field is visible
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
    render(<SecretsModal open={true} onClose={() => {}} />);
    await userEvent.click(await screen.findByRole('button', { name: /add provider/i }));

    await userEvent.selectOptions(screen.getByLabelText(/auth type/i), 'header');

    expect(screen.queryByLabelText(/param/i)).toBeNull();
    expect(screen.getByLabelText(/header name/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/prefix/i)).toBeInTheDocument();
  });

  it('Save with empty name shows inline error and does NOT call save', async () => {
    const { api } = mockApi([]);
    (window as any).api = api;
    render(<SecretsModal open={true} onClose={() => {}} />);
    await userEvent.click(await screen.findByRole('button', { name: /add provider/i }));

    // Leave name empty; fill the rest
    await userEvent.type(screen.getByLabelText(/hostnames/i), 'api.x.com');
    await userEvent.type(screen.getByLabelText(/param/i), 'k');
    await userEvent.type(screen.getByLabelText(/^value$/i), 'v');
    await userEvent.click(screen.getByRole('button', { name: /^save$/i }));

    expect(screen.getByText(/name is required/i)).toBeInTheDocument();
    expect(api.secrets.save).not.toHaveBeenCalled();
  });

  it('editing an existing entry pre-fills metadata; value field is empty', async () => {
    const { api } = mockApi([{
      id: 'p1', name: 'OpenWeather',
      hostnames: ['api.openweathermap.org', 'pro.openweathermap.org'],
      auth: { type: 'query', param: 'appid' }, value: 'EXISTING'
    }]);
    (window as any).api = api;
    render(<SecretsModal open={true} onClose={() => {}} />);

    await userEvent.click(await screen.findByRole('button', { name: /edit/i }));

    expect((screen.getByLabelText(/^name$/i) as HTMLInputElement).value).toBe('OpenWeather');
    expect((screen.getByLabelText(/hostnames/i) as HTMLTextAreaElement).value)
      .toBe('api.openweathermap.org\npro.openweathermap.org');
    expect((screen.getByLabelText(/^value$/i) as HTMLInputElement).value).toBe('');
  });

  it('Delete on an entry calls api.secrets.delete and refreshes', async () => {
    const { api, state } = mockApi([{
      id: 'p1', name: 'X', hostnames: ['x.com'],
      auth: { type: 'query', param: 'k' }, value: 'V'
    }]);
    (window as any).api = api;
    render(<SecretsModal open={true} onClose={() => {}} />);

    const row = (await screen.findByText('X')).closest('[data-row]') as HTMLElement;
    await userEvent.click(within(row).getByRole('button', { name: /delete/i }));

    await waitFor(() => expect(api.secrets.delete).toHaveBeenCalledWith('p1'));
    await waitFor(() => expect(state).toHaveLength(0));
  });

  it('Check for updates calls the supplied update handler', async () => {
    const { api } = mockApi([]);
    const onCheckUpdates = vi.fn();
    (window as any).api = api;
    render(
      <SecretsModal
        open={true}
        onClose={() => {}}
        updateState={{ status: 'not-available' }}
        onCheckUpdates={onCheckUpdates}
      />
    );

    expect(await screen.findByText(/up to date/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /check for updates/i }));

    expect(onCheckUpdates).toHaveBeenCalledTimes(1);
  });
});
