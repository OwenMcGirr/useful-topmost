import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Dashboard from '../Dashboard';

function mockApi() {
  let readyHandler: ((uuid: string) => void) | null = null;
  let errorHandler: ((uuid: string, msg: string) => void) | null = null;
  const api = {
    listWidgets: vi.fn(async () => [] as any),
    createWidget: vi.fn(async (_p: string) => ({ uuid: 'new-uuid' })),
    deleteWidget: vi.fn(async () => ({ ok: true })),
    getWidgetMeta: vi.fn(async () => ({ prompt: 'p', created_at: '' })),
    htmlUrl: vi.fn(async (u: string) => `file:///${u}/index.html`),
    codexAvailable: vi.fn(async () => true),
    widgetPreloadUrl: vi.fn(async () => 'file:///fake/widget.js'),
    onWidgetReady: vi.fn((cb: any) => { readyHandler = cb; return () => {}; }),
    onWidgetError: vi.fn((cb: any) => { errorHandler = cb; return () => {}; }),
    secrets: {
      list: vi.fn(async () => []),
      save: vi.fn(async () => ({ ok: true })),
      delete: vi.fn(async () => ({ ok: true }))
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

  it('renders a gear button that opens the SecretsModal', async () => {
    const m = mockApi();
    (window as any).api = m.api;

    render(<Dashboard />);

    await userEvent.click(await screen.findByRole('button', { name: /settings/i }));
    expect(await screen.findByText(/api providers/i)).toBeInTheDocument();
  });
});
