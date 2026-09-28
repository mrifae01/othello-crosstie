/** A request budget: at most `max` per `windowMs`. */
export interface RateLimit {
  max: number;
  windowMs: number;
}

/** Fixed-window request counter: `take` is false once `max` is used up in the current window. */
export class WindowCounter {
  private windows = new Map<string, { start: number; count: number }>();
  constructor(private readonly limit: RateLimit) {}

  take(key: string, now = Date.now()): boolean {
    let w = this.windows.get(key);
    if (!w || now - w.start >= this.limit.windowMs) {
      w = { start: now, count: 0 };
      this.windows.set(key, w);
      if (this.windows.size > 10_000) this.sweep(now);
    }
    if (w.count >= this.limit.max) return false;
    w.count++;
    return true;
  }

  private sweep(now: number) {
    for (const [k, w] of this.windows) if (now - w.start >= this.limit.windowMs) this.windows.delete(k);
  }
}

/**
 * Paid Claude calls allowed per client IP, and for the whole server. Only cache misses count:
 * serving a stored debrief or a cached explanation is free and never limited.
 */
export class ClaudeCallLimiter {
  private readonly perIp: WindowCounter;
  private readonly global: WindowCounter;

  constructor(perIp: RateLimit, global: RateLimit) {
    this.perIp = new WindowCounter(perIp);
    this.global = new WindowCounter(global);
  }

  /** Spends one call for `clientIp`; false once either budget is used up. */
  allow(clientIp: string): boolean {
    return this.perIp.take(clientIp) && this.global.take('*');
  }
}
