import { create } from 'zustand';

import { kb } from '../services/rag/kb';
import { runKurier } from '../services/rag/kurier';
import { askLlm, LlmError, type LlmErrorKind } from '../services/rag/llm';
import { buildIndex, type SearchIndex } from '../services/rag/search';
import type { RagTurn } from '../services/rag/types';
import { createLogger } from '../utils/logger';
import { randomId } from '../utils/random';

const log = createLogger('kurier');

const ERROR_TEXT: Record<LlmErrorKind, string> = {
  offline: 'Brak połączenia z internetem. Kurier potrzebuje sieci, żeby odpowiedzieć – źródła możesz czytać bez niej.',
  limit: 'Limit pytań jest na razie wyczerpany. Spróbuj ponownie za godzinę.',
  config: 'Kurier nie jest skonfigurowany w tej wersji aplikacji.',
  server: 'Kurier nie odpowiedział. Spróbuj ponownie za chwilę.',
};

// Built once per app run, on the first question.
let index: Promise<SearchIndex> | null = null;

interface RagState {
  /** Questions of this session, oldest first. Not stored: they are gone when the app closes. */
  turns: RagTurn[];
  /** A question is being answered; another cannot be asked until it ends. */
  busy: boolean;
  ask: (question: string) => Promise<void>;
}

export const useRagStore = create<RagState>((set, get) => ({
  turns: [],
  busy: false,

  ask: async (question) => {
    const text = question.trim();
    if (!text || get().busy) return;
    const id = randomId();
    const update = (patch: Partial<RagTurn>) => set((s) => ({ turns: s.turns.map((t) => (t.id === id ? { ...t, ...patch } : t)) }));
    set((s) => ({ busy: true, turns: [...s.turns, { id, question: text, status: 'planning', queries: [], parts: [], sources: [] }] }));
    try {
      const deps = { data: kb(), index: () => (index ??= buildIndex(kb())), ask: askLlm };
      update(await runKurier(text, deps, (status, queries) => update({ status, queries })));
    } catch (e) {
      log.warn('question failed', e);
      update({ status: 'error', error: ERROR_TEXT[e instanceof LlmError ? e.kind : 'server'] });
    } finally {
      set({ busy: false });
    }
  },
}));
