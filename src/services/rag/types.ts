/** One source document of the knowledge base (written by scripts/kb-build.js). */
export interface KbDoc {
  id: string;
  title: string;
  publisher: string;
  /** Section of the source library the document is listed under. */
  group: string;
  url: string;
  format: 'html' | 'pdf';
  priority: 'core' | 'high' | 'medium' | 'low';
  year?: number;
  /** Pages of the printed guide a chapter page was typeset from, e.g. "25–27". */
  pages?: string;
  license: string;
  /** Day the source was downloaded (YYYY-MM-DD). */
  fetched: string;
  /** Index of the document's first passage and how many it has; they are contiguous. */
  first: number;
  count: number;
}

/** One passage. Passages of a document do not overlap: in order they are the whole text. */
export interface KbChunk {
  /** Index of the document in `docs`. */
  d: number;
  /** Heading the passage sits under. */
  s?: string;
  /** Page of the PDF. */
  p?: number;
  t: string;
}

export interface KbData {
  /** Day the knowledge base was built (YYYY-MM-DD). */
  built: string;
  /** Group names in display order. */
  groups: string[];
  docs: KbDoc[];
  chunks: KbChunk[];
}

/** A piece of an answer: plain text, or a citation marker pointing at the source numbered `n`. */
export type AnswerPart = { type: 'text'; text: string } | { type: 'cite'; n: number };

/** A passage shown under an answer: one it cites or, when nothing was found, a near miss. */
export interface SourceRef {
  /** Number used by the citation markers in the answer. */
  n: number;
  /** Passage index: opens the reader at this passage. */
  chunk: number;
  docId: string;
  title: string;
  /** Section, page and publisher, e.g. "Plecak ewakuacyjny · s. 26 · MON, MSWiA, RCB". */
  detail: string;
}

/**
 * planning  – Kurier is choosing what to look for (network)
 * searching – looking through the bundled sources (on the phone)
 * answering – writing the answer from the passages found (network)
 * done      – `parts` and `sources` hold a cited answer
 * not-found – the sources do not answer the question; `sources` may list the nearest passages
 * error     – `error` says what went wrong
 */
export type TurnStatus = 'planning' | 'searching' | 'answering' | 'done' | 'not-found' | 'error';

/** One question and what became of it. */
export interface RagTurn {
  id: string;
  question: string;
  status: TurnStatus;
  /** Phrases Kurier searched the sources for. */
  queries: string[];
  parts: AnswerPart[];
  sources: SourceRef[];
  error?: string;
}
