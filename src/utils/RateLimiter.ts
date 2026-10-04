/**
 * Token bucket: `capacity` tokens, refilled continuously at `refillPerSec`.
 * Used for flood protection on incoming links, per-origin traffic and outgoing user messages.
 */
export class TokenBucket {
  private tokens: number;
  private last = Date.now();

  constructor(
    private readonly capacity: number,
    private readonly refillPerSec: number
  ) {
    this.tokens = capacity;
  }

  tryTake(cost = 1): boolean {
    this.refill();
    if (this.tokens < cost) return false;
    this.tokens -= cost;
    return true;
  }

  /** Milliseconds until `cost` tokens are available again. */
  msUntilAvailable(cost = 1): number {
    this.refill();
    if (this.tokens >= cost) return 0;
    return Math.ceil(((cost - this.tokens) / this.refillPerSec) * 1000);
  }

  private refill() {
    const now = Date.now();
    this.tokens = Math.min(this.capacity, this.tokens + ((now - this.last) / 1000) * this.refillPerSec);
    this.last = now;
  }
}

/** Keyed token buckets with idle eviction (per link / per origin). */
export class KeyedRateLimiter {
  private buckets = new Map<string, { bucket: TokenBucket; lastUsed: number }>();

  constructor(
    private readonly capacity: number,
    private readonly refillPerSec: number,
    private readonly maxKeys = 512
  ) {}

  tryTake(key: string, cost = 1): boolean {
    let entry = this.buckets.get(key);
    if (!entry) {
      if (this.buckets.size >= this.maxKeys) this.evictOldest();
      entry = { bucket: new TokenBucket(this.capacity, this.refillPerSec), lastUsed: Date.now() };
      this.buckets.set(key, entry);
    }
    entry.lastUsed = Date.now();
    return entry.bucket.tryTake(cost);
  }

  delete(key: string) {
    this.buckets.delete(key);
  }

  private evictOldest() {
    let oldestKey: string | null = null;
    let oldest = Infinity;
    for (const [k, v] of this.buckets) {
      if (v.lastUsed < oldest) {
        oldest = v.lastUsed;
        oldestKey = k;
      }
    }
    if (oldestKey) this.buckets.delete(oldestKey);
  }
}
