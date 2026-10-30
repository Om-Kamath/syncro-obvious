// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { ErrorBoundary } from './ErrorBoundary';

function Boom({ message }: { message: string }): never {
  throw new Error(message);
}

describe('ErrorBoundary', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
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
    expect(screen.getByText('Syncro')).toBeDefined();
    expect(screen.getByText(/Render exploded/)).toBeDefined();
    expect(screen.getByRole('button', { name: 'Reload' })).toBeDefined();
  });

  it('reloads the page when the Reload action is clicked', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const reload = vi.fn();
    vi.stubGlobal('location', { reload });
    render(
      <ErrorBoundary>
        <Boom message="Render exploded" />
      </ErrorBoundary>
    );
    fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
