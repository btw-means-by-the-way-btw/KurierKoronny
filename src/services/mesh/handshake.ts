/**
 * HELLO handshake as a pure state machine (one per link).
 *
 * A signed HELLO alone proves little: it can be recorded and replayed on another link to
 * impersonate its author as a direct neighbour. So each side issues a random challenge and binds
 * the link only to a HELLO that echoes it (`re`) and is addressed to this node:
 *
 *   A → B  HELLO {ch: a}                      (broadcast destination, this link only)
 *   B → A  HELLO {ch: b}
 *   A → B  HELLO {ch: a, re: b}  dest = B     → B binds the link to A
 *   B → A  HELLO {ch: b, re: a}  dest = A     → A binds the link to B
 *
 * The echo is signed together with the destination, so a node cannot obtain B's reply to A's
 * challenge and present it as its own. A node that transparently forwards both HELLOs between two
 * phones can still make them look adjacent – "direct" is a routing hint, never a trust signal.
 */

export interface HandshakeState {
  /** Challenge this node issued on the link (base64). */
  challenge: string;
  /** Peer challenge we already replied to. */
  answered: string | null;
  /** Node id the link is bound to – set exactly once. */
  peer: string | null;
}

export interface HelloStep {
  /** Peer challenge to echo in a reply HELLO, if a reply is due. */
  reply: string | null;
  /** True when this HELLO proves the peer's identity on this link. */
  bind: boolean;
}

const CHALLENGE_RE = /^[A-Za-z0-9+/]{22}==$/; // 16 bytes

export function newHandshake(challenge: string): HandshakeState {
  return { challenge, answered: null, peer: null };
}

/**
 * Feeds one signature-verified HELLO into the handshake (mutates `state`).
 * @param addressedToMe the packet's destination is this node (required for a HELLO carrying `re`)
 */
export function onHello(
  state: HandshakeState,
  origin: string,
  hello: { ch?: unknown; re?: unknown },
  addressedToMe: boolean
): HelloStep {
  const step: HelloStep = { reply: null, bind: false };
  // Once bound, a link never changes its peer – a different origin is ignored outright.
  if (state.peer && state.peer !== origin) return step;

  const hasEcho = hello.re !== undefined;
  if (hasEcho && !state.peer && addressedToMe && hello.re === state.challenge) {
    state.peer = origin;
    step.bind = true;
  }
  if (typeof hello.ch === 'string' && CHALLENGE_RE.test(hello.ch)) {
    // Answer a bare HELLO every time (the peer retries when our reply was lost); answer the
    // challenge inside a reply only once, or the two sides would ping-pong forever.
    if (!hasEcho || state.answered !== hello.ch) {
      state.answered = hello.ch;
      step.reply = hello.ch;
    }
  }
  return step;
}
