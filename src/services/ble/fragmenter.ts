/**
 * Link-layer fragmentation.
 *
 * A mesh packet can be larger than one ATT write / notification (MTU - 3 bytes; only
 * 20 bytes before MTU negotiation). Every packet is split into frames:
 *
 *   [streamId u8][index u8][count u8][data...]
 *
 * streamId increments per packet per link, so frames of different packets never mix.
 * The receiver reassembles per (link, streamId) and drops incomplete streams after a timeout.
 *
 * A frame is never longer than MAX_ATT_VALUE, whatever the MTU: with the usual MTU of 517 an
 * "MTU - 3" frame would be 514 bytes, and Android 13+ refuses to write or notify more than 512.
 */

const FRAME_HEADER = 3;
/** Longest attribute value GATT allows. */
const MAX_ATT_VALUE = 512;
const MAX_FRAGMENTS = 255;
const REASSEMBLY_TIMEOUT_MS = 15_000;
const MAX_PENDING_STREAMS = 16;

export function fragment(packet: Uint8Array, streamId: number, mtu: number): Uint8Array[] {
  const chunk = Math.max(1, Math.min(mtu - 3, MAX_ATT_VALUE) - FRAME_HEADER); // 3 bytes ATT header
  const count = Math.max(1, Math.ceil(packet.length / chunk));
  if (count > MAX_FRAGMENTS) throw new Error('Packet too large for link MTU');
  const frames: Uint8Array[] = [];
  for (let i = 0; i < count; i++) {
    const data = packet.subarray(i * chunk, Math.min(packet.length, (i + 1) * chunk));
    const frame = new Uint8Array(FRAME_HEADER + data.length);
    frame[0] = streamId & 0xff;
    frame[1] = i;
    frame[2] = count;
    frame.set(data, FRAME_HEADER);
    frames.push(frame);
  }
  return frames;
}

interface Stream {
  count: number;
  received: number;
  parts: (Uint8Array | undefined)[];
  startedAt: number;
}

/** One reassembler per link. */
export class Reassembler {
  private streams = new Map<number, Stream>();

  /** Feed one frame; returns the full packet when the last fragment arrives. */
  push(frame: Uint8Array): Uint8Array | null {
    if (frame.length < FRAME_HEADER) return null;
    const [streamId, index, count] = frame;
    if (count === 0 || index >= count) return null;
    const data = frame.subarray(FRAME_HEADER);

    if (count === 1) return data.slice();

    this.gc();
    let s = this.streams.get(streamId);
    // A new stream reusing the id (wrap-around, or a sender restart) replaces the stale one.
    if (s && (s.count !== count || (index === 0 && s.parts[0]))) {
      this.streams.delete(streamId);
      s = undefined;
    }
    if (!s) {
      if (this.streams.size >= MAX_PENDING_STREAMS) return null;
      s = { count, received: 0, parts: new Array(count), startedAt: Date.now() };
      this.streams.set(streamId, s);
    }
    if (!s.parts[index]) {
      s.parts[index] = data.slice();
      s.received++;
    }
    if (s.received < s.count) return null;

    this.streams.delete(streamId);
    const total = s.parts.reduce((n, p) => n + (p?.length ?? 0), 0);
    const out = new Uint8Array(total);
    let o = 0;
    for (const p of s.parts) {
      out.set(p!, o);
      o += p!.length;
    }
    return out;
  }

  private gc() {
    const now = Date.now();
    for (const [id, s] of this.streams) {
      if (now - s.startedAt > REASSEMBLY_TIMEOUT_MS) this.streams.delete(id);
    }
  }
}
