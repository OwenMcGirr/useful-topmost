import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import LanSettings from '../LanSettings';

function mockApi(opts: {
  prefs?: { enabled: boolean; port: number };
  webhookPublicBaseUrl?: string;
  state?: { running: boolean; port: number; urls: string[]; error?: string };
  initialState?: { running: boolean; port: number; urls: string[]; error?: string };
  saveResult?: { ok: true } | { ok: false; error: string };
  webhookSaveResult?: { ok: true } | { ok: false; error: string };
} = {}) {
  const getState = vi.fn();
  if (opts.initialState) getState.mockResolvedValueOnce(opts.initialState);
  getState.mockImplementation(async () => opts.state ?? { running: false, port: 32177, urls: [] });

  return {
    prefs: {
      get: vi.fn(async () => ({
        geekMode: false,
        lanServer: opts.prefs ?? { enabled: false, port: 32177 },
        updateChannel: 'stable',
        ...(opts.webhookPublicBaseUrl ? { webhookPublicBaseUrl: opts.webhookPublicBaseUrl } : {})
      })),
      setLanServer: vi.fn(async () => opts.saveResult ?? { ok: true }),
      setGeekMode: vi.fn(async () => ({ ok: true })),
      setWebhookPublicBaseUrl: vi.fn(async () => opts.webhookSaveResult ?? { ok: true })
    },
    lan: {
      getState
    }
  };
}

beforeEach(() => {
  (window as any).api = undefined;
});

describe('LanSettings', () => {
  it('shows disabled state by default', async () => {
    (window as any).api = mockApi();
    render(<LanSettings />);

    expect(await screen.findByText('Local network access is off.')).toBeInTheDocument();
    expect(screen.getByLabelText('Serve dashboard on local network')).not.toBeChecked();
  });

  it('enables LAN access and displays returned URLs', async () => {
    const api = mockApi({
      initialState: { running: false, port: 32177, urls: [] },
      state: { running: true, port: 32177, urls: ['http://192.168.1.8:32177/'] }
    });
    (window as any).api = api;
    render(<LanSettings />);

    await screen.findByText('Local network access is off.');
    await userEvent.click(screen.getByLabelText('Serve dashboard on local network'));

    await waitFor(() => expect(api.prefs.setLanServer).toHaveBeenCalledWith({ enabled: true, port: 32177 }));
    expect(await screen.findByText('http://192.168.1.8:32177/')).toBeInTheDocument();
  });

  it('displays server errors with terminal punctuation', async () => {
    (window as any).api = mockApi({
      prefs: { enabled: true, port: 32177 },
      state: { running: false, port: 32177, urls: [], error: 'Port is already in use' }
    });
    render(<LanSettings />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Port is already in use.');
  });

  it('validates the port before saving', async () => {
    const api = mockApi();
    (window as any).api = api;
    render(<LanSettings />);

    const port = await screen.findByLabelText('Port');
    await userEvent.clear(port);
    await userEvent.type(port, '80');
    await userEvent.click(screen.getByRole('button', { name: 'Save local network settings' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Port must be between 1024 and 65535.');
    expect(api.prefs.setLanServer).not.toHaveBeenCalled();
  });

  it('saves a valid public webhook base URL as an HTTPS origin', async () => {
    const api = mockApi();
    (window as any).api = api;
    render(<LanSettings />);

    const input = await screen.findByLabelText('Public webhook base URL');
    await userEvent.type(input, 'https://example.com/');
    await userEvent.click(screen.getByRole('button', { name: 'Save local network settings' }));

    await waitFor(() => expect(api.prefs.setWebhookPublicBaseUrl).toHaveBeenCalledWith('https://example.com'));
  });

  it('clears the public webhook base URL when the field is blank', async () => {
    const api = mockApi({ webhookPublicBaseUrl: 'https://example.com' });
    (window as any).api = api;
    render(<LanSettings />);

    const input = await screen.findByLabelText('Public webhook base URL');
    expect(input).toHaveValue('https://example.com');
    await userEvent.clear(input);
    await userEvent.click(screen.getByRole('button', { name: 'Save local network settings' }));

    await waitFor(() => expect(api.prefs.setWebhookPublicBaseUrl).toHaveBeenCalledWith(null));
  });

  it('rejects an invalid public webhook base URL with terminal punctuation', async () => {
    const api = mockApi();
    (window as any).api = api;
    render(<LanSettings />);

    const input = await screen.findByLabelText('Public webhook base URL');
    await userEvent.type(input, 'http://example.com/path');
    await userEvent.click(screen.getByRole('button', { name: 'Save local network settings' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Public webhook base URL must be an HTTPS origin.');
    expect(api.prefs.setWebhookPublicBaseUrl).not.toHaveBeenCalled();
  });
});
