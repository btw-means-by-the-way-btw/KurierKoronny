import * as build from '../scripts/kb-build';
import { kb } from '../src/services/rag/kb';
import { parseAnswer, parsePlan, runKurier } from '../src/services/rag/kurier';
import { askLlm, type LlmError } from '../src/services/rag/llm';
import { buildIndex, search, tokenize, type SearchIndex } from '../src/services/rag/search';
import type { KbData, KbDoc, TurnStatus } from '../src/services/rag/types';

const doc = (id: string, title: string, first: number, count: number): KbDoc => ({
  id,
  title,
  publisher: 'RCB',
  group: 'Testy',
  url: `https://example.gov.pl/${id}`,
  format: 'html',
  priority: 'medium',
  license: 'CC BY-SA 4.0',
  fetched: '2026-10-04',
  first,
  count,
});

const DATA: KbData = {
  built: '2026-10-04',
  groups: ['Testy'],
  docs: [doc('ewakuacja', 'Ewakuacja', 0, 2), doc('powodz', 'Powódź', 2, 2), doc('czad', 'Czad', 4, 1)],
  chunks: [
    { d: 0, s: 'Plecak ewakuacyjny', t: 'Do plecaka spakuj wodę, leki, dokumenty i latarkę.' },
    { d: 0, t: 'Zamknij okna i wyłącz gaz. Zabierz zwierzęta.' },
    { d: 1, s: 'Przed powodzią', t: 'Przenieś cenne rzeczy na wyższe piętra. Przygotuj worki z piaskiem.' },
    { d: 1, s: 'Po powodzi', p: 7, t: 'Nie pij wody ze studni, dopóki nie zostanie zbadana.' },
    { d: 2, t: 'Tlenek węgla jest bezwonny. Zamontuj czujkę czadu.' },
  ],
};

const noPause = () => Promise.resolve();

describe('tokenize', () => {
  it('reduces inflected forms to one stem, with or without diacritics', () => {
    expect(new Set(tokenize('powódź powodzi powodzią POWODZIE powodz'))).toEqual(new Set(['powodz']));
    expect(tokenize('plecaka ewakuacyjnego')).toEqual(tokenize('plecak ewakuacyjny'));
    expect(tokenize('prądu')).toEqual(tokenize('prad'));
  });

  it('drops words that carry no meaning and keeps numbers', () => {
    expect(tokenize('Co robić podczas i po?')).toEqual([]);
    expect(tokenize('numer 112')).toEqual(['numer', '112']);
  });
});

describe('search', () => {
  let index: SearchIndex;
  beforeAll(async () => {
    index = await buildIndex(DATA, noPause);
  });

  it('ranks the passage that is about the query first', () => {
    expect(search(index, tokenize('co spakować do plecaka'))[0].chunk).toBe(0);
    expect(search(index, tokenize('worki z piaskiem'))[0].chunk).toBe(2);
  });

  it('counts the section heading and the document title', () => {
    // "czad" is in the passage once and in the title; "powódź" only in the title and a heading.
    expect(search(index, tokenize('czad'))[0].chunk).toBe(4);
    expect(search(index, tokenize('powódź')).map((h) => h.chunk).sort()).toEqual([2, 3]);
  });

  it('matches index words the query word is a prefix of', () => {
    expect(search(index, ['czuj']).map((h) => h.chunk)).toEqual([4]);
    // Too short to be a prefix: three letters match only themselves.
    expect(search(index, ['czu'])).toEqual([]);
  });

  it('prefers passages of the documents it is pointed at', () => {
    const terms = tokenize('woda');
    expect(search(index, terms, { boost: new Set([0]) })[0].chunk).toBe(0);
    expect(search(index, terms, { boost: new Set([1]) })[0].chunk).toBe(3);
  });

  it('limits how many passages one document contributes', () => {
    const hits = search(index, tokenize('powódź plecak'), { perDoc: 1 });
    expect(new Set(hits.map((h) => DATA.chunks[h.chunk].d)).size).toBe(hits.length);
  });
});

describe('parsePlan', () => {
  it('reads the JSON out of a chatty reply and drops what is not usable', () => {
    const plan = parsePlan('Oto plan:\n```json\n{"frazy": ["plecak ewakuacyjny", " "], "dokumenty": [1, 99, "x", 2]}\n```', 3);
    expect(plan).toEqual({ phrases: ['plecak ewakuacyjny'], docs: [0, 1] });
  });

  it('gives null for a reply without a plan', () => {
    expect(parsePlan('Nie wiem.', 3)).toBeNull();
    expect(parsePlan('{"frazy": "plecak"}', 3)).toBeNull();
  });
});

describe('parseAnswer', () => {
  it('renumbers citations by first appearance and drops numbers that point nowhere', () => {
    const { parts, cited } = parseAnswer('- **Spakuj** wodę [3].\n- Weź leki [3][1].\nZamknij okna [1, 7].', 5);
    expect(cited).toEqual([3, 1]);
    expect(parts).toEqual([
      { type: 'text', text: '• Spakuj wodę' },
      { type: 'cite', n: 1 },
      { type: 'text', text: '.\n• Weź leki' },
      { type: 'cite', n: 1 },
      { type: 'cite', n: 2 },
      { type: 'text', text: '.\nZamknij okna' },
      { type: 'cite', n: 2 },
      { type: 'text', text: '.' },
    ]);
  });

  it('expands ranges', () => {
    expect(parseAnswer('Tak [1-3].', 3).cited).toEqual([1, 2, 3]);
  });

  it('finds nothing to cite in an answer without markers', () => {
    expect(parseAnswer('Zadzwoń pod 112.', 3).cited).toEqual([]);
  });
});

describe('runKurier', () => {
  const run = async (question: string, replies: string[]) => {
    const prompts: string[] = [];
    const progress: TurnStatus[] = [];
    const result = await runKurier(
      question,
      {
        data: DATA,
        index: () => buildIndex(DATA, noPause),
        ask: async (prompt) => {
          prompts.push(prompt);
          return replies.shift() ?? 'BRAK';
        },
      },
      (status) => progress.push(status)
    );
    return { result, prompts, progress };
  };
  const PLAN = '{"frazy": ["plecak ewakuacyjny"], "dokumenty": [1]}';

  it('answers from the passages it found and says which', async () => {
    const { result, prompts, progress } = await run('Co spakować?', [PLAN, 'Spakuj wodę, leki i dokumenty [1].']);
    expect(progress).toEqual(['planning', 'searching', 'answering']);
    expect(prompts[0]).toContain('1 | Ewakuacja | Testy');
    expect(prompts[1]).toContain('[1] Ewakuacja – Plecak ewakuacyjny (RCB)\nDo plecaka spakuj wodę');
    expect(result.status).toBe('done');
    expect(result.queries).toEqual(['plecak ewakuacyjny']);
    expect(result.sources).toEqual([{ n: 1, chunk: 0, docId: 'ewakuacja', title: 'Ewakuacja', detail: 'Plecak ewakuacyjny · RCB' }]);
  });

  it('shows no answer the model did not tie to a passage', async () => {
    const { result } = await run('Co spakować?', [PLAN, 'Spakuj wodę, leki i dokumenty.']);
    expect(result.status).toBe('not-found');
    expect(result.parts).toEqual([]);
  });

  it('reports that the sources hold no answer, with the nearest passages', async () => {
    const { result } = await run('Co spakować?', [PLAN, 'BRAK']);
    expect(result.status).toBe('not-found');
    expect(result.sources[0]).toMatchObject({ n: 1, chunk: 0 });
  });

  it('searches once more when the model asks for it, and only once', async () => {
    const { result, prompts, progress } = await run('Co spakować?', [PLAN, 'SZUKAJ: czujka czadu, tlenek węgla', 'Zamontuj czujkę [1].']);
    expect(prompts).toHaveLength(3);
    expect(prompts[1]).toContain('SZUKAJ:');
    expect(prompts[2]).not.toContain('SZUKAJ:');
    expect(progress).toEqual(['planning', 'searching', 'answering', 'searching', 'answering']);
    expect(result.queries).toEqual(['plecak ewakuacyjny', 'czujka czadu', 'tlenek węgla']);
    expect(result.status).toBe('done');
    expect(result.sources.map((s) => s.docId)).toContain('czad');
  });

  it('does not ask for an answer to a question outside its subject', async () => {
    const { result, prompts } = await run('Kto wygrał mecz?', ['{"frazy": [], "dokumenty": []}']);
    expect(prompts).toHaveLength(1);
    expect(result).toEqual({ status: 'not-found', queries: [], parts: [], sources: [] });
  });

  it('falls back to the words of the question when the plan cannot be read', async () => {
    const { result } = await run('czujka czadu', ['???', 'Zamontuj czujkę czadu [1].']);
    expect(result.status).toBe('done');
    expect(result.sources[0].docId).toBe('czad');
  });
});

describe('kb-build', () => {
  const ALT = 'Na białym tle przedstawiono zestaw przedmiotów potrzebnych do przygotowania plecaka ewakuacyjnego.';
  const PAGE = `<html><body><main><article id="main-content"><h2>Ewakuacja</h2>
    <div class="editor-content"><div>
      <p>Jeśli władze zarządzą ewakuację:</p>
      <ul><li>Zamknij okna.</li><li>Zabierz <a href="#">plecak</a>.</li></ul>
      <p><span><strong>Plecak ewakuacyjny</strong></span></p>
      <p>Przygotuj zestaw&nbsp;rzeczy.<br>Dopasuj go do siebie.</p>
    </div></div>
    <h3>Materiały</h3><a href="/attachment/x">Plakat.pdf</a>
    <h3>Zdjęcia (1)</h3>
    <div class="gallery"><a data-modaal-desc="Ewakuacja_str_26" href="/photo/x"><img alt="${ALT}"></a></div>
  </article></main><footer>Stopka serwisu</footer></body></html>`;

  it('takes the article body of a gov.pl page and the descriptions of its illustrations', () => {
    expect(build.htmlToBlocks(PAGE)).toEqual({
      title: 'Ewakuacja',
      pages: [26],
      blocks: [
        { type: 'p', text: 'Jeśli władze zarządzą ewakuację:' },
        { type: 'li', text: '• Zamknij okna.' },
        { type: 'li', text: '• Zabierz plecak.' },
        { type: 'h', text: 'Plecak ewakuacyjny' },
        { type: 'p', text: 'Przygotuj zestaw rzeczy. Dopasuj go do siebie.' },
        { type: 'h', text: 'Opis ilustracji ze strony 26' },
        { type: 'p', text: ALT },
      ],
    });
  });

  it('strips menus and link lists from pages of other sites', () => {
    const body = 'Nie dotykaj znalezionego przedmiotu. Oddal się i zadzwoń pod numer alarmowy 112. '.repeat(6);
    const { blocks } = build.htmlToBlocks(`<html><body><div class="top-menu"><a href="/">Start</a></div>
      <main><ul><li><a href="/a">Aktualności</a></li><li><a href="/b">Kontakt</a></li><li><a href="/c">BIP</a></li></ul>
      <h1>Niewybuch</h1><p>Drukuj</p><p>${body}</p></main></body></html>`);
    expect(blocks).toEqual([
      { type: 'h', text: 'Niewybuch' },
      { type: 'p', text: body.trim() },
    ]);
  });

  it('reads a PDF page: numbers at the edges are page numbers, in the text they are content', () => {
    const page = 'TELEFONY ALARMOWE\n\n112\n\nnumer alarmowy\n(aplikacja Alarm112)\n\nArt. 5. Każdy ma obowiązek\nstosować się do poleceń.\n• zabierz doku-\nmenty\n\n3\n';
    expect(build.pdfPageToBlocks(page, 3)).toEqual([
      { type: 'p', text: 'TELEFONY ALARMOWE', page: 3 },
      { type: 'p', text: '112', page: 3 },
      { type: 'p', text: 'numer alarmowy (aplikacja Alarm112)', page: 3 },
      { type: 'h', text: 'Art. 5', page: 3 },
      { type: 'p', text: 'Art. 5. Każdy ma obowiązek stosować się do poleceń.', page: 3 },
      { type: 'li', text: '• zabierz dokumenty', page: 3 },
    ]);
  });

  it('starts a passage at every heading and every page', () => {
    const passages = build.chunkBlocks([
      { type: 'p', text: 'Wstęp.', page: 1 },
      { type: 'h', text: 'Przed', page: 1 },
      { type: 'p', text: 'Przygotuj się.', page: 1 },
      { type: 'li', text: '• Zrób zapasy.', page: 1 },
      { type: 'p', text: 'Ciąg dalszy.', page: 2 },
    ]);
    expect(passages).toEqual([
      { s: '', p: 1, t: 'Wstęp.' },
      { s: 'Przed', p: 1, t: 'Przygotuj się.\n• Zrób zapasy.' },
      { s: 'Przed', p: 2, t: 'Ciąg dalszy.' },
    ]);
  });

  it('rejects text that is too short or has lost its Polish letters', () => {
    const sound = 'W razie zagrożenia zachowaj spokój, wyłącz gaz i prąd, a następnie opuść budynek. '.repeat(40);
    expect(build.checkText(sound)).toBeNull();
    expect(build.checkText('Kliknij w mapę.')).toMatch(/za mało/);
    expect(build.checkText(sound.replace(/[ąćęłńóśźż]/g, ''))).toMatch(/polskich znaków/);
    expect(build.checkText(sound.replace(/[óś]/g, ' '))).toMatch(/gubi litery/);
  });
});

describe('bundled knowledge base', () => {
  const data = kb();
  let index: SearchIndex;
  beforeAll(async () => {
    index = await buildIndex(data, noPause);
  });

  it('lists every passage under exactly one document, in order', () => {
    let next = 0;
    data.docs.forEach((d, i) => {
      expect(d.first).toBe(next);
      expect(d.count).toBeGreaterThan(0);
      expect(data.groups).toContain(d.group);
      for (let c = d.first; c < d.first + d.count; c++) expect(data.chunks[c].d).toBe(i);
      next += d.count;
    });
    expect(next).toBe(data.chunks.length);
    expect(new Set(data.docs.map((d) => d.id)).size).toBe(data.docs.length);
  });

  it.each([
    ['jak przygotowac dom na dlugi brak pradu', 'poradnikbezpieczenstwa-dlugotrwaly-brak-pradu-blackout'],
    ['Jak postępować podczas powodzi?', 'rcb-jak-postepowac-podczas-powodzi2'],
    ['czad objawy zatrucia', 'rcb-nie-dla-czadu2'],
    ['znalazłem niewybuch w lesie', 'policja-znalazles-niewybuch-nie-dotykaj-go-i-powiadom-sluzby'],
  ])('finds the source for "%s" without help from the model', (question, id) => {
    const found = search(index, tokenize(question)).map((h) => data.docs[data.chunks[h.chunk].d].id);
    expect(found).toContain(id);
  });
});

describe('askLlm', () => {
  const config = { url: 'https://proxy.test/chat', key: 'k' };
  const fetchMock = jest.fn();
  const realFetch = globalThis.fetch;
  beforeAll(() => {
    globalThis.fetch = fetchMock;
  });
  afterAll(() => {
    globalThis.fetch = realFetch;
  });
  const reply = (status: number, body: unknown) => fetchMock.mockResolvedValueOnce({ ok: status < 300, status, json: async () => body });
  const kindOf = (run: Promise<unknown>) => run.then(() => 'ok', (e: LlmError) => e.kind);

  it('posts the key and the prompt and returns the text', async () => {
    reply(200, { response: 'Warszawa' });
    await expect(askLlm('Stolica?', config)).resolves.toBe('Warszawa');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(config.url);
    expect(JSON.parse(init.body)).toEqual({ key: 'k', query: 'Stolica?' });
  });

  it('tells apart no network, the rate limit, a bad key and a broken reply', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Network request failed'));
    expect(await kindOf(askLlm('x', config))).toBe('offline');
    reply(429, { detail: 'Rate limit exceeded' });
    expect(await kindOf(askLlm('x', config))).toBe('limit');
    reply(401, { detail: 'Invalid key' });
    expect(await kindOf(askLlm('x', config))).toBe('config');
    reply(502, {});
    expect(await kindOf(askLlm('x', config))).toBe('server');
    reply(200, { odpowiedz: 'x' });
    expect(await kindOf(askLlm('x', config))).toBe('server');
    expect(await kindOf(askLlm('x', { url: undefined, key: undefined }))).toBe('config');
  });
});
