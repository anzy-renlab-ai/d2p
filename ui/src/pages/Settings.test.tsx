import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Settings } from './Settings.js';
import { useStore } from '../store.js';

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;
  useStore.setState({ refreshAll: vi.fn(async () => {}) });
  // default response: returns DEFAULT_CONFIG-like
  fetchMock.mockImplementation(async (url: string) => {
    if (typeof url === 'string' && url.endsWith('/api/config')) {
      return {
        ok: true,
        json: async () => ({ config: { engine: { kind: 'claude-cli' } }, path: '/x/config.json' }),
      } as Response;
    }
    return { ok: true, json: async () => ({ ok: true }) } as Response;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Settings page', () => {
  it('renders engine kind radio with claude-cli selected by default', async () => {
    render(<Settings />);
    await waitFor(() => {
      expect(screen.getByText('claude-cli')).toBeInTheDocument();
    });
    expect(screen.getByText('openai-compat')).toBeInTheDocument();
    expect(screen.getByText('anthropic-api')).toBeInTheDocument();
  });

  it('switching to openai-compat reveals key + baseUrl fields', async () => {
    render(<Settings />);
    await waitFor(() => expect(screen.getByText('openai-compat')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('radio', { name: 'openai-compat' }));
    expect(screen.getByText('baseUrl')).toBeInTheDocument();
    expect(screen.getByText('API key')).toBeInTheDocument();
    expect(screen.getByText(/快速预设/)).toBeInTheDocument();
  });

  it('OpenRouter preset fills baseUrl', async () => {
    render(<Settings />);
    await waitFor(() => expect(screen.getByText('openai-compat')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('radio', { name: 'openai-compat' }));
    fireEvent.click(screen.getByRole('button', { name: 'OpenRouter' }));
    const baseInput = screen.getByDisplayValue('https://openrouter.ai/api/v1');
    expect(baseInput).toBeInTheDocument();
  });

  it('save without API key shows error', async () => {
    render(<Settings />);
    await waitFor(() => expect(screen.getByText('openai-compat')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('radio', { name: 'openai-compat' }));
    fireEvent.click(screen.getByRole('button', { name: /保存设置/ }));
    await waitFor(() => {
      expect(screen.getByText(/API key 不能为空/)).toBeInTheDocument();
    });
  });

  it('save with full openai-compat config POSTs /api/config', async () => {
    render(<Settings />);
    await waitFor(() => expect(screen.getByText('openai-compat')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('radio', { name: 'openai-compat' }));
    // fill key (password type, find by label text)
    const inputs = screen.getAllByRole('textbox');
    void inputs;
    const passwords = document.querySelectorAll('input[type="password"]');
    fireEvent.change(passwords[0]!, { target: { value: 'sk-test-key' } });
    fireEvent.click(screen.getByRole('button', { name: /保存设置/ }));
    await waitFor(() => {
      const calls = fetchMock.mock.calls.filter((c: unknown[]) => {
        const init = c[1] as RequestInit | undefined;
        return init?.method === 'POST';
      });
      expect(calls.length).toBeGreaterThan(0);
      const body = JSON.parse((calls[0]![1] as RequestInit).body as string);
      expect(body.engine.kind).toBe('openai-compat');
      expect(body.engine.apiKey).toBe('sk-test-key');
    });
  });
});
