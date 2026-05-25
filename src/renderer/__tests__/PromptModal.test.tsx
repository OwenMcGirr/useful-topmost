import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PromptModal from '../PromptModal';

describe('PromptModal', () => {
  it('renders only when open is true', () => {
    const { rerender } = render(<PromptModal open={false} onSubmit={() => {}} onClose={() => {}} />);
    expect(screen.queryByRole('textbox')).toBeNull();
    rerender(<PromptModal open={true} onSubmit={() => {}} onClose={() => {}} />);
    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });

  it('calls onSubmit with the typed value when the user clicks Create', async () => {
    const onSubmit = vi.fn();
    render(<PromptModal open={true} onSubmit={onSubmit} onClose={() => {}} />);
    await userEvent.type(screen.getByRole('textbox'), 'show the weather');
    await userEvent.click(screen.getByRole('button', { name: /create/i }));
    expect(onSubmit).toHaveBeenCalledWith('show the weather');
  });

  it('calls onClose when the user clicks Cancel', async () => {
    const onClose = vi.fn();
    render(<PromptModal open={true} onSubmit={() => {}} onClose={onClose} />);
    await userEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onClose).toHaveBeenCalled();
  });

  it('pre-fills the input when initialValue is provided', () => {
    render(<PromptModal open={true} initialValue="existing" onSubmit={() => {}} onClose={() => {}} />);
    expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('existing');
  });

  it('does not submit when input is empty', async () => {
    const onSubmit = vi.fn();
    render(<PromptModal open={true} onSubmit={onSubmit} onClose={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: /create/i }));
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
