/**
 * Bounded, time-limited set of packets already processed.
 *
 * This is the core of loop-free flooding: every node relays a packet at most once,
 * so a broadcast crosses each link at most twice regardless of topology cycles.
 * Insertion-ordered Map gives us cheap LRU eviction.
 *
 * Keys are `origin + packetId` and are added only after the packet's signature was verified:
 * otherwise anyone could "use up" a victim's packet id and make nodes drop the real packet.
 * The TTL must exceed the router's freshness window, so a packet cannot be replayed once forgotten.
 */
export class SeenCache {
  private entries = new Map<string, number>();

  constructor(
    private readonly maxEntries = 16_384,
    private readonly ttlMs = 25 * 60_000
  ) {}

  add(id: string) {
    this.entries.delete(id);
    this.entries.set(id, Date.now());
    if (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
  }

  has(id: string): boolean {
    const seenAt = this.entries.get(id);
    return seenAt !== undefined && Date.now() - seenAt < this.ttlMs;
  }

  clear() {
    this.entries.clear();
  }
}
