import { newHandshake, onHello } from '../src/services/mesh/handshake';

// 16 random bytes in base64 – the shape of a real challenge.
const CH_A = 'AAAAAAAAAAAAAAAAAAAAAA==';
const CH_B = 'BBBBBBBBBBBBBBBBBBBBBA==';
const CH_M = 'CCCCCCCCCCCCCCCCCCCCCA==';

describe('HELLO handshake', () => {
  it('binds both sides after challenge and echo', () => {
    const a = newHandshake(CH_A);
    const b = newHandshake(CH_B);

    // Both initial HELLOs cross on the wire.
    const aSeesHello = onHello(a, 'B', { ch: CH_B }, false);
    const bSeesHello = onHello(b, 'A', { ch: CH_A }, false);
    expect(aSeesHello).toEqual({ reply: CH_B, bind: false });
    expect(bSeesHello).toEqual({ reply: CH_A, bind: false });

    // The replies echo the other side's challenge and are addressed to it.
    expect(onHello(b, 'A', { ch: CH_A, re: CH_B }, true)).toEqual({ reply: null, bind: true });
    expect(onHello(a, 'B', { ch: CH_B, re: CH_A }, true)).toEqual({ reply: null, bind: true });
    expect(a.peer).toBe('B');
    expect(b.peer).toBe('A');
  });

  it('recovers when the first HELLO of one side is lost', () => {
    const a = newHandshake(CH_A);
    const b = newHandshake(CH_B);

    // A's bare HELLO is lost; B's arrives and A replies.
    expect(onHello(a, 'B', { ch: CH_B }, false).reply).toBe(CH_B);
    // B binds on the reply, and answers the challenge it sees there for the first time.
    expect(onHello(b, 'A', { ch: CH_A, re: CH_B }, true)).toEqual({ reply: CH_A, bind: true });
    expect(onHello(a, 'B', { ch: CH_B, re: CH_A }, true)).toEqual({ reply: null, bind: true });
  });

  it('answers a repeated bare HELLO every time (the peer is retrying)', () => {
    const a = newHandshake(CH_A);
    expect(onHello(a, 'B', { ch: CH_B }, false).reply).toBe(CH_B);
    expect(onHello(a, 'B', { ch: CH_B }, false).reply).toBe(CH_B);
  });

  it('does not bind on a replayed HELLO', () => {
    const a = newHandshake(CH_A);
    // A recording of B's HELLO from another session: no echo, or an echo of some old challenge.
    expect(onHello(a, 'B', { ch: CH_B }, false).bind).toBe(false);
    expect(onHello(a, 'B', { ch: CH_B, re: CH_M }, true).bind).toBe(false);
    expect(a.peer).toBeNull();
  });

  it('does not bind on an echo that was addressed to somebody else', () => {
    // Mallory copies A's challenge into her own HELLO to B and forwards B's reply. That reply is
    // signed by B with destination = Mallory, so for A it is not "addressed to me".
    const a = newHandshake(CH_A);
    expect(onHello(a, 'B', { ch: CH_B, re: CH_A }, false).bind).toBe(false);
    expect(a.peer).toBeNull();
  });

  it('binds a link exactly once', () => {
    const a = newHandshake(CH_A);
    expect(onHello(a, 'B', { ch: CH_B, re: CH_A }, true).bind).toBe(true);
    // Neither the same peer again nor a different node can re-bind or get replies.
    expect(onHello(a, 'B', { ch: CH_B, re: CH_A }, true).bind).toBe(false);
    expect(onHello(a, 'M', { ch: CH_M, re: CH_A }, true)).toEqual({ reply: null, bind: false });
    expect(a.peer).toBe('B');
  });

  it('ignores malformed challenges', () => {
    const a = newHandshake(CH_A);
    for (const ch of [undefined, null, 5, '', 'short', 'x'.repeat(500), { toString: () => CH_B }]) {
      expect(onHello(a, 'B', { ch }, false)).toEqual({ reply: null, bind: false });
    }
  });
});
