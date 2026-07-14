import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import React from 'react';
import { CausetProvider, useCausetClient, useCausetQuery, useCausetIntent, useCausetEntity } from '../hooks.js';

const mockRunQuery = vi.fn();
const mockEmit = vi.fn();
const mockEmitStream = vi.fn();
const mockSubscribe = vi.fn();
const mockGetState = vi.fn();
const mockUnsubscribe = vi.fn();
const mockConnectStream = vi.fn();
const mockDisconnectStream = vi.fn();
const mockOn = vi.fn();
const mockInit = vi.fn();
const mockDestroy = vi.fn();

vi.mock('@causet/sdk-core', () => ({
  CausetClient: vi.fn().mockImplementation(() => ({
    init: mockInit,
    destroy: mockDestroy,
    runQuery: mockRunQuery,
    emit: mockEmit,
    emitStream: mockEmitStream,
    subscribe: mockSubscribe,
    getState: mockGetState,
    unsubscribe: mockUnsubscribe,
    connectStream: mockConnectStream,
    disconnectStream: mockDisconnectStream,
    on: mockOn,
  })),
}));

function TestConsumer() {
  const client = useCausetClient();
  return <div data-testid="client">{client ? 'ok' : 'missing'}</div>;
}

describe('CausetProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInit.mockResolvedValue(undefined);
    mockSubscribe.mockResolvedValue(undefined);
    mockGetState.mockReturnValue({ count: 1 });
    mockOn.mockReturnValue(() => undefined);
    mockRunQuery.mockResolvedValue({ items: [{ id: 1 }] });
    mockEmit.mockResolvedValue({ accepted: true });
  });

  it('provides client to children and calls init/destroy', () => {
    const { unmount } = render(
      <CausetProvider
        options={{
          apiUrl: 'https://api.test',
          platformSlug: 'p',
          appSlug: 'a',
          bearerToken: 'jwt',
        }}
      >
        <TestConsumer />
      </CausetProvider>,
    );
    expect(screen.getByTestId('client').textContent).toBe('ok');
    expect(mockInit).toHaveBeenCalled();
    unmount();
    expect(mockDestroy).toHaveBeenCalled();
  });

  it('useCausetClient throws outside provider', () => {
    function Bad() {
      useCausetClient();
      return null;
    }
    expect(() => render(<Bad />)).toThrow('useCausetClient must be used within CausetProvider');
  });
});

describe('useCausetQuery', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInit.mockResolvedValue(undefined);
    mockRunQuery.mockResolvedValue({ items: [{ id: 42 }] });
  });

  function QueryConsumer() {
    const { data, loading, error, refresh } = useCausetQuery('orders', { user: 'u1' }, { limit: 5 });
    return (
      <div>
        <span data-testid="loading">{String(loading)}</span>
        <span data-testid="error">{error ? 'err' : 'none'}</span>
        <span data-testid="data">{data ? JSON.stringify(data.items) : 'null'}</span>
        <button type="button" onClick={() => void refresh()}>
          refresh
        </button>
      </div>
    );
  }

  it('loads query data', async () => {
    render(
      <CausetProvider options={{ apiUrl: 'https://api', platformSlug: 'p', appSlug: 'a', bearerToken: 't' }}>
        <QueryConsumer />
      </CausetProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('loading').textContent).toBe('false'));
    expect(screen.getByTestId('data').textContent).toBe('[{"id":42}]');
    expect(mockRunQuery).toHaveBeenCalledWith('orders', { user: 'u1' }, { limit: 5, includeTotal: undefined });
  });

  it('sets error on failure', async () => {
    mockRunQuery.mockRejectedValueOnce(new Error('query failed'));
    render(
      <CausetProvider options={{ apiUrl: 'https://api', platformSlug: 'p', appSlug: 'a', bearerToken: 't' }}>
        <QueryConsumer />
      </CausetProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('error').textContent).toBe('err'));
  });

  it('refresh re-runs query', async () => {
    render(
      <CausetProvider options={{ apiUrl: 'https://api', platformSlug: 'p', appSlug: 'a', bearerToken: 't' }}>
        <QueryConsumer />
      </CausetProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('loading').textContent).toBe('false'));
    await act(async () => {
      screen.getByRole('button', { name: 'refresh' }).click();
    });
    expect(mockRunQuery.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});

describe('useCausetIntent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInit.mockResolvedValue(undefined);
    mockEmit.mockResolvedValue({ accepted: true });
    mockEmitStream.mockResolvedValue(undefined);
  });

  function IntentConsumer() {
    const { emit, emitStream, pending } = useCausetIntent();
    return (
      <div>
        <span data-testid="pending">{String(pending)}</span>
        <button type="button" onClick={() => void emit('s', 'e', 'T', { x: 1 })}>
          emit
        </button>
        <button
          type="button"
          onClick={() => void emitStream('s', 'e', 'T', { x: 1 }, () => undefined)}
        >
          stream
        </button>
      </div>
    );
  }

  it('emit sets pending and calls client.emit', async () => {
    render(
      <CausetProvider options={{ apiUrl: 'https://api', platformSlug: 'p', appSlug: 'a', bearerToken: 't' }}>
        <IntentConsumer />
      </CausetProvider>,
    );
    await act(async () => {
      screen.getByRole('button', { name: 'emit' }).click();
    });
    expect(mockEmit).toHaveBeenCalledWith('s', 'e', 'T', { x: 1 });
    expect(screen.getByTestId('pending').textContent).toBe('false');
  });

  it('emitStream delegates to client', async () => {
    render(
      <CausetProvider options={{ apiUrl: 'https://api', platformSlug: 'p', appSlug: 'a', bearerToken: 't' }}>
        <IntentConsumer />
      </CausetProvider>,
    );
    await act(async () => {
      screen.getByRole('button', { name: 'stream' }).click();
    });
    expect(mockEmitStream).toHaveBeenCalled();
  });
});

describe('useCausetEntity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInit.mockResolvedValue(undefined);
    mockSubscribe.mockResolvedValue(undefined);
    mockGetState.mockReturnValue({ status: 'active' });
    mockOn.mockImplementation((_event, handler) => {
      queueMicrotask(() =>
        handler({ streamId: 'orders', entityId: 'e1', state: { status: 'updated' } }),
      );
      return () => undefined;
    });
    mockConnectStream.mockResolvedValue('conn-1');
  });

  function EntityConsumer({ connectWs }: { connectWs?: boolean }) {
    const state = useCausetEntity('orders', 'e1', connectWs);
    return <span data-testid="state">{state ? JSON.stringify(state) : 'null'}</span>;
  }

  it('subscribes and tracks state updates', async () => {
    render(
      <CausetProvider options={{ apiUrl: 'https://api', platformSlug: 'p', appSlug: 'a', bearerToken: 't' }}>
        <EntityConsumer />
      </CausetProvider>,
    );
    await waitFor(() => expect(mockSubscribe).toHaveBeenCalledWith('orders', 'e1'));
    await waitFor(() =>
      expect(screen.getByTestId('state').textContent).toBe('{"status":"updated"}'),
    );
  });

  it('connects websocket when connectWs is true', async () => {
    const { unmount } = render(
      <CausetProvider options={{ apiUrl: 'https://api', platformSlug: 'p', appSlug: 'a', bearerToken: 't' }}>
        <EntityConsumer connectWs />
      </CausetProvider>,
    );
    await waitFor(() => expect(mockConnectStream).toHaveBeenCalledWith('orders'));
    unmount();
    expect(mockUnsubscribe).toHaveBeenCalledWith('orders', 'e1');
    expect(mockDisconnectStream).toHaveBeenCalled();
  });

  it('ignores state events for other entities', async () => {
    mockOn.mockImplementation((_event, handler) => {
      queueMicrotask(() =>
        handler({ streamId: 'other', entityId: 'e1', state: { status: 'ignored' } }),
      );
      queueMicrotask(() =>
        handler({ streamId: 'orders', entityId: 'e1', state: undefined }),
      );
      return () => undefined;
    });
    render(
      <CausetProvider options={{ apiUrl: 'https://api', platformSlug: 'p', appSlug: 'a', bearerToken: 't' }}>
        <EntityConsumer />
      </CausetProvider>,
    );
    await waitFor(() => expect(mockSubscribe).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByTestId('state').textContent).toBe('null'));
  });
});

describe('useCausetQuery edge cases', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInit.mockResolvedValue(undefined);
    mockRunQuery.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve({ items: [] }), 50)),
    );
  });

  function NullInputConsumer() {
    const { loading } = useCausetQuery('orders', null);
    return <span data-testid="loading">{String(loading)}</span>;
  }

  it('handles null input and cancellation on unmount', async () => {
    const { unmount } = render(
      <CausetProvider options={{ apiUrl: 'https://api', platformSlug: 'p', appSlug: 'a', bearerToken: 't' }}>
        <NullInputConsumer />
      </CausetProvider>,
    );
    unmount();
    await new Promise((r) => setTimeout(r, 60));
    expect(mockRunQuery).toHaveBeenCalledWith('orders', null, undefined);
  });
});
