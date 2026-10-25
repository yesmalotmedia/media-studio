// Fixes the broken pshat pages the audit found (user, 2026-10-25): for each page, find its
// passage in the source (Torat Emet, the whole Zohar) through the field that is still good,
// and rewrite ONLY the broken field(s) from that passage. Every touched row is backed up first
// (data/wix-backups/pshat-text-fix-<date>.json). Dry run unless --apply.
//
//   node scripts/fix_zohar_texts.mjs <rows.json> [--apply]
//   rows.json: [[pageid, code], ...]  (codes as in the audit report)
import fs from 'node:fs';
import { amudimOf, allParshaFiles, trigrams, overlap } from '../lib/zoharText.js';

const apply = process.argv.includes('--apply');
const targets = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const c = JSON.parse(fs.readFileSync('credentials/wix.json', 'utf8'));
const H = { Authorization: c.apiKey, 'wix-site-id': c.siteId, 'Content-Type': 'application/json' };
const col = c.collections.pshat;
const strip = (x) => (typeof x === 'string' ? x : JSON.stringify(x || '')).replace(/<[^>]+>/g, '\n').replace(/&nbsp;/g, ' ').replace(/\\n/g, '\n');

// the whole Zohar, in page order
const all = [];
for (const f of await allParshaFiles()) for (const a of await amudimOf(null, { file: f.file })) for (const p of a.pairs) all.push({ ...p, file: f.file, amud: a.key, ta: trigrams(p.aramit), th: trigrams(p.hebrew) });

// the source paragraphs contained in a text (by their Aramaic or their Hebrew), as one
// contiguous run in one file
function passage(text, by) {
  const t = trigrams(text), hit = [];
  all.forEach((s, i) => { const st = by === 'aramit' ? s.ta : s.th; if (st.size >= 3 && overlap(st, t) >= 0.5) hit.push(i); });
  if (!hit.length) return null;
  const files = {}; for (const i of hit) files[all[i].file] = (files[all[i].file] || 0) + 1;
  const file = Object.entries(files).sort((a, b) => b[1] - a[1])[0][0];
  const idx = hit.filter((i) => all[i].file === file);
  const lo = Math.min(...idx), hi = Math.max(...idx);
  if (hi - lo + 1 > idx.length * 2 + 3) return null; // scattered hits — not one passage
  const sel = all.slice(lo, hi + 1);
  return { aramit: sel.map((p) => p.aramit).join('\n'), hebrew: sel.map((p) => p.hebrew).join('\n'), amudim: [...new Set(sel.map((p) => p.amud))] };
}

const rows = {};
for (const [pageid] of targets) {
  const r = await fetch('https://www.wixapis.com/wix-data/v2/items/query', { method: 'POST', headers: H, body: JSON.stringify({ dataCollectionId: col, query: { filter: { pageid } } }) });
  rows[pageid] = (await r.json()).dataItems[0];
}
const out = [];
for (const [pageid, code] of targets) {
  const it = rows[pageid], d = it.data, ar = strip(d.aramit), he = strip(d.hebrew);
  const res = { pageid, code, place: `${d.parasha} ${d.daf} ${d.page}` };
  // which field is still good, and what to rewrite
  const plan = {
    'ארמית חסרה': ['he-in-ar', ['aramit']],
    'שדות הפוכים': ['he-in-ar', ['aramit', 'hebrew']],
    'לבדיקה': ['he', ['aramit']],
  }[code] || ['ar', ['hebrew']];
  const [anchor, fields] = plan;
  const p = anchor === 'ar' ? passage(ar, 'aramit') : anchor === 'he' ? passage(he, 'hebrew') : passage(ar, 'hebrew');
  if (!p) { out.push({ ...res, result: 'not in the source' }); continue; }
  // the passage must be this page: it covers the good field and does not run far past it
  const good = trigrams(anchor === 'ar' ? ar : anchor === 'he' ? he : ar), pt = trigrams(anchor === 'ar' ? p.aramit : p.hebrew);
  const covers = overlap(good, pt), within = overlap(pt, good);
  res.amudim = p.amudim.join(','); res.covers = +covers.toFixed(2); res.within = +within.toFixed(2);
  // the user (2026-10-25): fix only what is certain, report every doubt
  if (covers < 0.98 || within < 0.98) { out.push({ ...res, result: 'doubt' }); continue; }
  const data = { ...d };
  for (const f of fields) data[f] = p[f];
  // per rewritten field: how much of the old text is still in the new one / how much is new
  res.change = fields.map((f) => { const o = trigrams(strip(d[f])), n = trigrams(p[f]); return `${f}: old-kept ${overlap(o, n).toFixed(2)} new-added ${(1 - overlap(n, o)).toFixed(2)}`; }).join('; ');
  if (d.parasha === 'פקןדי') data.parasha = 'פקודי';
  // nothing to change (the text already is the source's)
  if (fields.every((f) => { const o = trigrams(strip(d[f])), n = trigrams(p[f]); return overlap(o, n) > 0.98 && overlap(n, o) > 0.98; })) { out.push({ ...res, result: 'already correct' }); continue; }
  out.push({ ...res, result: 'fixed', fields: fields.join('+'), before: { aramit: d.aramit, hebrew: d.hebrew, parasha: d.parasha }, data });
}

for (const o of out) console.log(`${o.pageid} ${o.place.padEnd(16)} ${o.code.padEnd(18)} ${o.result}${o.fields ? ' (' + o.fields + ')' : ''}${o.covers != null ? ` covers ${o.covers} within ${o.within} ${o.amudim}` : ''}${o.change ? ' | ' + o.change : ''}`);
const fixes = out.filter((o) => o.result === 'fixed');
console.log(`\n${fixes.length} fixed, ${out.length - fixes.length} left${apply ? '' : ' (dry run — add --apply)'}`);
fs.mkdirSync('data/audits', { recursive: true });
fs.writeFileSync('data/audits/zohar-texts-pshat-fix.json', JSON.stringify(out.map(({ before, data, ...o }) => o), null, 1), 'utf8');
if (apply) {
  const date = new Date().toISOString().slice(0, 10);
  fs.mkdirSync('data/wix-backups', { recursive: true });
  fs.writeFileSync(`data/wix-backups/pshat-text-fix-${date}.json`, JSON.stringify(fixes.map((o) => rows[o.pageid]), null, 1), 'utf8');
  for (const o of fixes) {
    const r = await fetch(`https://www.wixapis.com/wix-data/v2/items/${rows[o.pageid].id}`, { method: 'PUT', headers: H, body: JSON.stringify({ dataCollectionId: col, dataItem: { id: rows[o.pageid].id, data: o.data } }) });
    if (!r.ok) console.log('WRITE FAILED', o.pageid, r.status, (await r.text()).slice(0, 200));
  }
  console.log('written.');
}
