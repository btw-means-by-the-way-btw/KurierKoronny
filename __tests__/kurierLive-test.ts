import { kb } from '../src/services/rag/kb';
import { runKurier } from '../src/services/rag/kurier';
import { buildIndex } from '../src/services/rag/search';

/**
 * Kurier against the real proxy and the bundled sources. Skipped unless asked for, because every
 * question spends two or three of the proxy's rate-limited requests:
 *
 *   KURIER_LIVE=1 node --env-file=.env.local node_modules/jest/bin/jest.js __tests__/kurierLive-test.ts
 *
 * KURIER_ONLY=2,5 runs just those questions. The answers are printed: read them.
 */
const live = process.env.KURIER_LIVE === '1' ? describe : describe.skip;

interface Case {
  n: number;
  question: string;
  status: 'done' | 'not-found';
  /** One of the cited sources should come from a document whose id matches. */
  source?: RegExp;
}

const CASES: Case[] = [
  { question: 'Co spakować do plecaka ewakuacyjnego?', status: 'done' as const, source: /ewakuac|plecak|badz-gotowy|powodz/ },
  { question: 'Gdzie się schronić podczas nalotu?', status: 'done' as const, source: /atak|schron|instrukcja-reagowania|alarm/ },
  { question: 'Ile wody trzeba mieć w zapasie w domu?', status: 'done' as const, source: /przygotuj|zapas|badz-gotowy|plan/ },
  { question: 'czy brac jodek potasu po awarii elektrowni atomowej', status: 'done' as const, source: /jod|radiac|jadrow|paa|cbrn|chemiczne/ },
  { question: 'Jaki jest najlepszy przepis na sernik?', status: 'not-found' as const },
  { question: 'Co robić, gdy usłyszę syreny alarmowe?', status: 'done' as const, source: /alarm|sygnal|atak|645/ },
  { question: 'Jak udzielić pierwszej pomocy osobie, która nie oddycha?', status: 'done' as const, source: /pierwsz|pomoc|ratunek|pogotowie/ },
  { question: 'Dostałem SMS z linkiem do dopłaty za paczkę. Co robić?', status: 'done' as const, source: /phishing|cert|sms|oszust|cyfrow/ },
  { question: 'Jak przygotować dom na długą przerwę w dostawie prądu?', status: 'done' as const, source: /prad|blackout|zasilania|swiatlo/ },
  { question: 'Kto zostanie następnym prezydentem?', status: 'not-found' as const },
].map((c, i) => ({ n: i + 1, ...c }));

/** jest-expo replaces `fetch` with a mock, so the live check reaches the proxy through Node's https. */
function askProxy(prompt: string): Promise<string> {
  const https = require('https');
  const body = JSON.stringify({ key: process.env.EXPO_PUBLIC_KURIER_API_KEY, query: prompt });
  return new Promise((resolve, reject) => {
    const req = https.request(
      process.env.EXPO_PUBLIC_KURIER_API_URL,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, timeout: 75_000 },
      (res: any) => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (d: string) => (text += d));
        res.on('end', () => (res.statusCode === 200 ? resolve(JSON.parse(text).response) : reject(new Error(`HTTP ${res.statusCode}: ${text.slice(0, 200)}`))));
      }
    );
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end(body);
  });
}

live('Kurier, live', () => {
  jest.setTimeout(240_000);
  const data = kb();
  const index = buildIndex(data);
  const only = process.env.KURIER_ONLY?.split(',').map(Number);

  it.each(CASES.filter((c) => !only || only.includes(c.n)))('$n. $question', async ({ question, status, source }) => {
    const log: string[] = [];
    const started = Date.now();
    const result = await runKurier(
      question,
      {
        data,
        index: () => index,
        ask: async (prompt) => {
          const at = Date.now();
          const reply = await askProxy(prompt);
          log.push(`  [${prompt.length} znaków → ${reply.length} znaków, ${((Date.now() - at) / 1000).toFixed(1)} s]`);
          // The plan as the model gave it, then the passages the answer was written from.
          if (prompt.includes('\nFRAGMENTY\n')) log.push(...(prompt.match(/^\[\d+\] .*$/gm) ?? []).map((h) => `    ${h.slice(0, 150)}`));
          else log.push(`    ${reply.replace(/\s+/g, ' ')}`);
          return reply;
        },
      },
      () => {}
    );
    const answer = result.parts.map((p) => (p.type === 'text' ? p.text : `[${p.n}]`)).join('');
    console.log(
      [
        `PYTANIE: ${question}  (${((Date.now() - started) / 1000).toFixed(1)} s, ${result.status})`,
        ...log,
        `  szukano: ${result.queries.join(', ')}`,
        answer,
        ...result.sources.map((s) => `  [${s.n}] ${s.title} · ${s.detail}  (${s.docId})`),
      ].join('\n')
    );
    expect(result.status).toBe(status);
    if (source) expect(result.sources.some((s) => source.test(s.docId))).toBe(true);
  });
});
