import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import UpdatePrompt from '../UpdatePrompt';

beforeEach(() => {
  (window as any).api = {
    updates: {
      restart: vi.fn(async () => undefined)
    }
  };
});

describe('UpdatePrompt', () => {
  it('renders nothing for idle state', () => {
    const { container } = render(<UpdatePrompt state={{ status: 'idle' }} />);
    expect(container.textContent).toBe('');
  });

  it('shows download progress', () => {
    render(<UpdatePrompt state={{ status: 'downloading', percent: 42.4 }} />);
    expect(screen.getByText('Downloading update 42%')).toBeInTheDocument();
  });

  it('shows restart action for downloaded updates', async () => {
    render(<UpdatePrompt state={{ status: 'downloaded', version: '2026.1.0-alpha.2' }} />);

    expect(screen.getByText('Update 2026.1.0-alpha.2 ready')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /restart/i }));

    expect(window.api.updates.restart).toHaveBeenCalledTimes(1);
  });

  it('dismisses downloaded prompt for later', async () => {
    const { container } = render(<UpdatePrompt state={{ status: 'downloaded', version: '2026.1.0-alpha.2' }} />);

    await userEvent.click(screen.getByRole('button', { name: /later/i }));

    expect(container.textContent).toBe('');
  });
});
