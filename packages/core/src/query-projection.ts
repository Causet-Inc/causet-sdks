export function flattenProjectionRow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const byShort = new Map<string, Array<[string, unknown]>>();
  for (const [k, v] of Object.entries(row)) {
    if (typeof k !== 'string') {
      out[k] = v;
      continue;
    }
    const short = k.includes('.') ? k.split('.').pop()! : k;
    if (!byShort.has(short)) byShort.set(short, []);
    byShort.get(short)!.push([k, v]);
  }
  for (const [short, pairs] of byShort) {
    out[short] = pairs[pairs.length - 1][1];
  }
  return out;
}

export function flattenProjectionItems(items: unknown[]): unknown[] {
  return items.map((r) =>
    r && typeof r === 'object' && !Array.isArray(r)
      ? flattenProjectionRow(r as Record<string, unknown>)
      : r,
  );
}

export function stringifyQueryInput(raw: Record<string, unknown> | null | undefined): Record<string, string> {
  if (!raw) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw)) {
    if (v == null) continue;
    if (typeof v === 'string') out[k] = v;
    else if (typeof v === 'boolean') out[k] = v ? 'true' : 'false';
    else if (typeof v === 'number') out[k] = Number.isInteger(v) ? String(v) : String(v);
    else out[k] = JSON.stringify(v);
  }
  return out;
}
