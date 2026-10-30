// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { ErrorBoundary } from './ErrorBoundary';

function Boom({ message }: { message: string }): never {
  throw new Error(message);
}

describe('ErrorBoundary', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders children when nothing throws', () => {
    render(
      <ErrorBoundary>
        <p>Editor content</p>
      </ErrorBoundary>
    );
    expect(screen.getByText('Editor content')).toBeDefined();
  });

  it('shows the boundary UI when a child throws during render', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <ErrorBoundary>
        <Boom message="Render exploded" />
      </ErrorBoundary>
    );
    expect(screen.getByText('Something went wrong')).toBeDefined();
    expect(screen.getByText(/Render exploded/)).toBeDefined();
    expect(screen.getByRole('button', { name: 'Reload' })).toBeDefined();
  });
});
