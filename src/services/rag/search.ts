import type { KbData } from './types';

/**
 * Full-text search over the bundled passages (BM25), done on the phone.
 *
 * Polish inflects heavily, so words are reduced to a rough stem: diacritics folded (people type
 * without them), common endings cut. A query word also matches index words it is a prefix of,
 * which covers most of what the suffix list misses ("schron" finds "schronienie").
 */

const FOLD: Record<string, string> = { ą: 'a', ć: 'c', ę: 'e', ł: 'l', ń: 'n', ó: 'o', ś: 's', ź: 'z', ż: 'z' };

// Longest first: the first ending that leaves at least three letters is cut.
const ENDINGS = ['ami', 'ach', 'owi', 'ego', 'emu', 'ymi', 'imi', 'ych', 'ich', 'iej', 'iem', 'ow', 'om', 'em', 'ie', 'ej', 'ym', 'im', 'ia', 'iu', 'ii', 'a', 'e', 'i', 'o', 'u', 'y'];

const STOPWORDS = new Set(
  ('a aby albo ale bardzo bedzie bez bo by byc byl byla bylo byly co czy dla do gdy gdzie i ich ile itp jak jaka jaki jakie jako jest jesli jeszcze ' +
    'juz kiedy kto ktora ktore ktory ktorych ktorym lub ma mam mi miec mnie moga moge moj moze mozna musi musze na nad nalezy nie niz np o od oraz po ' +
    'pod podczas powinien powinna powinno przed przez przy robic sa sie sobie ta tak takze tam te tego tej ten tez to trzeba tu tych tylko tym u w we ' +
    'wiec wtedy z za ze zeby zrobic')
    .split(' ')
);

const K1 = 1.2;
const B = 0.75;
/** Words of the section heading and the document title count this many times. */
const HEADING_WEIGHT = 2;
/** Share of the score an index word earns when the query word is only its prefix. */
const PREFIX_WEIGHT = 0.6;
const PREFIX_MIN = 4;
const PRIORITY_WEIGHT = { core: 1.2, high: 1.1, medium: 1, low: 0.9 } as const;
/** Guidance changes (alarm signals did in 2025): where sources compete, the newer one leads. */
const recencyWeight = (year?: number) => (!year ? 1 : year >= 2025 ? 1.1 : year <= 2022 ? 0.9 : 1);
/** Passages of documents the planner pointed at. */
const BOOST = 1.6;

export function stem(word: string): string {
  for (const ending of ENDINGS) {
    if (word.length - ending.length >= 3 && word.endsWith(ending)) return word.slice(0, -ending.length);
  }
  return word;
}

/** Text → stems, without stop words. */
export function tokenize(text: string): string[] {
  const folded = text.toLowerCase().replace(/[ąćęłńóśźż]/g, (c) => FOLD[c]);
  const out: string[] = [];
  for (const word of folded.match(/[a-z0-9]+/g) ?? []) {
    if (word.length < 2 || STOPWORDS.has(word)) continue;
    out.push(/\d/.test(word) ? word : stem(word));
  }
  return out;
}

interface Postings {
  chunks: number[];
  /** Weighted term frequency, parallel to `chunks`. */
  tfs: number[];
}

export interface SearchIndex {
  postings: Map<string, Postings>;
  /** Every stem, sorted: prefix lookups are a binary search. */
  vocabulary: string[];
  lengths: number[];
  averageLength: number;
  /** Per passage: weight of its document's priority and age. */
  weights: number[];
  docOf: number[];
}

export interface Hit {
  chunk: number;
  score: number;
}

/**
 * Indexes every passage. Takes a moment on a phone, so it yields to the UI between batches;
 * `pause` is replaceable for tests.
 */
export async function buildIndex(data: KbData, pause: () => Promise<void> = () => new Promise((r) => setTimeout(r, 0))): Promise<SearchIndex> {
  const postings = new Map<string, Postings>();
  const lengths: number[] = [];
  const weights: number[] = [];
  const docOf: number[] = [];
  const titleStems = data.docs.map((d) => tokenize(d.title));
  let total = 0;

  for (let i = 0; i < data.chunks.length; i++) {
    if (i > 0 && i % 300 === 0) await pause();
    const chunk = data.chunks[i];
    const tf = new Map<string, number>();
    let length = 0;
    const add = (stems: string[], weight: number) => {
      for (const s of stems) tf.set(s, (tf.get(s) ?? 0) + weight);
      length += stems.length * weight;
    };
    add(tokenize(chunk.t), 1);
    if (chunk.s) add(tokenize(chunk.s), HEADING_WEIGHT);
    add(titleStems[chunk.d], HEADING_WEIGHT);

    for (const [s, n] of tf) {
      let p = postings.get(s);
      if (!p) postings.set(s, (p = { chunks: [], tfs: [] }));
      p.chunks.push(i);
      p.tfs.push(n);
    }
    lengths.push(length);
    total += length;
    weights.push((PRIORITY_WEIGHT[data.docs[chunk.d].priority] ?? 1) * recencyWeight(data.docs[chunk.d].year));
    docOf.push(chunk.d);
  }

  return {
    postings,
    vocabulary: [...postings.keys()].sort(),
    lengths,
    averageLength: total / Math.max(1, lengths.length),
    weights,
    docOf,
  };
}

/** Index words the query word stands for: itself, and words it is a prefix of. */
function expansions(index: SearchIndex, term: string): string[] {
  if (term.length < PREFIX_MIN) return index.postings.has(term) ? [term] : [];
  const { vocabulary } = index;
  let lo = 0;
  let hi = vocabulary.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (vocabulary[mid] < term) lo = mid + 1;
    else hi = mid;
  }
  const out: string[] = [];
  for (let i = lo; i < vocabulary.length && vocabulary[i].startsWith(term); i++) out.push(vocabulary[i]);
  return out;
}

/**
 * Best passages for the given stems, best first.
 * `boost` holds document indexes whose passages should rank higher; `perDoc` caps how many
 * passages one document may contribute, so an answer draws on more than one source.
 */
export function search(index: SearchIndex, terms: string[], options: { boost?: Set<number>; limit?: number; perDoc?: number } = {}): Hit[] {
  const { boost, limit = 8, perDoc = 3 } = options;
  const total = index.lengths.length;
  const scores = new Map<number, number>();

  for (const term of new Set(terms)) {
    // Every index word a query word stands for is counted as that one word.
    const tf = new Map<number, number>();
    for (const word of expansions(index, term)) {
      const p = index.postings.get(word)!;
      const weight = word === term ? 1 : PREFIX_WEIGHT;
      for (let i = 0; i < p.chunks.length; i++) tf.set(p.chunks[i], (tf.get(p.chunks[i]) ?? 0) + p.tfs[i] * weight);
    }
    if (!tf.size) continue;
    const idf = Math.log(1 + (total - tf.size + 0.5) / (tf.size + 0.5));
    for (const [chunk, n] of tf) {
      const norm = 1 - B + (B * index.lengths[chunk]) / index.averageLength;
      scores.set(chunk, (scores.get(chunk) ?? 0) + (idf * n * (K1 + 1)) / (n + K1 * norm));
    }
  }

  const ranked = [...scores]
    .map(([chunk, score]) => ({ chunk, score: score * index.weights[chunk] * (boost?.has(index.docOf[chunk]) ? BOOST : 1) }))
    .sort((a, b) => b.score - a.score);

  const hits: Hit[] = [];
  const taken = new Map<number, number>();
  for (const hit of ranked) {
    const doc = index.docOf[hit.chunk];
    const n = taken.get(doc) ?? 0;
    if (n >= perDoc) continue;
    taken.set(doc, n + 1);
    hits.push(hit);
    if (hits.length >= limit) break;
  }
  return hits;
}
