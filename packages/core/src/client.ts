import { Emitter } from './emitter.js';
import { CausetApiError, CausetError } from './errors.js';
import {
  submitIntent,
  fetchState,
  getQueryDefinition,
  listEntities,
  listProjections,
  listQueries,
  runQuery,
} from './http-client.js';
import { applyPatch } from './patch.js';
import { generateIntentId } from './intent-id.js';
import { submitIntentStream } from './transport-sse.js';
import { CausetTransportStreamSse } from './transport-stream-sse.js';
import { CausetTransportWebSocket } from './transport-ws.js';
import { ApiKeyTokenManager, orgIdFromToken } from './token-manager.js';
import { deriveRealtimeUrl, deriveWsUrlFromRealtime } from './realtime.js';
import { extractDomainEvents } from './domain-events.js';
import { boundFetch } from './fetch.js';
import type {
  CausetClientOptions,
  CausetHttpConfig,
  IntentResult,
  QueryResult,
  SseEvent,
  StreamChannel,
  StreamConnectOptions,
  StreamTransportMode,
} from './types.js';

interface StreamTransportHandle {
  connect(): Promise<string | null>;
  disconnect(): void;
}

function subKey(streamId: string, entityId: string): string {
  return `${streamId}:${entityId}`;
}

function deepClone<T>(v: T): T {
  return v == null ? v : (JSON.parse(JSON.stringify(v)) as T);
}

interface Subscription {
  state: Record<string, unknown>;
  cursor: number;
}

interface SelectorEntry {
  streamId: string;
  entityId: string;
  selector: (state: Record<string, unknown>) => unknown;
  handler: (value: unknown) => void;
  lastValue?: unknown;
}

export class CausetClient {
  private readonly fetchImpl: typeof fetch;
  private tokenManager: ApiKeyTokenManager | null;
  private subscriptions = new Map<string, Subscription>();
  private emitter = new Emitter();
  private selectors = new Set<SelectorEntry>();
  /** Active live transports keyed by stream id (supports multi-stream SSE/WS). */
  private streamTransports = new Map<string, StreamTransportHandle>();

  readonly apiUrl: string;
  readonly platformSlug: string;
  readonly appSlug: string;
  readonly forkId: string;
  readonly wsUrl: string;
  readonly realtimeUrl: string;
  readonly streamTransportMode: StreamTransportMode;
  private bearerToken: string;
  readonly apiKey: string;
  platformId: string;
  applicationId: string;

  constructor(options: CausetClientOptions) {
    this.apiUrl = options.apiUrl;
    this.platformSlug = options.platformSlug;
    this.appSlug = options.appSlug;
    this.forkId = options.forkId ?? 'main';
    this.platformId = options.platformId ?? '';
    this.applicationId = options.applicationId ?? '';
    this.realtimeUrl = options.realtimeUrl ?? deriveRealtimeUrl(options.apiUrl);
    this.wsUrl = options.wsUrl ?? deriveWsUrlFromRealtime(this.realtimeUrl);
    this.streamTransportMode = options.streamTransport ?? 'websocket';
    this.bearerToken = options.bearerToken ?? '';
    this.apiKey = options.apiKey ?? '';
    this.fetchImpl = options.fetchImpl ?? boundFetch;
    this.tokenManager = this.apiKey
      ? new ApiKeyTokenManager(this.apiUrl, this.apiKey, this.fetchImpl)
      : null;
  }

  private async getToken(): Promise<string | null> {
    if (this.tokenManager) return this.tokenManager.getToken();
    return this.bearerToken || null;
  }

  async getTokenPublic(): Promise<string> {
    const t = await this.getToken();
    if (!t) throw new CausetError('No Causet token — set apiKey or bearerToken');
    return t;
  }

  private httpConfig(token?: string | null): CausetHttpConfig {
    return {
      apiUrl: this.apiUrl,
      platformSlug: this.platformSlug,
      appSlug: this.appSlug,
      forkId: this.forkId,
      bearerToken: token ?? '',
      platformId: this.platformId || undefined,
      applicationId: this.applicationId || undefined,
    };
  }

  private async runWithRetry<T>(fn: (cfg: CausetHttpConfig) => Promise<T>): Promise<T> {
    const token = await this.getToken();
    try {
      return await fn(this.httpConfig(token));
    } catch (e) {
      if (e instanceof CausetApiError && e.statusCode === 401 && this.tokenManager) {
        await this.tokenManager.forceRefresh();
        const token2 = await this.getToken();
        return fn(this.httpConfig(token2));
      }
      throw e;
    }
  }

  async init(): Promise<void> {
    await this.tokenManager?.init();
  }

  destroy(): void {
    this.disconnectStream();
    this.tokenManager?.destroy();
  }

  on(eventType: string, handler: (data: unknown) => void): () => void {
    return this.emitter.on(eventType, handler);
  }

  /**
   * Resolve platform/app slugs → UUIDs via CLI catalog endpoints.
   * Required for realtime SSE hub matching on local/open deployments.
   */
  async resolveIds(): Promise<{ platformId: string; applicationId: string }> {
    if (this.platformId && this.applicationId) {
      return { platformId: this.platformId, applicationId: this.applicationId };
    }
    const token = await this.getToken();
    const hdrs: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) hdrs.Authorization = `Bearer ${token}`;
    const base = this.apiUrl.replace(/\/+$/, '');
    const [plats, apps] = await Promise.all([
      this.fetchImpl(`${base}/v1/cli/platforms`, { headers: hdrs }).then((r) => r.json()),
      this.fetchImpl(`${base}/v1/cli/apps`, { headers: hdrs }).then((r) => r.json()),
    ]);
    const asList = (raw: unknown, keys: string[]): Array<Record<string, unknown>> => {
      if (Array.isArray(raw)) return raw as Array<Record<string, unknown>>;
      if (raw && typeof raw === 'object') {
        for (const k of keys) {
          const v = (raw as Record<string, unknown>)[k];
          if (Array.isArray(v)) return v as Array<Record<string, unknown>>;
        }
      }
      return [];
    };
    const platList = asList(plats, ['platforms', 'data']);
    const appList = asList(apps, ['apps', 'data']);
    const plat = platList.find((p) => p.slug === this.platformSlug || p.id === this.platformSlug);
    const matched = appList.filter((a) => a.slug === this.appSlug || a.id === this.appSlug);
    const app =
      matched.find((a) => !plat || a.platform_id === plat.id || a.platform_id === this.platformSlug) ||
      matched[0];
    if (!plat?.id) throw new CausetError(`Platform not found: ${this.platformSlug}`);
    if (!app?.id) throw new CausetError(`Application not found: ${this.appSlug}`);
    this.platformId = String(plat.id);
    this.applicationId = String(app.id);
    return { platformId: this.platformId, applicationId: this.applicationId };
  }

  async subscribe(streamId: string, entityId: string): Promise<void> {
    const result = await this.runWithRetry((cfg) =>
      fetchState(cfg, streamId, entityId, this.fetchImpl),
    );
    const state = (result.state as Record<string, unknown>) ?? {};
    this.subscriptions.set(subKey(streamId, entityId), {
      state: deepClone(state),
      cursor: result.cursor,
    });
    this.emitter.emit('state', { streamId, entityId, state: this.getState(streamId, entityId) });
    this.notifySelectors(streamId, entityId);
  }

  unsubscribe(streamId: string, entityId: string): void {
    this.subscriptions.delete(subKey(streamId, entityId));
    for (const s of this.selectors) {
      if (s.streamId === streamId && s.entityId === entityId) {
        this.selectors.delete(s);
      }
    }
  }

  getState(streamId: string, entityId: string): Record<string, unknown> | null {
    const sub = this.subscriptions.get(subKey(streamId, entityId));
    return sub ? deepClone(sub.state) : null;
  }

  /**
   * Submit an intent to the Causet runtime. On success the runtime processes the
   * intent and may append committed business events — this call does not emit
   * events directly.
   */
  async submitIntent(
    streamId: string,
    entityId: string,
    intentType: string,
    payload: Record<string, unknown>,
    intentId?: string,
  ): Promise<IntentResult> {
    const result = await this.runWithRetry((cfg) =>
      submitIntent(cfg, streamId, entityId, intentType, payload, intentId, this.fetchImpl),
    );
    if (!result.accepted) {
      throw new CausetError(result.error || `Intent ${intentType} was not accepted`);
    }
    await this.refreshSubscriptionAfterIntent(streamId, entityId, result);
    return result;
  }

  /**
   * @deprecated Use {@link submitIntent}. Submits an intent to the runtime; does not
   * directly append a committed business event.
   */
  async intent(
    streamId: string,
    entityId: string,
    intentType: string,
    payload: Record<string, unknown>,
    intentId?: string,
  ): Promise<IntentResult> {
    return this.submitIntent(streamId, entityId, intentType, payload, intentId);
  }

  /**
   * @deprecated Use {@link submitIntent}. Submits an intent to the runtime; does not
   * directly append a committed business event.
   */
  async emit(
    streamId: string,
    entityId: string,
    intentType: string,
    payload: Record<string, unknown>,
    intentId?: string,
  ): Promise<IntentResult> {
    return this.submitIntent(streamId, entityId, intentType, payload, intentId);
  }

  /** Submit intent and stream SSE progress events (START, COMPLETE, ERROR, …). */
  async intentStream(
    streamId: string,
    entityId: string,
    intentType: string,
    payload: Record<string, unknown>,
    onEvent: (event: SseEvent) => void,
    intentId?: string,
    signal?: AbortSignal,
  ): Promise<void> {
    const token = await this.getTokenPublic();
    const body: Record<string, unknown> = {
      intentId: intentId?.trim() || generateIntentId(),
      forkId: this.forkId,
      streamId,
      entityId,
      intentType,
      payload,
    };
    await submitIntentStream(this.httpConfig(token), body, onEvent, this.fetchImpl, signal);
  }

  async runQuery(
    querySlug: string,
    input?: Record<string, unknown> | null,
    opts: {
      limit?: number;
      offset?: number;
      cursor?: string;
      includeTotal?: boolean;
    } = {},
  ): Promise<QueryResult> {
    return this.runWithRetry((cfg) =>
      runQuery(cfg, querySlug, input, { ...opts, fetchImpl: this.fetchImpl }),
    );
  }

  listQueries(): Promise<unknown> {
    return this.runWithRetry((cfg) => listQueries(cfg, this.fetchImpl));
  }

  getQueryDefinition(querySlug: string): Promise<Record<string, unknown>> {
    return this.runWithRetry((cfg) => getQueryDefinition(cfg, querySlug, this.fetchImpl));
  }

  listProjections(): Promise<unknown> {
    return this.runWithRetry((cfg) => listProjections(cfg, this.fetchImpl));
  }

  listEntities(opts: {
    streamName?: string;
    searchPrefix?: string;
    cursor?: string;
    limit?: number;
  } = {}): Promise<Record<string, unknown>> {
    return this.runWithRetry((cfg) => listEntities(cfg, { ...opts, fetchImpl: this.fetchImpl }));
  }

  async fetchState(streamId: string, entityId: string): Promise<{ state: unknown; cursor: number }> {
    return this.runWithRetry((cfg) => fetchState(cfg, streamId, entityId, this.fetchImpl));
  }

  /**
   * Connect a live stream (WebSocket or SSE). Replaces any prior connection for the
   * same streamId; other streams stay open (use connectStreams for several at once).
   */
  async connectStream(
    streamId: string,
    opts: StreamConnectOptions = {},
  ): Promise<string | null> {
    this.disconnectStream(streamId);
    const token = await this.getToken();
    const mode = opts.transport ?? this.streamTransportMode;
    const onEvent = (event: Record<string, unknown>) => this.handleStreamEvent(streamId, event);

    if (mode === 'sse') {
      const transport = new CausetTransportStreamSse({
        realtimeUrl: this.realtimeUrl,
        cfg: this.httpConfig(token),
        streamId,
        forkId: this.forkId,
        fromCursor: opts.fromCursor,
        apiKey: this.apiKey || undefined,
        fetchImpl: this.fetchImpl,
        onEvent,
        onConnected: () =>
          this.emitter.emit('stream_connected', { streamId, connId: `sse-${streamId}`, transport: 'sse' }),
        onError: (err) => this.emitter.emit('error', err),
        onClose: () => {
          if (this.streamTransports.get(streamId) === transport) {
            this.streamTransports.delete(streamId);
          }
          this.emitter.emit('stream_disconnected', { streamId, transport: 'sse' });
        },
      });
      this.streamTransports.set(streamId, transport);
      return transport.connect();
    }

    if (!token && !this.apiKey) {
      throw new CausetError('WebSocket stream requires apiKey or bearerToken');
    }
    const orgId = (token && orgIdFromToken(token)) || this.platformSlug;
    const transport = new CausetTransportWebSocket({
      wsUrl: this.wsUrl,
      projectId: orgId,
      forkId: this.forkId,
      streamId,
      bearerToken: token || undefined,
      apiKey: this.apiKey || undefined,
      channels: opts.channels,
      fromCursor: opts.fromCursor,
      onEvent,
      onWelcome: (connId) =>
        this.emitter.emit('stream_connected', { streamId, connId, transport: 'websocket' }),
      onError: (err) => this.emitter.emit('error', err),
      onClose: () => {
        if (this.streamTransports.get(streamId) === transport) {
          this.streamTransports.delete(streamId);
        }
        this.emitter.emit('stream_disconnected', { streamId, transport: 'websocket' });
      },
    });
    this.streamTransports.set(streamId, transport);
    return transport.connect();
  }

  /** Connect several live streams with the same options (e.g. wallet + transfer). */
  async connectStreams(
    streamIds: string[],
    opts: StreamConnectOptions = {},
  ): Promise<(string | null)[]> {
    return Promise.all(streamIds.map((id) => this.connectStream(id, opts)));
  }

  /** Disconnect one stream, or all when streamId is omitted. */
  disconnectStream(streamId?: string): void {
    if (streamId) {
      const t = this.streamTransports.get(streamId);
      t?.disconnect();
      this.streamTransports.delete(streamId);
      return;
    }
    for (const t of this.streamTransports.values()) t.disconnect();
    this.streamTransports.clear();
  }

  /** Whether any (or a specific) live stream transport is registered. */
  isStreamConnected(streamId?: string): boolean {
    if (streamId) return this.streamTransports.has(streamId);
    return this.streamTransports.size > 0;
  }

  select(
    streamId: string,
    entityId: string,
    selector: (state: Record<string, unknown>) => unknown,
    handler: (value: unknown) => void,
  ): () => void {
    const entry: SelectorEntry = { streamId, entityId, selector, handler };
    const state = this.getState(streamId, entityId);
    if (state) {
      entry.lastValue = selector(state);
      handler(entry.lastValue);
    }
    this.selectors.add(entry);
    return () => this.selectors.delete(entry);
  }

  private async refreshSubscriptionAfterIntent(
    streamId: string,
    entityId: string,
    result: IntentResult,
  ): Promise<void> {
    const key = subKey(streamId, entityId);
    const sub = this.subscriptions.get(key);
    if (!sub) return;
    if (result.statePatch) {
      const ops =
        typeof result.statePatch === 'string'
          ? JSON.parse(result.statePatch)
          : result.statePatch;
      if (Array.isArray(ops)) {
        applyPatch(sub.state, ops);
        this.emitter.emit('patch_op', { streamId, entityId, ops });
      }
    } else {
      const fresh = await this.runWithRetry((cfg) =>
        fetchState(cfg, streamId, entityId, this.fetchImpl),
      );
      sub.state = deepClone((fresh.state as Record<string, unknown>) ?? {});
      sub.cursor = fresh.cursor;
    }
    this.emitter.emit('state', { streamId, entityId, state: this.getState(streamId, entityId) });
    this.notifySelectors(streamId, entityId);
  }

  private handleStreamEvent(streamId: string, event: Record<string, unknown>): void {
    this.emitter.emit('stream_event', { streamId, event });
    for (const d of extractDomainEvents(event)) {
      this.emitter.emit('domain_event', { streamId, ...d });
    }
    const patch = event.patch;
    const entityId = event.entity_id as string | undefined;
    if (Array.isArray(patch) && entityId) {
      const sub = this.subscriptions.get(subKey(streamId, entityId));
      if (sub) {
        applyPatch(sub.state, patch as Array<{ op?: string; path?: string; value?: unknown }>);
        this.emitter.emit('patch_op', { streamId, entityId, ops: patch });
        this.emitter.emit('state', { streamId, entityId, state: this.getState(streamId, entityId) });
        this.notifySelectors(streamId, entityId);
      }
    }
    const emits = event.emits;
    if (Array.isArray(emits)) {
      this.emitter.emit('emitted', { streamId, entityId, emits });
    }
  }

  private notifySelectors(streamId: string, entityId: string): void {
    const state = this.getState(streamId, entityId);
    if (!state) return; /* v8 ignore next */
    for (const entry of this.selectors) {
      if (entry.streamId !== streamId || entry.entityId !== entityId) continue;
      const next = entry.selector(state);
      if (JSON.stringify(next) !== JSON.stringify(entry.lastValue)) {
        entry.lastValue = deepClone(next);
        entry.handler(entry.lastValue);
      }
    }
  }
}
