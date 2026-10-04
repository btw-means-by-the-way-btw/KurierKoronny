#!/usr/bin/env node
/**
 * Knowledge base for Kurier (the "Informacje" tab): official sources bundled with the app.
 *
 *   node scripts/kb-build.js fetch [--only <id>] [--force]
 *       Downloads every included source from kb/sources.json into kb/raw/ (git-ignored) and
 *       records size, checksum and date in the manifest.
 *
 *   node scripts/kb-build.js build
 *       Extracts the text (HTML with node-html-parser, PDF with `pdftotext` from poppler-utils),
 *       cuts it into passages and writes src/services/rag/kb/kb.json. Sources that fail the
 *       quality checks are reported and left out.
 *
 * kb/sources.json is the hand-edited list of sources: set "include": false (with "excluded":
 * "<why>") to drop one. The passage format is read by src/services/rag/kb.ts – keep the two in
 * sync (__tests__/rag-test.ts runs the extraction and the search on the same data).
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { parse } = require('node-html-parser');

const ROOT = path.join(__dirname, '..');
const MANIFEST_FILE = path.join(ROOT, 'kb', 'sources.json');
const RAW_DIR = path.join(ROOT, 'kb', 'raw');
const OUT_FILE = path.join(ROOT, 'src', 'services', 'rag', 'kb', 'kb.json');

const USER_AGENT = 'Mozilla/5.0 (compatible; KurierKoronnyKB/0.1)';
const FETCH_WORKERS = 4;
const FETCH_PAUSE_MS = 200;
/** A passage is closed once it would grow past MAX, unless it is still shorter than MIN. */
const PASSAGE_MAX = 1100;
const PASSAGE_MIN = 350;
/** Order of the groups in the app's source library. */
const GROUPS = [
  'Poradnik bezpieczeństwa',
  'Rządowe Centrum Bezpieczeństwa',
  'MSWiA: ochrona ludności i numer 112',
  'Straż pożarna',
  'Zdrowie i skażenia',
  'Pogoda i powietrze',
  'Powódź i wody',
  'Cyberbezpieczeństwo',
  'Terroryzm i porządek publiczny',
  'Akty prawne',
  'Inne instytucje',
];

// ---------------------------------------------------------------------------------------------
// Text helpers

/** Collapses whitespace and drops invisible characters that pages use for line-break hints. */
function clean(text) {
  return text
    .replace(/[\u200b\u200c\u200d\u2060\ufeff\u00ad\u0000-\u0008\u000e-\u001f¶]/g, '')
    .replace(/[\s\u00a0]+/g, ' ')
    .trim();
}

/**
 * Why a document's text cannot be used, or null when it looks like sound Polish prose.
 * Catches scanned PDFs, PDFs whose fonts lose diacritics and pages that are only navigation.
 */
function checkText(text) {
  const letters = (text.match(/\p{L}/gu) || []).length;
  if (text.replace(/\s/g, '').length < 200) return 'za mało tekstu';
  const polish = (text.match(/[ąćęłńóśźż]/gi) || []).length;
  if (polish / letters < 0.02) return 'brak polskich znaków (uszkodzona warstwa tekstowa albo inny język)';
  if (letters > 2000 && (!/ó/i.test(text) || !/ś/i.test(text))) return 'tekst gubi litery ó/ś (uszkodzona warstwa tekstowa)';
  if ((text.match(/�/g) || []).length / letters > 0.005) return 'nieczytelne znaki w tekście';
  return null;
}

// ---------------------------------------------------------------------------------------------
// HTML → blocks. A block is { type: 'h' | 'p' | 'li', text, page? }.

const SKIPPED_TAGS = new Set(['script', 'style', 'nav', 'form', 'noscript', 'iframe', 'svg', 'button', 'img', 'picture', 'video', 'audio', 'select']);
/** Page furniture on most sites, but some themes wrap the whole article in one of these. */
const FURNITURE_TAGS = new Set(['header', 'footer', 'aside']);
const FURNITURE_MAX = 2000;
/** Class and id names of menus, breadcrumbs, share bars and the like (sites other than gov.pl). */
const FURNITURE_NAME = /(^|[\s_-])(menu|nav|navbar|navigation|breadcrumbs?|sidebar|cookies?|share|social|skip|skiplinks?|search|pagination|related|newsletter|toolbar|print)([\s_-]|$)/i;
/** Interface labels that survive as text. */
const FURNITURE_TEXT = /^(powrót|drukuj|udostępnij|kontakt|wyszukiwarka|szukaj|pl|en|sprawdź się|czytaj więcej|więcej|menu|przejdź do .{0,40}|post published:.*|data publikacji.*|konwertuj .*|<!doctype.*)$/i;
const HEADING_MAX = 140;
const INLINE_TAGS = new Set(['a', 'span', 'strong', 'b', 'em', 'i', 'u', 'sup', 'sub', 'abbr', 'small', 'mark', 'label', 'font', 'time', 'cite', 'code']);

const tagOf = (node) => (node.rawTagName || '').toLowerCase();

/** A short paragraph set entirely in bold is how gov.pl editors write sub-headings. */
function isBoldHeading(p, text) {
  if (text.length > 120 || /[.:;,]$/.test(text)) return false;
  const bold = clean(p.querySelectorAll('strong, b').map((b) => b.text).join(' '));
  return bold.replace(/\s/g, '') === text.replace(/\s/g, '');
}

function walk(node, out, inline) {
  const flush = () => {
    const text = clean(inline.join(''));
    inline.length = 0;
    if (text) out.push({ type: 'p', text });
  };
  for (const child of node.childNodes) {
    if (child.nodeType === 3) {
      if (child.text.trim()) inline.push(child.text);
      continue;
    }
    if (child.nodeType !== 1) continue;
    const tag = tagOf(child);
    if (SKIPPED_TAGS.has(tag)) continue;
    if (FURNITURE_TAGS.has(tag) && clean(child.text).length < FURNITURE_MAX) continue;
    if (INLINE_TAGS.has(tag)) {
      inline.push(child.text);
      continue;
    }
    flush();
    if (/^h[1-6]$/.test(tag) || tag === 'summary' || tag === 'dt' || tag === 'caption') {
      const text = clean(child.text);
      // Some pages set whole paragraphs as headings: past this length it is text, not a title.
      if (text) out.push({ type: text.length > HEADING_MAX ? 'p' : 'h', text });
    } else if (tag === 'p') {
      const text = clean(child.text);
      if (text) out.push({ type: isBoldHeading(child, text) ? 'h' : 'p', text });
    } else if (tag === 'ul' || tag === 'ol') {
      let n = 0;
      for (const li of child.childNodes) {
        if (li.nodeType !== 1 || tagOf(li) !== 'li') continue;
        n += 1;
        listItem(li, tag === 'ol' ? `${n}. ` : '• ', out);
      }
    } else if (tag === 'tr') {
      const cells = child.querySelectorAll('th, td').map((c) => clean(c.text)).filter(Boolean);
      if (cells.length) out.push({ type: 'p', text: cells.join(' | ') });
    } else {
      walk(child, out, inline);
      flush();
    }
  }
  flush();
}

function listItem(li, marker, out) {
  const own = [];
  const nested = [];
  for (const child of li.childNodes) {
    if (child.nodeType === 1 && (tagOf(child) === 'ul' || tagOf(child) === 'ol')) nested.push(child);
    else if (child.nodeType === 3 || (child.nodeType === 1 && !SKIPPED_TAGS.has(tagOf(child)))) own.push(child.text);
  }
  const text = clean(own.join(''));
  if (text) out.push({ type: 'li', text: marker + text });
  for (const list of nested) {
    let n = 0;
    for (const sub of list.childNodes) {
      if (sub.nodeType !== 1 || tagOf(sub) !== 'li') continue;
      n += 1;
      listItem(sub, tagOf(list) === 'ol' ? `${n}. ` : '– ', out);
    }
  }
}

/** A lone "1" or "01" is the number of a step whose text sits in another element. */
const hasText = (block) => !/^\d{1,2}\.?$/.test(block.text);

function hasAncestorWithClass(node, className) {
  for (let p = node.parentNode; p; p = p.parentNode) {
    if (p.classList && p.classList.contains(className)) return true;
  }
  return false;
}

/**
 * Text of a page as blocks, with its title.
 * gov.pl articles keep their body in `.editor-content` (everything else is media, attachments and
 * navigation); other sites get the largest of the usual content containers.
 * Returns { title, blocks, pages? } – `pages` for Poradnik bezpieczeństwa chapters, whose gallery
 * names the PDF pages they were typeset from.
 */
function htmlToBlocks(html) {
  const root = parse(html.replace(/<br\s*\/?>/gi, '\n'));
  const blocks = [];
  const article = root.querySelector('#main-content');
  const bodies = article ? article.querySelectorAll('.editor-content').filter((e) => !hasAncestorWithClass(e, 'editor-content')) : [];

  if (bodies.length) {
    for (const body of bodies) walk(body, blocks, []);
    const pages = [];
    for (const link of article.querySelectorAll('.gallery a')) {
      const page = /_str_(\d+)/.exec(link.getAttribute('data-modaal-desc') || '');
      if (page) pages.push(Number(page[1]));
      const img = link.querySelector('img');
      const alt = clean((img && img.getAttribute('alt')) || '');
      // A long alt text is the accessible description of an infographic or a table.
      if (alt.length >= 80 && !/_str_\d+/.test(alt)) {
        blocks.push({ type: 'h', text: page ? `Opis ilustracji ze strony ${page[1]}` : 'Opis ilustracji' });
        blocks.push({ type: 'p', text: alt });
      }
    }
    const heading = article.querySelector('h2') || article.querySelector('h1');
    return { title: heading ? clean(heading.text) : '', blocks: blocks.filter(hasText), pages: pages.length ? pages : undefined };
  }

  const titleNode = root.querySelector('h1') || root.querySelector('title');
  const title = titleNode ? clean(titleNode.text) : '';
  let container = root;
  for (const selector of ['article', 'main', '[role=main]', '#content', '.content', 'body']) {
    const found = root.querySelector(selector);
    if (found && clean(found.text).length > 400) {
      container = found;
      break;
    }
  }
  const size = clean(container.text).length;
  for (const el of container.querySelectorAll('[class], [id]')) {
    const name = `${el.getAttribute('class') || ''} ${el.getAttribute('id') || ''}`;
    // Never a wrapper that holds most of the text, whatever it is called.
    if (FURNITURE_NAME.test(name) && clean(el.text).length < size * 0.5) el.remove();
  }
  for (const list of container.querySelectorAll('ul, ol')) {
    const items = list.querySelectorAll('li');
    const links = items.filter((li) => li.querySelector('a') && clean(li.text) === clean(li.querySelectorAll('a').map((a) => a.text).join(' ')));
    if (items.length >= 3 && links.length === items.length) list.remove(); // a list of nothing but links is navigation
  }
  walk(container, blocks, []);
  return { title, generic: true, blocks: blocks.filter((b) => hasText(b) && !FURNITURE_TEXT.test(b.text.replace(/^• /, ''))) };
}

// ---------------------------------------------------------------------------------------------
// PDF → blocks

const PDF_NOISE = [
  /^©\s*Kancelaria Sejmu/i,
  /^s\.\s*\d+\/\d+$/,
  /^\d{4}-\d{2}-\d{2}$/,
  /^Dziennik Ustaw(\s+[–-]\s*\d+\s*[–-]\s*Poz\.\s*\d+)?$/i,
  /^[–-]\s*\d+\s*[–-]$/,
  /^Poz\.\s*\d+$/i,
];
const BULLET = /^[•▪■●◦‣►▶✓✔\-–—*»]\s+/;

const ARTICLE = /^(Art\.\s*\d+[a-z]*|§\s*\d+[a-z]*)\./;
/** Headings typeset with letter-spacing come out as "T E L E F ON Y": unreadable, so dropped. */
const isSpacedOut = (line) => {
  const words = line.split(' ');
  return words.length >= 4 && words.filter((w) => /^\p{Lu}{1,3}$/u.test(w)).length / words.length >= 0.7;
};

/** One PDF page (as `pdftotext` prints it) → blocks tagged with the page number. */
function pdfPageToBlocks(text, page) {
  const blocks = [];
  let current = null;
  const push = () => {
    if (!current) return;
    const { bullet, lines } = current;
    current = null;
    const joined = clean(lines.join(' ').replace(/(\p{Ll})- (\p{Ll})/gu, '$1$2'));
    if (!joined) return;
    // Headings cannot be told from slogans and running headers in a PDF, so only the page is kept.
    blocks.push({ type: bullet ? 'li' : 'p', text: (bullet ? '• ' : '') + joined, page });
  };
  const lines = text.split('\n').map((l) => clean(l));
  const first = lines.findIndex(Boolean);
  const last = lines.findLastIndex(Boolean);
  lines.forEach((line, i) => {
    if (!line) return push();
    // A bare number at the edge of the page is its number; elsewhere it may be "112".
    if (PDF_NOISE.some((re) => re.test(line)) || isSpacedOut(line) || ((i === first || i === last) && /^\d{1,3}$/.test(line))) return;
    const article = ARTICLE.exec(line);
    if (article) {
      push();
      blocks.push({ type: 'h', text: article[1].replace(/\s+/g, ' '), page });
      current = { bullet: false, lines: [line] };
    } else if (BULLET.test(line)) {
      push();
      current = { bullet: true, lines: [line.replace(BULLET, '')] };
    } else if (current) current.lines.push(line);
    else current = { bullet: false, lines: [line] };
  });
  push();
  return blocks;
}

function pdfToBlocks(file, pages) {
  const text = execFileSync('pdftotext', ['-enc', 'UTF-8', file, '-'], { maxBuffer: 512 * 1024 * 1024 }).toString('utf8');
  const blocks = [];
  text.split('\f').forEach((pageText, i) => {
    if (pages && !pages.includes(i + 1)) return;
    blocks.push(...pdfPageToBlocks(pageText, i + 1));
  });
  return blocks;
}

// ---------------------------------------------------------------------------------------------
// Blocks → passages

function splitLong(text) {
  if (text.length <= PASSAGE_MAX) return [text];
  const parts = [];
  let current = '';
  for (const sentence of text.split(/(?<=[.!?;])\s+/)) {
    if (current && current.length + sentence.length + 1 > PASSAGE_MAX) {
      parts.push(current);
      current = '';
    }
    current = current ? `${current} ${sentence}` : sentence;
    while (current.length > PASSAGE_MAX) {
      parts.push(current.slice(0, PASSAGE_MAX));
      current = current.slice(PASSAGE_MAX);
    }
  }
  if (current) parts.push(current);
  return parts;
}

/**
 * Cuts blocks into passages: { s: section heading, p: page, t: text }. A heading or a new page
 * always starts a passage, and passages never overlap – the reader shows them back to back as
 * the whole document.
 */
function chunkBlocks(blocks) {
  const chunks = [];
  let section = '';
  let current = null;
  const flush = () => {
    if (current) chunks.push({ s: current.s, p: current.p, t: current.lines.join('\n') });
    current = null;
  };
  for (const block of blocks) {
    if (block.type === 'h') {
      flush();
      section = block.text;
      continue;
    }
    for (const piece of splitLong(block.text)) {
      if (current && (current.p !== block.page || (current.length + piece.length > PASSAGE_MAX && current.length >= PASSAGE_MIN))) flush();
      if (!current) current = { s: section, p: block.page, lines: [], length: 0 };
      current.lines.push(piece);
      current.length += piece.length + 1;
    }
  }
  flush();
  return chunks;
}

// ---------------------------------------------------------------------------------------------
// Commands

const readManifest = () => JSON.parse(fs.readFileSync(MANIFEST_FILE, 'utf8'));
const writeManifest = (manifest) => fs.writeFileSync(MANIFEST_FILE, JSON.stringify(manifest, null, 1) + '\n');
const rawFile = (source) => path.join(RAW_DIR, `${source.id}.${source.format}`);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchSource(source) {
  const res = await fetch(source.url, {
    headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'pl' },
    signal: AbortSignal.timeout(180_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = Buffer.from(await res.arrayBuffer());
  const isPdf = body.subarray(0, 5).toString('latin1') === '%PDF-';
  if (isPdf !== (source.format === 'pdf')) throw new Error(`oczekiwano ${source.format}, serwer zwrócił ${res.headers.get('content-type')}`);
  fs.writeFileSync(rawFile(source), body);
  source.fetched = {
    date: new Date().toISOString().slice(0, 10),
    bytes: body.length,
    sha256: crypto.createHash('sha256').update(body).digest('hex'),
    ...(res.url !== source.url ? { finalUrl: res.url } : {}),
  };
}

async function fetchAll(args) {
  const manifest = readManifest();
  fs.mkdirSync(RAW_DIR, { recursive: true });
  const queue = manifest.sources.filter((s) => s.include && (!args.only || s.id === args.only) && (args.force !== undefined || !s.fetched || !fs.existsSync(rawFile(s))));
  console.log(`Do pobrania: ${queue.length}`);
  let next = 0;
  let failed = 0;
  const worker = async () => {
    while (next < queue.length) {
      const source = queue[next++];
      try {
        await fetchSource(source);
        delete source.fetchError;
      } catch (e) {
        failed += 1;
        delete source.fetched;
        source.fetchError = e.message;
        console.error(`BŁĄD  ${source.id}: ${e.message}`);
      }
      await sleep(FETCH_PAUSE_MS);
    }
  };
  await Promise.all(Array.from({ length: FETCH_WORKERS }, worker));
  writeManifest(manifest);
  const bytes = manifest.sources.reduce((sum, s) => sum + (s.fetched ? s.fetched.bytes : 0), 0);
  console.log(`Pobrane: ${queue.length - failed}, błędy: ${failed}, razem w kb/raw: ${(bytes / 1e6).toFixed(1)} MB`);
}

function extract(source) {
  if (source.format === 'pdf') return { title: '', blocks: pdfToBlocks(rawFile(source), source.pages) };
  return htmlToBlocks(fs.readFileSync(rawFile(source), 'utf8'));
}

function build() {
  const manifest = readManifest();
  const docs = [];
  const chunks = [];
  const rejected = [];
  const seenHashes = new Map();
  const ordered = manifest.sources
    .filter((s) => s.include)
    .sort((a, b) => GROUPS.indexOf(a.group) - GROUPS.indexOf(b.group));

  for (const source of ordered) {
    if (!source.fetched || !fs.existsSync(rawFile(source))) {
      rejected.push([source.id, source.fetchError ? `nie pobrano: ${source.fetchError}` : 'nie pobrano']);
      continue;
    }
    const twin = seenHashes.get(source.fetched.sha256);
    if (twin) {
      rejected.push([source.id, `ten sam plik co ${twin}`]);
      continue;
    }
    let extracted;
    try {
      extracted = extract(source);
    } catch (e) {
      rejected.push([source.id, `błąd ekstrakcji: ${e.message.split('\n')[0]}`]);
      continue;
    }
    if (!source.title && extracted.title) source.title = extracted.title;
    const passages = chunkBlocks(extracted.blocks);
    const problem = checkText(passages.map((c) => c.t).join('\n'));
    if (problem) {
      rejected.push([source.id, problem]);
      continue;
    }
    seenHashes.set(source.fetched.sha256, source.id);
    const pages = extracted.pages;
    docs.push({
      id: source.id,
      title: source.format === 'html' && extracted.title && !(extracted.generic && source.title) ? extracted.title : source.title,
      publisher: source.publisher,
      group: source.group,
      url: source.url,
      format: source.format,
      priority: source.priority,
      ...(source.year ? { year: source.year } : {}),
      ...(pages ? { pages: Math.min(...pages) === Math.max(...pages) ? `${pages[0]}` : `${Math.min(...pages)}–${Math.max(...pages)}` } : {}),
      license: source.license,
      fetched: source.fetched.date,
      first: chunks.length,
      count: passages.length,
    });
    for (const c of passages) chunks.push({ d: docs.length - 1, ...(c.s ? { s: c.s } : {}), ...(c.p ? { p: c.p } : {}), t: c.t });
  }

  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  const groups = GROUPS.filter((g) => docs.some((d) => d.group === g));
  fs.writeFileSync(OUT_FILE, JSON.stringify({ built: new Date().toISOString().slice(0, 10), groups, docs, chunks }));
  writeManifest(manifest);

  const chars = chunks.reduce((sum, c) => sum + c.t.length, 0);
  console.log(`Dokumenty: ${docs.length}, fragmenty: ${chunks.length}, znaki: ${chars}, plik: ${(fs.statSync(OUT_FILE).size / 1e6).toFixed(2)} MB`);
  if (rejected.length) {
    console.log(`\nPominięte (${rejected.length}):`);
    for (const [id, why] of rejected) console.log(`  ${id}: ${why}`);
  }
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) args[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : '';
  }
  return args;
}

module.exports = { clean, checkText, htmlToBlocks, pdfPageToBlocks, chunkBlocks };

if (require.main === module) {
  const [command, ...rest] = process.argv.slice(2);
  const run = command === 'fetch' ? fetchAll(parseArgs(rest)) : command === 'build' ? Promise.resolve().then(build) : null;
  if (!run) {
    console.error('Usage: node scripts/kb-build.js <fetch [--only <id>] [--force] | build>');
    process.exit(2);
  }
  run.catch((e) => {
    console.error(`Error: ${e.message}`);
    process.exit(1);
  });
}
