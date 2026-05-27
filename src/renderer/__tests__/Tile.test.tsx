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
        onCycleSize={() => {}}
        onCancel={() => {}}
        onRetry={() => {}}
      />
    );
    expect(screen.getByText(/building/i)).toBeInTheDocument();
  });

  it('building tile shows a Cancel button that calls onCancel', async () => {
    const onCancel = vi.fn();
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
        onCycleSize={() => {}}
        onCancel={onCancel}
        onRetry={() => {}}
      />
    );
    await userEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalled();
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
        onCycleSize={() => {}}
        onCancel={() => {}}
        onRetry={() => {}}
      />
    );
    const wv = container.querySelector('webview');
    expect(wv).not.toBeNull();
    expect(wv!.getAttribute('src')).toBe('file:///path/index.html');
  });

  it('shows error message + Retry + Delete when state is error', async () => {
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
    const deleteBtn = screen.getByRole('button', { name: /delete/i });
    await userEvent.click(deleteBtn);
    expect(onDismiss).not.toHaveBeenCalled();
    await userEvent.click(deleteBtn);
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
    const deleteBtn = screen.getByRole('button', { name: /delete/i });
    await userEvent.click(deleteBtn);
    await userEvent.click(deleteBtn);
    expect(onRefresh).toHaveBeenCalled();
    expect(onEditChat).toHaveBeenCalled();
    expect(onTogglePinned).toHaveBeenCalled();
    expect(onDismiss).toHaveBeenCalled();
  });

  it('delete requires a confirm click before dismissing', async () => {
    const onDismiss = vi.fn();
    render(
      <Tile
        uuid="u1"
        prompt="show weather"
        state={{ kind: 'live' }}
        htmlUrl="file:///x"
        widgetPreloadUrl=""
        onRefresh={() => {}}
        onDismiss={onDismiss}
        onEditChat={() => {}}
        onTogglePinned={() => {}}
        onCycleSize={() => {}}
        onCancel={() => {}}
        onRetry={() => {}}
      />
    );

    const btn = screen.getByRole('button', { name: /^delete$/i });
    await userEvent.click(btn);
    expect(onDismiss).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /click to confirm/i })).toBeInTheDocument();

    await userEvent.click(btn);
    expect(onDismiss).toHaveBeenCalledTimes(1);
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

  it('size button shows the current size and cycles via onCycleSize', async () => {
    const onCycleSize = vi.fn();
    const { rerender } = render(
      <Tile
        uuid="u1"
        prompt="show weather"
        state={{ kind: 'live' }}
        htmlUrl="file:///x"
        widgetPreloadUrl=""
        onRefresh={() => {}}
        onDismiss={() => {}}
        onEditChat={() => {}}
        onTogglePinned={() => {}}
        onCycleSize={onCycleSize}
        onRetry={() => {}}
      />
    );

    await userEvent.click(screen.getByRole('button', { name: /size 1×1/i }));
    expect(onCycleSize).toHaveBeenCalled();

    rerender(
      <Tile
        uuid="u1"
        prompt="show weather"
        state={{ kind: 'live' }}
        htmlUrl="file:///x"
        widgetPreloadUrl=""
        size="large"
        onRefresh={() => {}}
        onDismiss={() => {}}
        onEditChat={() => {}}
        onTogglePinned={() => {}}
        onCycleSize={onCycleSize}
        onRetry={() => {}}
      />
    );
    expect(screen.getByRole('button', { name: /size 2×2/i })).toBeInTheDocument();
  });

  it('renders a pinned indicator badge only when pinned', () => {
    const { container, rerender } = render(
      <Tile
        uuid="u1"
        prompt="show weather"
        state={{ kind: 'live' }}
        htmlUrl="file:///x"
        widgetPreloadUrl=""
        onRefresh={() => {}}
        onDismiss={() => {}}
        onEditChat={() => {}}
        onTogglePinned={() => {}}
        onCycleSize={() => {}}
        onCancel={() => {}}
        onRetry={() => {}}
      />
    );
    expect(container.querySelector('[data-pin-indicator]')).toBeNull();

    rerender(
      <Tile
        uuid="u1"
        prompt="show weather"
        state={{ kind: 'live' }}
        htmlUrl="file:///x"
        widgetPreloadUrl=""
        pinned
        onRefresh={() => {}}
        onDismiss={() => {}}
        onEditChat={() => {}}
        onTogglePinned={() => {}}
        onCycleSize={() => {}}
        onCancel={() => {}}
        onRetry={() => {}}
      />
    );
    expect(container.querySelector('[data-pin-indicator]')).not.toBeNull();
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
