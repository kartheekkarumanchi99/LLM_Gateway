// Minimal in-process TTL memo for the Next.js server (module state persists across
// requests). Single-flight + stale-on-error so bursts share one query and a transient
// DB blip serves the last good value instead of failing the page.
export function ttlMemo<V>(loader: () => Promise<V>, ttlMs: number): () => Promise<V> {
  let entry: { value: V; expires: number } | null = null;
  let inflight: Promise<V> | null = null;
  return () => {
    if (entry && entry.expires > Date.now()) return Promise.resolve(entry.value);
    if (inflight) return inflight;
    inflight = loader()
      .then((value) => {
        entry = { value, expires: Date.now() + ttlMs };
        return value;
      })
      .catch((err: unknown) => {
        if (entry) return entry.value;
        throw err;
      })
      .finally(() => {
        inflight = null;
      });
    return inflight;
  };
}
