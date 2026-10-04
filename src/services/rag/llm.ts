/**
 * The language model behind Kurier, reached through our own proxy: POST { key, query } →
 * { response }. One prompt in, one text out – no roles, no streaming. The proxy rate-limits per
 * address (HTTP 429) and holds the provider's key, so the app only carries the proxy's own key.
 *
 * This is the one place where the app talks to the internet.
 */

/** A reply takes a few seconds; past this the user is told to try again. */
const TIMEOUT_MS = 45_000;

export type LlmErrorKind = 'offline' | 'limit' | 'config' | 'server';

export class LlmError extends Error {
  constructor(
    readonly kind: LlmErrorKind,
    message: string
  ) {
    super(message);
  }
}

export interface LlmConfig {
  url: string | undefined;
  key: string | undefined;
}

const envConfig = (): LlmConfig => ({
  url: process.env.EXPO_PUBLIC_KURIER_API_URL,
  key: process.env.EXPO_PUBLIC_KURIER_API_KEY,
});

export async function askLlm(prompt: string, config: LlmConfig = envConfig()): Promise<string> {
  if (!config.url || !config.key) throw new LlmError('config', 'EXPO_PUBLIC_KURIER_API_URL / _KEY are not set');

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, TIMEOUT_MS);
  try {
    let res: Response;
    try {
      res = await fetch(config.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: config.key, query: prompt }),
        signal: controller.signal,
      });
    } catch (e) {
      if (timedOut) throw new LlmError('server', 'timed out');
      throw new LlmError('offline', e instanceof Error ? e.message : 'request failed');
    }
    if (res.status === 429) throw new LlmError('limit', 'rate limit exceeded');
    if (res.status === 401) throw new LlmError('config', 'the proxy rejected the key');
    if (!res.ok) throw new LlmError('server', `HTTP ${res.status}`);
    const body: unknown = await res.json().catch(() => null);
    const text = (body as { response?: unknown } | null)?.response;
    if (typeof text !== 'string') throw new LlmError('server', 'unexpected response');
    return text;
  } finally {
    clearTimeout(timer);
  }
}
