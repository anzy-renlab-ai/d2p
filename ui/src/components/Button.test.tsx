import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Button } from './Button.js';

describe('Button', () => {
  it('renders children', () => {
    render(<Button>Click me</Button>);
    expect(screen.getByRole('button', { name: 'Click me' })).toBeInTheDocument();
  });

  it('fires onClick', () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Hit</Button>);
    fireEvent.click(screen.getByRole('button', { name: 'Hit' }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('disabled blocks onClick', () => {
    const onClick = vi.fn();
    render(<Button disabled onClick={onClick}>Nope</Button>);
    fireEvent.click(screen.getByRole('button', { name: 'Nope' }));
    expect(onClick).not.toHaveBeenCalled();
  });

  it.each(['primary', 'secondary', 'danger', 'ghost'] as const)('variant %s applies class', (variant) => {
    render(<Button variant={variant}>x</Button>);
    expect(screen.getByRole('button')).toBeInTheDocument();
  });

  it('loading disables button and adds aria-busy', () => {
    const onClick = vi.fn();
    render(<Button loading onClick={onClick}>Submit</Button>);
    const btn = screen.getByRole('button');
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute('aria-busy', 'true');
    fireEvent.click(btn);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('loadingText replaces label while loading', () => {
    render(<Button loading loadingText="LLM thinking…">Submit</Button>);
    expect(screen.getByRole('button')).toHaveTextContent(/LLM thinking…/);
    expect(screen.queryByText('Submit')).not.toBeInTheDocument();
  });

  it('loading renders a spinner svg', () => {
    const { container } = render(<Button loading>Submit</Button>);
    expect(container.querySelector('svg[class*="animate-spin"]')).toBeTruthy();
  });
});
