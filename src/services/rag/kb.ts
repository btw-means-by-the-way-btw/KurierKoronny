import type { KbChunk, KbData, KbDoc } from './types';

let data: KbData | null = null;

/**
 * The knowledge base bundled with the app: official sources cut into passages by
 * `node scripts/kb-build.js build`. Loaded on first use – it is a few megabytes of text, which
 * the chat and network tabs never need.
 */
export function kb(): KbData {
  if (!data) data = require('./kb/kb.json') as KbData;
  return data;
}

export function getDoc(id: string): KbDoc | undefined {
  return kb().docs.find((d) => d.id === id);
}

export function docOfChunk(chunk: number): KbDoc {
  return kb().docs[kb().chunks[chunk].d];
}

/** Passages of a document in reading order; `index` is the passage's index in the whole base. */
export function chunksOf(doc: KbDoc): { index: number; chunk: KbChunk }[] {
  return kb()
    .chunks.slice(doc.first, doc.first + doc.count)
    .map((chunk, i) => ({ index: doc.first + i, chunk }));
}

/** Documents of the source library, grouped in display order. */
export function docsByGroup(): { group: string; docs: KbDoc[] }[] {
  const { groups, docs } = kb();
  return groups.map((group) => ({ group, docs: docs.filter((d) => d.group === group) }));
}

/** Chapters of the national guide are titled by topic alone ("Ewakuacja"): name the guide too. */
export function docLabel(doc: KbDoc): string {
  return doc.group === 'Poradnik bezpieczeństwa' && !doc.title.startsWith('Poradnik') ? `Poradnik bezpieczeństwa: ${doc.title}` : doc.title;
}

/** Where in its document a passage sits: "Plecak ewakuacyjny · s. 26". */
export function chunkPlace(index: number, data: KbData = kb()): string {
  const chunk = data.chunks[index];
  const doc = data.docs[chunk.d];
  const page = chunk.p ? `s. ${chunk.p}` : doc.pages ? `s. ${doc.pages}` : '';
  return [chunk.s, page].filter(Boolean).join(' · ');
}
