// In-process TTL cache for hot metadata reads (catalog, routing signals, workspace
// settings, auth, guardrails). Purpose-built for the request hot path:
//   - TTL: cut repeated DB round-trips to ~0 for rarely-changing data.
//   - Single-flight: N concurrent identical loads share ONE DB read (no thundering
//     herd under burst / scale).
//   - Stale-on-error: if the loader throws (e.g. a transient DB blip), serve the last
//     known-good value instead of failing the request.
//   - Bounded: evicts expired + oldest entries past maxEntries so it can't grow
//     unbounded under many distinct keys.

interface Entry<V> {
  value: V;
  expires: number;
}

export interface TtlCache<K, V> {
  get(key: K): Promise<V>;
  invalidate(key?: K): void;
}

export function createTtlCache<K, V>(
  loader: (key: K) => Promise<V>,
  opts: { ttlMs: number; maxEntries?: number; keyOf?: (k: K) => string },
): TtlCache<K, V> {
  const { ttlMs } = opts;
  const max = opts.maxEntries ?? 10_000;
  const keyOf = opts.keyOf ?? ((k: K) => String(k));
  const store = new Map<string, Entry<V>>();
  const inflight = new Map<string, Promise<V>>();

  function prune(): void {
    if (store.size <= max) return;
    const now = Date.now();
    for (const [k, e] of store) if (e.expires <= now) store.delete(k);
    // Map preserves insertion order → drop the oldest first.
    while (store.size > max) {
      const oldest = store.keys().next().value;
      if (oldest === undefined) break;
      store.delete(oldest);
    }
  }

  return {
    async get(key: K): Promise<V> {
      const ks = keyOf(key);
      const hit = store.get(ks);
      if (hit && hit.expires > Date.now()) return hit.value;

      const pending = inflight.get(ks);
      if (pending) return pending;

      const p = loader(key)
        .then((value) => {
          store.set(ks, { value, expires: Date.now() + ttlMs });
          prune();
          return value;
        })
        .catch((err: unknown) => {
          if (hit) return hit.value; // serve stale rather than fail the request
          throw err;
        })
        .finally(() => {
          inflight.delete(ks);
        });
      inflight.set(ks, p);
      return p;
    },
    invalidate(key?: K): void {
      if (key === undefined) store.clear();
      else store.delete(keyOf(key));
    },
  };
}
