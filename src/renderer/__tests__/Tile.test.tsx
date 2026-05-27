import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Tile from '../Tile';

describe('Tile', () => {
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
        onRetry={() => {}}
      />
    );
    expect(screen.getByText(/building/i)).toBeInTheDocument();
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
        onRetry={() => {}}
      />
    );
    const wv = container.querySelector('webview');
    expect(wv).not.toBeNull();
    expect(wv!.getAttribute('src')).toBe('file:///path/index.html');
  });

  it('shows error message + Retry + Dismiss when state is error', async () => {
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
    expect(screen.getByText(/codex exited/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(onRetry).toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: /dismiss/i }));
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
    await userEvent.click(screen.getByRole('button', { name: 'pin' }));
    await userEvent.click(screen.getByRole('button', { name: /refresh/i }));
    await userEvent.click(screen.getByRole('button', { name: 'edit with chat' }));
    await userEvent.click(screen.getByRole('button', { name: /dismiss/i }));
    expect(onRefresh).toHaveBeenCalled();
    expect(onEditChat).toHaveBeenCalled();
    expect(onTogglePinned).toHaveBeenCalled();
    expect(onDismiss).toHaveBeenCalled();
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

    await userEvent.click(screen.getByRole('button', { name: 'pin' }));

    expect(onTogglePinned).toHaveBeenCalled();
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

    await userEvent.click(screen.getByRole('button', { name: 'unpin' }));

    expect(onTogglePinned).toHaveBeenCalled();
  });
});
