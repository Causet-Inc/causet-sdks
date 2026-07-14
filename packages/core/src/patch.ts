export function getPath(obj: unknown, path: string): unknown {
  if (!path || !path.startsWith('/')) return null;
  let current: unknown = obj;
  for (const key of path.slice(1).split('/')) {
    if (current == null || typeof current !== 'object') return null;
    if (Array.isArray(current)) {
      const idx = Number(key);
      if (Number.isNaN(idx)) return null;
      current = current[idx];
    } else {
      current = (current as Record<string, unknown>)[key];
    }
  }
  return current;
}

export function setPath(obj: Record<string, unknown>, path: string, value: unknown): void {
  if (!path || !path.startsWith('/')) return;
  const keys = path.slice(1).split('/');
  const last = keys.pop()!;
  let current: Record<string, unknown> = obj;
  for (const key of keys) {
    const child = current[key];
    if (child == null || typeof child !== 'object' || Array.isArray(child)) {
      current[key] = {};
    }
    current = current[key] as Record<string, unknown>;
  }
  current[last] = value;
}

export function applyPatch(
  state: Record<string, unknown>,
  ops: Array<{ op?: string; path?: string; value?: unknown }> | null | undefined,
): void {
  if (!Array.isArray(ops)) return;
  for (const op of ops) {
    const type = op.op;
    const path = op.path ?? '';
    if (!path.startsWith('/')) continue;
    if (type === 'replace' || type === 'add') {
      setPath(state, path, op.value);
    } else if (type === 'remove') {
      const keys = path.slice(1).split('/');
      const last = keys.pop()!;
      const parent =
        keys.length === 0
          ? state
          : (getPath(state, `/${keys.join('/')}`) as Record<string, unknown> | null);
      if (parent && typeof parent === 'object' && !Array.isArray(parent)) {
        delete parent[last];
      }
    }
  }
}
