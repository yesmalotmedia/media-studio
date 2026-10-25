// The Zohar passage (Aramaic + Hebrew translation) a lesson covers, taken from
// Torat Emet's "הזוהר המתורגם" pages — the same source the site's texts were
// always copied from by hand. Decided 2026-10-11; texts go to Wix aramit/hebrew.
//
// Page structure (CONFIRMED 2026-10-11 on פרשת יתרו): one page per parsha,
// windows-1255; each amud starts with <a name="דףBפ''זBע''ב">; inside it each
// Aramaic paragraph is plain text and is followed by its Hebrew translation in
// a framed <div style='... border ...'>. A lesson = the consecutive paragraphs
// from the one containing its start words to the one containing its end words;
// a lesson that starts/ends mid-paragraph gets the whole paragraph (agreed:
// better a bit more than missing text).
//
// Checked against 39 Yitro lessons typed into Wix by hand: 29 identical or
// within a few characters; 9 longer (lesson boundary mid-paragraph); 1 start
// phrase not found.
import fs from 'node:fs';
import path from 'node:path';

const BASE = 'https://www.toratemetfreeware.com/online';
const BOOKS = ['f_01776', 'f_01777', 'f_01778', 'f_01779', 'f_01780']; // בראשית שמות ויקרא במדבר דברים
const CACHE = path.join(process.cwd(), 'data', 'cache', 'zohar-text');

// search key: no nikud/cantillation, maqaf = space, letters + spaces only
// "ר'" is how the source mostly writes רבי — CONFIRMED 2026-10-11 ("רבי חזקיה" in
// column D vs "ר' חזקיה" on the page)
export const bare = (s) => String(s || '').replace(/(^|[\s(])ר['׳](?=\s)/g, '$1רבי').normalize('NFKD').replace(/־/g, ' ').replace(/[֑-ׇ]/g, '')
  .replace(/\([^)]*\)/g, ' ').replace(/[^א-ת ]/g, ' ').replace(/\s+/g, ' ').trim();
const amudKey = (daf, amud) => bare(`${daf} ע${amud}`).replace(/ /g, '');
// "יזעא" -> 17*2+0: the order of an amud key, for amudim missing on the page
const GEM = { א: 1, ב: 2, ג: 3, ד: 4, ה: 5, ו: 6, ז: 7, ח: 8, ט: 9, י: 10, כ: 20, ך: 20, ל: 30, מ: 40, ם: 40, נ: 50, ן: 50, ס: 60, ע: 70, פ: 80, ף: 80, צ: 90, ץ: 90, ק: 100, ר: 200, ש: 300, ת: 400 };
const amudOrder = (key) => { const m = key.match(/^(.+)ע([אב])$/); return m ? [...m[1]].reduce((s, ch) => s + (GEM[ch] || 0), 0) * 2 + (m[2] === 'ב' ? 1 : 0) : -1; };
const text = (s) => s.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, ' ').trim();

async function fetchPage(file) {
  fs.mkdirSync(CACHE, { recursive: true });
  const local = path.join(CACHE, file);
  if (fs.existsSync(local) && Date.now() - fs.statSync(local).mtimeMs < 7 * 864e5) return fs.readFileSync(local, 'utf8');
  const res = await fetch(`${BASE}/${file}`, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) throw new Error(`Torat Emet ${file}: HTTP ${res.status}`);
  const html = new TextDecoder('windows-1255').decode(await res.arrayBuffer());
  fs.writeFileSync(local, html, 'utf8');
  return html;
}

// parsha name -> its page file, from the five book index pages
async function parshaPage(parsha) {
  const want = bare(parsha);
  for (const book of BOOKS) {
    const idx = await fetchPage(`${book}.html`);
    for (const m of idx.matchAll(/AddIndex\("([^"]+)",\s*"([^"]+_part_\d+\.html)"/g)) {
      const name = bare(m[1]).replace(/^פרשת /, '');
      // spelled with or without vav/yod (the site writes "תצווה", Torat Emet "תצוה")
      const dv = (s) => s.replace(/(?<=[א-ת])[וי]/g, '');
      if (name === want || name.endsWith(` ${want}`) || dv(name) === dv(want) || dv(name).endsWith(` ${dv(want)}`)) return m[2];
    }
  }
  throw new Error(`parsha "${parsha}" not found on Torat Emet`);
}

// every parsha page of the five books (a parsha may span several _part_ files)
export async function allParshaFiles() {
  const out = [];
  for (const book of BOOKS) for (const m of (await fetchPage(`${book}.html`)).matchAll(/AddIndex\("([^"]+)",\s*"([^"]+_part_\d+\.html)"/g)) if (!out.some((o) => o.file === m[2])) out.push({ name: m[1], file: m[2] });
  return out;
}

export async function amudimOf(parsha, { file } = {}) {
  const html = await fetchPage(file || await parshaPage(parsha));
  const parts = html.split(/<a name="דףB([^"]+?)">/);
  const amudim = [];
  for (let i = 1; i < parts.length; i += 2) {
    const pairs = [];
    const re = /<p><\/p>(?!<div)([\s\S]*?)<BR><p><\/p><div style='[^']*border[^']*'\s*>([\s\S]*?)<\/div>/g;
    let m;
    // drop the amud heading (<B><U>דף י''ב ע''ב</U></B>) first — left in, it was
    // glued to the first word ("ע''בכְּתִיב"), so that word never matched and
    // the heading would have reached the site as part of the text (2026-10-11)
    const body = parts[i + 1].replace(/<B><U>[\s\S]*?<\/U><\/B>/, '');
    while ((m = re.exec(body))) pairs.push({ aramit: text(m[1]), hebrew: text(m[2]) });
    amudim.push({ key: bare(parts[i].replace(/B/g, ' ')).replace(/ /g, ''), pairs });
  }
  return amudim;
}

// Column D as people write it — loosely: 'פח ע"א: "זכור את יום השבת" - עד: "..."',
// or the full Aramaic text pasted in. Returns { start, end } search phrases.
export function parseReference(notes) {
  // a quote mark between two letters is an abbreviation (ע"א, יו"כ), not a quote
  const s = String(notes || '').replace(/([א-ת])["״]([א-ת])/g, '$1$2');
  const quoted = [...s.matchAll(/["“”״]([^"“”״]{3,})["“”״]/g)].map((m) => m[1]);
  const untilIdx = s.search(/עד\s*:?/);
  // where the lesson starts, if column D says so: "סוף יא ע\"ב: ..." / "יג ע\"ב: ..."
  // (s already has abbreviation quotes removed, so ע"ב reads עב and the first
  // remaining quote really opens the start words)
  const qi = s.search(/["“”]/);
  const head = qi > 0 ? s.slice(0, qi) : s.slice(0, 40);
  const am = head.match(/([א-ת]{1,3})['׳]{0,2}\s*ע['׳]{0,2}([אב])(?![א-ת])/);
  const startAmud = am ? { daf: am[1], amud: am[2] } : null;
  if (quoted.length >= 2) return { start: quoted[0], end: quoted[quoted.length - 1], startAmud };
  if (untilIdx > 0) { // unquoted "X - עד Y"
    const before = s.slice(0, untilIdx).replace(/^[^:]*:/, '').replace(/[-–]\s*$/, '');
    return { start: before, end: s.slice(untilIdx).replace(/^עד\s*:?/, '') };
  }
  const words = bare(s).split(' ').filter(Boolean);
  if (words.length >= 12) return { start: words.slice(0, 6).join(' '), end: words.slice(-6).join(' ') }; // full text pasted
  return null;
}

// How well a paragraph holds the phrase, anchored where it matters: start
// words are matched from their BEGINNING, end words up to their END (CONFIRMED
// 2026-10-11: "לא תשא את שם…" also appears inside an earlier paragraph, and an
// unanchored match picked that one). Up to 2 leading/trailing words may be
// skipped (a word written differently), at a small penalty.
// For COMPARING only (what goes to the site is untouched): column D and the
// source write the same words differently — CONFIRMED 2026-10-19 on ויקרא
// טו–יז, where 5 lessons got no text / no Hebrew although the passage is there:
//   - God's name: "ה" in column D, "יְיָ" in the source ("לפני ה תטהרו");
//   - plene vs. defective spelling: "ואילו בנח" vs. the source's "ואלו בנח" —
//     so vav/yod are ignored inside words;
//   - pasted text carries amud headings ("דף ט''ז ע''א") and "וכו'"/"וגו'"
//     that the source doesn't have.
const loose = (s) => ` ${bare(s)} `
  .replace(/ דף(?: [א-ת]){1,4} ע [אב](?= )/g, ' ').replace(/ דף [א-ת]{1,4} ע[אב](?= )/g, ' ')
  .replace(/ (?:יי|יהוה|ה) /g, ' ה ').replace(/ (?:וכו|וגו) /g, ' ')
  .split(' ').filter(Boolean).map((w) => (w.length > 1 ? w[0] + w.slice(1).replace(/[וי]/g, '') : w)).join(' ');

function matchScore(paragraph, phrase, anchor) {
  const P = ` ${loose(paragraph)} `, w = loose(phrase).split(' ').filter(Boolean);
  let best = 0;
  // (Math.max: a 2-word phrase like "רבי חזקיה" must still be tried once —
  // CONFIRMED 2026-10-11 it was skipped entirely)
  for (let skip = 0; skip <= Math.max(0, Math.min(2, w.length - 3)); skip++) {
    const ws = anchor === 'start' ? w.slice(skip) : w.slice(0, w.length - skip);
    for (let len = ws.length; len >= Math.min(3, ws.length); len--) {
      const piece = anchor === 'start' ? ws.slice(0, len) : ws.slice(ws.length - len);
      if (P.includes(` ${piece.join(' ')} `)) { best = Math.max(best, len - skip * 0.5); break; }
    }
  }
  return best;
}

// Column D holding the passage itself (not a "from … until …" reference):
// someone copied it exactly by hand, so it goes to the site AS IS — decided
// 2026-10-11. It may be the Aramaic only, or Aramaic then Hebrew; each line is
// classified by comparing it with the source's Aramaic vs. its translation
// (the two are in the same letters, so only the source can tell them apart).
const isFullText = (notes) => {
  const s = String(notes || '');
  return bare(s).split(' ').length >= 25 && !/עד\s*:/.test(s) && !/["“”].{3,60}["“”]\s*[-–]/.test(s);
};
export const trigrams = (s) => { const w = bare(s).split(' '); const out = new Set(); for (let i = 0; i + 2 < w.length; i++) out.add(w.slice(i, i + 3).join(' ')); return out; };
export const overlap = (a, b) => { let n = 0; for (const t of a) if (b.has(t)) n++; return a.size ? n / a.size : 0; };

function splitFullText(notes, source) {
  const ar = trigrams(source.aramit), he = trigrams(source.hebrew);
  const lines = String(notes).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const aramit = [], hebrew = [];
  for (const l of lines) {
    const g = trigrams(l);
    (overlap(g, he) > overlap(g, ar) ? hebrew : aramit).push(l);
  }
  return { aramit: aramit.join('\n'), hebrew: hebrew.join('\n') };
}

// { aramit, hebrew, paragraphs, from } or { error } — never throws for "not found".
// from: 'source' (extracted) | 'sheet' (column D used as is, gaps filled from the source)
export async function lessonText(args) {
  if (!isFullText(args.notes)) return { ...(await extractFromSource(args)), from: 'source' };
  // full text: start = its first words; end = the last words of the last line
  // that is still Aramaic — tried line by line from the bottom, since a
  // Hebrew translation may follow the Aramaic
  const lines = String(args.notes).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const startWords = bare(lines[0]).split(' ').slice(0, 6).join(' ');
  let extracted = { error: 'no line matched' };
  for (let k = lines.length - 1; k >= 0; k--) {
    const endWords = bare(lines[k]).split(' ').slice(-6).join(' ');
    const r = await extractFromSource({ ...args, notes: `"${startWords}" - עד: "${endWords}"` });
    if (!r.error) { extracted = r; break; }
  }
  if (extracted.error) return { aramit: String(args.notes).trim(), hebrew: '', paragraphs: null, from: 'sheet', note: `Hebrew not found: ${extracted.error}` };
  const own = splitFullText(args.notes, extracted);
  return {
    aramit: own.aramit || extracted.aramit,
    hebrew: own.hebrew || extracted.hebrew, // Aramaic-only in column D -> translation from the source
    paragraphs: extracted.paragraphs,
    from: 'sheet',
  };
}

async function extractFromSource({ parsha, daf, amud, notes }) {
  const ref = parseReference(notes);
  if (!ref) return { error: 'no start/end words in column D' };
  const amudim = await amudimOf(parsha);
  // Where to start looking: the amud column D names first, then the title's.
  // Both are human-typed and either can be off — CONFIRMED 2026-10-11: one row
  // said "סוף יא ע\"ב" for words that open יב ע"ב (= its title), another the
  // other way round — so each is tried, first hit wins.
  // An amud whose heading is missing on the page (CONFIRMED 2026-10-19: ויקרא jumps
  // from ט"ז ע"ב straight to י"ז ע"ב — יז ע"א's text sits under ט"ז ע"ב) falls back
  // to the nearest amud before it; the search window then reaches the text anyway.
  const indexOf = (d, a) => {
    const exact = amudim.findIndex((x) => x.key === amudKey(d, a));
    if (exact >= 0) return exact;
    const want = amudOrder(amudKey(d, a));
    let best = -1;
    amudim.forEach((x, i) => { if (amudOrder(x.key) < want) best = i; });
    return best;
  };
  const tries = [ref.startAmud && indexOf(ref.startAmud.daf, ref.startAmud.amud), indexOf(daf, amud)]
    .filter((k, i, all) => k != null && k >= 0 && all.indexOf(k) === i);
  if (!tries.length) return { error: `${daf} ע${amud} not on the ${parsha} page` };
  let lastErr;
  for (const k0 of tries) {
    const r = searchFrom(amudim, k0, ref);
    if (!r.error) return r;
    lastErr = r;
  }
  return lastErr;
}

function searchFrom(amudim, k0, ref) {
  // the lesson starts on its own amud and may run into the next ones
  // window: the previous amud (a short lesson titled "דף יג עמוד א" may start
  // "סוף יב ע\"ב") + the lesson's amud + the next two (it may run on)
  const from = Math.max(0, k0 - 1);
  const pool = amudim.slice(from, k0 + 3).flatMap((a) => a.pairs);
  const prevLen = k0 > from ? amudim[from].pairs.length : 0;
  const startLen = prevLen + amudim[k0].pairs.length;
  // ties go to the earliest paragraph (a later repeat of the same words must
  // not stretch the lesson)
  const best = (phrase, from, to, anchor) => {
    let bi = -1, bs = 0;
    for (let i = from; i < to; i++) {
      const sc = matchScore(pool[i].aramit, phrase, anchor);
      if (sc > bs) { bs = sc; bi = i; }
    }
    return bs >= Math.min(3, loose(phrase).split(' ').length) ? bi : -1;
  };
  // the lesson's own amud first; the previous one only if the start isn't there
  let si = best(ref.start, prevLen, startLen, 'start');
  if (si < 0 && prevLen) si = best(ref.start, 0, prevLen, 'start');
  if (si < 0) return { error: `start words not found: "${ref.start.slice(0, 40)}"` };
  const ei = best(ref.end, si, pool.length, 'end');
  if (ei < 0) return { error: `end words not found: "${ref.end.slice(0, 40)}"` };
  const sel = pool.slice(si, ei + 1);
  return { aramit: sel.map((p) => p.aramit).join('\n'), hebrew: sel.map((p) => p.hebrew).join('\n'), paragraphs: sel.length };
}
