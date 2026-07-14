export function getPath(obj, path) {
    if (!path || !path.startsWith('/'))
        return null;
    let current = obj;
    for (const key of path.slice(1).split('/')) {
        if (current == null || typeof current !== 'object')
            return null;
        if (Array.isArray(current)) {
            const idx = Number(key);
            if (Number.isNaN(idx))
                return null;
            current = current[idx];
        }
        else {
            current = current[key];
        }
    }
    return current;
}
export function setPath(obj, path, value) {
    if (!path || !path.startsWith('/'))
        return;
    const keys = path.slice(1).split('/');
    const last = keys.pop();
    let current = obj;
    for (const key of keys) {
        const child = current[key];
        if (child == null || typeof child !== 'object' || Array.isArray(child)) {
            current[key] = {};
        }
        current = current[key];
    }
    current[last] = value;
}
export function applyPatch(state, ops) {
    if (!Array.isArray(ops))
        return;
    for (const op of ops) {
        const type = op.op;
        const path = op.path ?? '';
        if (!path.startsWith('/'))
            continue;
        if (type === 'replace' || type === 'add') {
            setPath(state, path, op.value);
        }
        else if (type === 'remove') {
            const keys = path.slice(1).split('/');
            const last = keys.pop();
            const parent = keys.length === 0
                ? state
                : getPath(state, `/${keys.join('/')}`);
            if (parent && typeof parent === 'object' && !Array.isArray(parent)) {
                delete parent[last];
            }
        }
    }
}
