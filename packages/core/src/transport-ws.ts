import type { StreamChannel } from './types.js';

const SDK_VERSION = '0.1.0';

export interface WebSocketTransportOptions {
  wsUrl: string;
  streamId: string;
  forkId?: string;
  /** @deprecated Tenant context is derived from the JWT; not sent in hello. */
  projectId?: string;
  /** @deprecated Use forkId instead. */
  env?: string;
  bearerToken?: string;
  apiKey?: string;
  channels?: StreamChannel[];
  fromCursor?: number;
  onEvent?: (event: Record<string, unknown>) => void;
  onWelcome?: (connId: string | null) => void;
  onError?: (err: unknown) => void;
  onClose?: () => void;
  WebSocketImpl?: typeof WebSocket;
}

export class CausetTransportWebSocket {
  private ws: WebSocket | null = null;
  connId: string | null = null;
  isConnected = false;

  constructor(private readonly opts: WebSocketTransportOptions) {}

  connect(): Promise<string | null> {
    const WS = this.opts.WebSocketImpl ?? WebSocket;
    const url = this.buildUrl();
    const protocols: string[] = [];
    this.ws = new WS(url, protocols);
    return new Promise((resolve, reject) => {
      /* v8 ignore next -- defensive; ws is always set by constructor above */
      if (!this.ws) return reject(new Error('WebSocket unavailable'));
      this.ws.onopen = () => {
        this.ws!.send(JSON.stringify(this.buildHello()));
      };
      this.ws.onmessage = (msg) => {
        try {
          const data = JSON.parse(String(msg.data)) as Record<string, unknown>;
          if (data.type === 'welcome') {
            this.connId = (data.conn_id as string) ?? null;
            this.isConnected = true;
            this.opts.onWelcome?.(this.connId);
            resolve(this.connId);
            return;
          }
          if (data.type === 'error') {
            this.opts.onError?.(data);
            return;
          }
          this.opts.onEvent?.(data);
        } catch (e) {
          this.opts.onError?.(e);
        }
      };
      this.ws.onerror = (e) => {
        this.opts.onError?.(e);
        reject(e);
      };
      this.ws.onclose = () => {
        this.isConnected = false;
        this.opts.onClose?.();
      };
    });
  }

  disconnect(): void {
    this.ws?.close();
    this.ws = null;
    this.isConnected = false;
  }

  private buildUrl(): string {
    const u = new URL(this.opts.wsUrl);
    if (this.opts.apiKey) u.searchParams.set('api_key', this.opts.apiKey);
    if (this.opts.bearerToken) u.searchParams.set('token', this.opts.bearerToken);
    return u.toString();
  }

  private buildHello(): Record<string, unknown> {
    const channels = (this.opts.channels ?? [{ channel: 'ledger' }, { channel: 'state' }]).map(
      (ch) => {
        const entry = { ...ch };
        if (this.opts.fromCursor != null && entry.from_cursor == null) {
          entry.from_cursor = this.opts.fromCursor;
        }
        return entry;
      },
    );
    return {
      type: 'hello',
      v: 1,
      stream_id: this.opts.streamId,
      fork_id: this.opts.forkId ?? this.opts.env ?? 'main',
      subs: channels,
      sdk: { name: 'causet-sdk-js', ver: SDK_VERSION },
    };
  }
}
