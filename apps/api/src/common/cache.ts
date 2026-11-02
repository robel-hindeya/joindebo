/**
 * A small in-process cache for read-heavy numbers that may be a little old:
 * owner reports and news audience counts (plan, section 7, Phase 9). Values
 * live for `ms`; concurrent callers share one database query. Off in tests.
 */
export class TtlCache {
  private readonly store = new Map<string, { until: number; value: Promise<unknown> }>();

  constructor(private readonly ms: number, private readonly max = 5000) {}

  forget(key: string): void {
    this.store.delete(key);
  }

  get<T>(key: string, load: () => Promise<T>): Promise<T> {
    if (process.env.NODE_ENV === 'test') return load();
    const now = Date.now();
    const hit = this.store.get(key);
    if (hit && hit.until > now) return hit.value as Promise<T>;
    if (this.store.size >= this.max) this.store.clear();
    const value = load().catch((e) => { this.store.delete(key); throw e; });
    this.store.set(key, { until: now + this.ms, value });
    return value;
  }
}
