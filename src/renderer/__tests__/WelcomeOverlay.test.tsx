import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import WelcomeOverlay, { EXAMPLE_PROMPTS } from '../WelcomeOverlay';

describe('WelcomeOverlay', () => {
  it('renders headline, intro, and all three example prompt chips', () => {
    render(<WelcomeOverlay onDismiss={() => {}} onUseExample={() => {}} />);

    expect(screen.getByText(/welcome to useful-topmost/i)).toBeInTheDocument();
    for (const prompt of EXAMPLE_PROMPTS) {
      expect(screen.getByText(prompt)).toBeInTheDocument();
    }
  });

  it('clicking a chip calls onUseExample with that prompt verbatim', async () => {
    const onUseExample = vi.fn();
    render(<WelcomeOverlay onDismiss={() => {}} onUseExample={onUseExample} />);

    await userEvent.click(screen.getByText(EXAMPLE_PROMPTS[0]));
    expect(onUseExample).toHaveBeenCalledWith(EXAMPLE_PROMPTS[0]);
  });

  it('clicking Dismiss calls onDismiss and not onUseExample', async () => {
    const onDismiss = vi.fn();
    const onUseExample = vi.fn();
    render(<WelcomeOverlay onDismiss={onDismiss} onUseExample={onUseExample} />);

    await userEvent.click(screen.getByRole('button', { name: /dismiss/i }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onUseExample).not.toHaveBeenCalled();
  });

  it('clicking a chip does not also dismiss', async () => {
    const onDismiss = vi.fn();
    const onUseExample = vi.fn();
    render(<WelcomeOverlay onDismiss={onDismiss} onUseExample={onUseExample} />);

    await userEvent.click(screen.getByText(EXAMPLE_PROMPTS[1]));
    expect(onUseExample).toHaveBeenCalledTimes(1);
    expect(onDismiss).not.toHaveBeenCalled();
  });
});
