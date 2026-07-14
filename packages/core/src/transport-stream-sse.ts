import { boundFetch } from './fetch.js';
import { buildStreamEventsUrl } from './realtime.js';
import { parseSseChunk } from './transport-sse.js';
import type { CausetHttpConfig } from './types.js';

export interface StreamSseTransportOptions {
  realtimeUrl: string;
  cfg: CausetHttpConfig;
  streamId: string;
  forkId?: string;
  fromCursor?: number;
  apiKey?: string;
  onEvent?: (event: Record<string, unknown>) => void;
  onConnected?: () => void;
  onError?: (err: unknown) => void;
  onClose?: () => void;
  fetchImpl?: typeof fetch;
}

/** SSE transport for causet-realtime stream events (replay + live). */
export class CausetTransportStreamSse {
  private abort: AbortController | null = null;
  isConnected = false;
  connId: string | null = null;

  constructor(private readonly opts: StreamSseTransportOptions) {}

  async connect(): Promise<string | null> {
    const fetchImpl = this.opts.fetchImpl ?? boundFetch;
    const token = this.opts.cfg.bearerToken;
    // Token optional when AUTH_LOCAL_OPEN (local docker). Hosted always needs jwt/apiKey.
    const url = buildStreamEventsUrl(this.opts.realtimeUrl, this.opts.cfg, {
      streamId: this.opts.streamId,
      forkId: this.opts.forkId,
      fromCursor: this.opts.fromCursor,
      token: token || undefined,
      apiKey: this.opts.apiKey,
    });

    this.abort = new AbortController();
    const resp = await fetchImpl(url, {
      method: 'GET',
      headers: {
        Accept: 'text/event-stream',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      signal: this.abort.signal,
    });

    if (!resp.ok || !resp.body) {
      throw new Error(`Stream SSE connect failed: ${resp.status}`);
    }

    this.isConnected = true;
    this.connId = `sse-${this.opts.streamId}`;
    this.opts.onConnected?.();

    void this.readLoop(resp.body.getReader());

    return this.connId;
  }

  private async readLoop(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<void> {
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parsed = parseSseChunk(buffer);
        buffer = parsed.remainder;
        for (const ev of parsed.events) {
          if (ev.data && typeof ev.data === 'object' && !Array.isArray(ev.data)) {
            const data = { ...(ev.data as Record<string, unknown>) };
            // Preserve SSE event: name when payload omits event_type
            if (ev.event && ev.event !== 'message' && data.event_type == null && data.eventType == null) {
              data.event_type = ev.event;
            }
            this.opts.onEvent?.(data);
          }
        }
      }
    } catch (err) {
      /* v8 ignore next 2 -- AbortError when disconnect() races the reader */
      if (this.abort?.signal.aborted) return;
      this.opts.onError?.(err);
    } finally {
      this.isConnected = false;
      this.opts.onClose?.();
    }
  }

  disconnect(): void {
    this.abort?.abort();
    this.abort = null;
    this.isConnected = false;
    this.connId = null;
  }
}
