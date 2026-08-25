import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Button } from './button';

describe('Button', () => {
  it('renders children', () => {
    render(<Button>Click me</Button>);
    expect(screen.getByRole('button', { name: 'Click me' })).toBeDefined();
  });

  it('is disabled when disabled prop is set', () => {
    render(<Button disabled>Click me</Button>);
    expect(screen.getByRole('button').hasAttribute('disabled')).toBe(true);
  });

  it('uses readable text color for each variant', () => {
    const { rerender } = render(<Button variant="primary">Primary</Button>);
    let button = screen.getByRole('button', { name: 'Primary' });
    expect(button.className).toMatch(/bg-deep-industry-blue/);
    expect(button.className).toMatch(/text-white/);

    rerender(<Button variant="secondary">Secondary</Button>);
    button = screen.getByRole('button', { name: 'Secondary' });
    expect(button.className).toMatch(/text-graphite/);

    rerender(<Button variant="cta">CTA</Button>);
    button = screen.getByRole('button', { name: 'CTA' });
    expect(button.className).toMatch(/bg-signal-amber/);
    expect(button.className).toMatch(/text-graphite/);

    rerender(<Button variant="danger">Danger</Button>);
    button = screen.getByRole('button', { name: 'Danger' });
    expect(button.className).toMatch(/text-white/);
  });

  it('uses explicit padding and 6px radius', () => {
    render(<Button size="md">Padded</Button>);
    const button = screen.getByRole('button', { name: 'Padded' });
    expect(button.className).toMatch(/px-7/);
    expect(button.className).toMatch(/py-3/);
    expect(button.className).toMatch(/rounded-sm/);
  });
});
