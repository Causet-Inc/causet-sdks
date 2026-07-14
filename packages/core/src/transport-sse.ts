import { boundFetch } from './fetch.js';
import type { CausetHttpConfig, SseEvent } from './types.js';

export type SseHandler = (event: SseEvent) => void;

/** Parse SSE text chunks into discrete events. */
export function parseSseChunk(buffer: string): { events: SseEvent[]; remainder: string } {
  const events: SseEvent[] = [];
  const blocks = buffer.split('\n\n');
  const remainder = blocks.pop() ?? '';
  for (const block of blocks) {
    if (!block.trim()) continue;
    let id: string | undefined;
    let event: string | undefined;
    const dataLines: string[] = [];
    for (const line of block.split('\n')) {
      if (line.startsWith('id:')) id = line.slice(3).trim();
      else if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
    }
    if (dataLines.length === 0) continue;
    const raw = dataLines.join('\n');
    let data: unknown = raw;
    try {
      data = JSON.parse(raw);
    } catch {
      /* keep string */
    }
    events.push({ id, event, data });
  }
  return { events, remainder };
}

/** Stream intent submission progress via SSE (POST .../intents/submit). */
export async function submitIntentStream(
  cfg: CausetHttpConfig,
  body: Record<string, unknown>,
  onEvent: SseHandler,
  fetchImpl: typeof fetch = boundFetch,
  signal?: AbortSignal,
): Promise<void> {
  const url = `${cfg.apiUrl.replace(/\/+$/, '')}/v1/runtime/stream/platforms/${encodeURIComponent(cfg.platformSlug)}/applications/${encodeURIComponent(cfg.appSlug)}/intents/submit`;
  const hdrs: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'text/event-stream',
  };
  if (cfg.bearerToken) hdrs.Authorization = `Bearer ${cfg.bearerToken}`;

  const resp = await fetchImpl(url, {
    method: 'POST',
    headers: hdrs,
    body: JSON.stringify(body),
    signal,
  });
  if (!resp.ok || !resp.body) {
    throw new Error(`SSE intent submit failed: ${resp.status}`);
  }
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parsed = parseSseChunk(buffer);
    buffer = parsed.remainder;
    for (const ev of parsed.events) onEvent(ev);
  }
}

/** Browser EventSource helper when GET SSE endpoints are available. */
export function openEventSource(
  url: string,
  onEvent: SseHandler,
  onError?: (err: Event) => void,
): EventSource {
  const es = new EventSource(url);
  es.onmessage = (msg) => {
    let data: unknown = msg.data;
    try {
      data = JSON.parse(msg.data);
    } catch {
      /* keep string */
    }
    onEvent({ id: msg.lastEventId, event: msg.type, data });
  };
  es.onerror = (e) => onError?.(e);
  return es;
}
