// Read-only audit (user, 2026-10-25): on the Zohar site, does each lesson's Hebrew match its
// Aramaic? For every row of a collection: find each Aramaic paragraph in the source (Torat
// Emet, lib/zoharText.js), take the source's translation of exactly those paragraphs, and
// compare it with the Hebrew on the site (trigram overlap, both directions).
//
//   node scripts/audit_zohar_texts.mjs [pshat|iyun]      -> data/audits/zohar-texts-<kind>.json
import fs from 'node:fs';
import { amudimOf, allParshaFiles, trigrams, overlap } from '../lib/zoharText.js';
const kind = process.argv[2] || 'pshat';
const c = JSON.parse(fs.readFileSync('credentials/wix.json', 'utf8'));
const H = { Authorization: c.apiKey, 'wix-site-id': c.siteId, 'Content-Type': 'application/json' };
const strip = (x) => (typeof x === 'string' ? x : JSON.stringify(x || '')).replace(/<[^>]+>/g, '\n').replace(/&nbsp;/g, ' ').replace(/\\n/g, '\n');
// all rows
const rows = [];
for (let offset = 0; ; offset += 100) {
  const r = await fetch('https://www.wixapis.com/wix-data/v2/items/query', { method: 'POST', headers: H, body: JSON.stringify({ dataCollectionId: c.collections[kind], query: { sort: [{ fieldName: 'pageid', order: 'ASC' }], paging: { limit: 100, offset } } }) });
  const items = (await r.json()).dataItems || [];
  rows.push(...items);
  if (items.length < 100) break;
}
console.log(kind, 'rows:', rows.length);
const sources = {};
// the whole Zohar, for pages not found in their own parsha's file
const all = [];
for (const f of await allParshaFiles()) for (const a of await amudimOf(null, { file: f.file })) for (const p of a.pairs) all.push({ ...p, amud: `${f.name} ${a.key}`, ta: trigrams(p.aramit), th: trigrams(p.hebrew) });
console.log('source paragraphs (whole Zohar):', all.length);
const paras = (s) => strip(s).split(/\n+/).map((p) => p.trim()).filter((p) => p.split(/\s+/).length >= 4);
const out = [];
for (const it of rows) {
  const d = it.data, rec = { pageid: d.pageid, daf: d.daf, page: d.page, parasha: d.parasha, id: it.id };
  const ar = paras(d.aramit), he = paras(d.hebrew);
  if (!ar.length) { out.push({ ...rec, status: 'no-text' }); continue; }
  if (!he.length) { out.push({ ...rec, status: 'hebrew-missing' }); continue; }
  try {
    sources[d.parasha] ||= (await amudimOf(d.parasha)).flatMap((a) => a.pairs.map((p) => ({ ...p, amud: a.key, ta: trigrams(p.aramit), th: trigrams(p.hebrew) })));
  } catch (e) { out.push({ ...rec, status: 'source-error', error: e.message }); continue; }
  let src = sources[d.parasha];
  // each site Aramaic paragraph -> its source paragraph
  // source paragraphs contained in the site's Aramaic (the site may keep a whole page as one
  // block, so match source paragraphs into the site text, then measure how much they cover)
  const siteAr = trigrams(ar.join(' '));
  const find = (src) => {
    const idx = [];
    src.forEach((s, i) => { if (s.ta.size && overlap(s.ta, siteAr) >= 0.5) idx.push(i); });
    const u = new Set(); for (const i of idx) for (const t of src[i].ta) u.add(t);
    return { idx, aramitFound: overlap(siteAr, u) };
  };
  let { idx, aramitFound } = find(src);
  if (!idx.length || aramitFound < 0.3) { src = all; ({ idx, aramitFound } = find(src)); if (idx.length) rec.foundIn = [...new Set(idx.map((i) => src[i].amud))].join(', '); }
  if (!idx.length || aramitFound < 0.3) {
    // the "Aramaic" field holding the Hebrew translation?
    const t = trigrams(ar.join(' ')); let bs = 0; for (const s of all) bs = Math.max(bs, overlap(t, s.th));
    const heAsAr = all.filter((s) => overlap(t, s.th) >= 0.3).length > 0;
    out.push({ ...rec, status: heAsAr ? 'aramit-field-is-hebrew' : 'aramit-not-in-source', aramitFound: +aramitFound.toFixed(2) }); continue;
  }
  const expected = trigrams(idx.sort((a, b) => a - b).map((i) => src[i].hebrew).join(' '));
  const siteHe = trigrams(he.join(' '));
  const covered = overlap(expected, siteHe), extra = 1 - overlap(siteHe, expected); // translation present / foreign text on the site
  // where does the site's Hebrew actually come from?
  const heIdx = he.map((p) => { const t = trigrams(p); let bi = -1, bs = 0; src.forEach((s, i) => { const sc = overlap(t, s.th); if (sc > bs) { bs = sc; bi = i; } }); return bs >= 0.3 ? bi : -1; });
  const heAmudim = [...new Set(heIdx.filter((i) => i >= 0).map((i) => src[i].amud))], arAmudim = [...new Set(idx.map((i) => src[i].amud))];
  const status = covered >= 0.8 && extra <= 0.25 ? 'ok' : covered < 0.4 && extra > 0.6 ? 'hebrew-other-passage' : covered < 0.8 ? 'hebrew-partial' : 'hebrew-extra';
  out.push({ ...rec, status, covered: +covered.toFixed(2), extra: +extra.toFixed(2), aramitParas: ar.length, hebrewParas: he.length, aramitAmudim: arAmudim, hebrewAmudim: heAmudim });
}
fs.mkdirSync('data/audits', { recursive: true });
fs.writeFileSync(`data/audits/zohar-texts-${kind}.json`, JSON.stringify(out, null, 1), 'utf8');
const by = {}; for (const o of out) by[o.status] = (by[o.status] || 0) + 1;
console.log(by);
