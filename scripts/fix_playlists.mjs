// Applies the playlist audit (scripts/audit_playlists.mjs, user-approved 2026-10-26):
//   - removes the videos sitting in ANOTHER series' playlist (audit "wrong")
//   - adds the videos missing from their series playlist (audit "missing"); נ"ך also into the
//     book's playlist (lib/youtube.js addToBookPlaylist)
// Quota: insert/delete = 50 units each, so at most --limit adds per run (default 70); run again
// the next day for the rest — videos already in place are skipped. Every change is appended to
// data/playlist-renames/fix-<date>.json (playlist, video, item id) so it can be undone.
// Series in SKIP_SERIES (waiting for a decision) are left alone.
//   node scripts/fix_playlists.mjs [--limit 70] [--apply]
import fs from 'node:fs';
import { google } from 'googleapis';
import { getClientFor, addToBookPlaylist } from '../lib/youtube.js';
const apply = process.argv.includes('--apply');
const limit = Number(process.argv[process.argv.indexOf('--limit') + 1]) || 70;
const SKIP_SERIES = [/^שיחות בנושאים שונים/, /נועם בנינו/];
const audit = JSON.parse(fs.readFileSync('data/audits/playlists-maalot.json', 'utf8'));
const yt = google.youtube({ version: 'v3', auth: getClientFor('maalot') });
const nn = (s) => String(s || '').replace(/[֑-ׇ]/g, '').replace(/[״]/g, '"').replace(/[׳]/g, "'").replace(/\s+/g, ' ').trim();
const pls = []; let pt; do { const r = await yt.playlists.list({ part: ['snippet'], mine: true, maxResults: 50, pageToken: pt }); pls.push(...r.data.items); pt = r.data.nextPageToken; } while (pt);
const plOf = (name) => pls.filter((p) => nn(p.snippet.title) === name);
const itemsCache = {};
const items = async (id) => { if (itemsCache[id]) return itemsCache[id]; const out = []; let t; do { const r = await yt.playlistItems.list({ part: ['contentDetails'], playlistId: id, maxResults: 50, pageToken: t }); out.push(...r.data.items); t = r.data.nextPageToken; } while (t); return (itemsCache[id] = out); };
const logFile = `data/playlist-renames/fix-${new Date().toISOString().slice(0, 10)}.json`;
const log = fs.existsSync(logFile) ? JSON.parse(fs.readFileSync(logFile, 'utf8')) : [];
const save = () => fs.writeFileSync(logFile, JSON.stringify(log, null, 1), 'utf8');

// 1. wrong placements
for (const w of audit.wrong) for (const other of w.alsoIn) {
  const p = plOf(other)[0]; if (!p) continue;
  const it = (await items(p.id)).find((i) => i.contentDetails.videoId === w.id);
  if (!it) continue; // already out
  console.log(`${apply ? '' : '[dry] '}remove from "${other}": ${w.title.slice(0, 60)}`);
  if (apply) { await yt.playlistItems.delete({ id: it.id }); log.push({ action: 'removed', playlistId: p.id, playlist: other, videoId: w.id, title: w.title }); save(); }
}
// 2. missing
let added = 0, skipped = 0;
for (const m of audit.missing) {
  if (SKIP_SERIES.some((re) => re.test(m.series))) { skipped++; continue; }
  const ps = plOf(m.series); if (ps.length !== 1) { console.log(`?? ${ps.length} playlists named "${m.series}"`); continue; }
  if ((await items(ps[0].id)).some((i) => i.contentDetails.videoId === m.id)) continue; // done in an earlier run
  if (added >= limit) break;
  console.log(`${apply ? '' : '[dry] '}add to "${m.series}": ${m.title.slice(0, 60)}`);
  if (!apply) { added++; continue; }
  try {
    const r = await yt.playlistItems.insert({ part: ['snippet'], requestBody: { snippet: { playlistId: ps[0].id, resourceId: { kind: 'youtube#video', videoId: m.id } } } });
    itemsCache[ps[0].id].push({ contentDetails: { videoId: m.id } });
    log.push({ action: 'added', playlistId: ps[0].id, playlist: m.series, videoId: m.id, itemId: r.data.id, title: m.title }); added++;
    if (/^נ"ך \| /.test(m.series)) { const b = await addToBookPlaylist('maalot', m.id, m.series, m.title.split(' | ')[0]); log.push({ action: 'book', videoId: m.id, ...b }); }
    save();
  } catch (e) { console.log(`   FAILED: ${e.message}`); if (/quota/i.test(e.message)) break; }
}
const left = audit.missing.filter((m) => !SKIP_SERIES.some((re) => re.test(m.series))).length;
console.log(`\n${apply ? 'added' : 'would add'} ${added} this run (limit ${limit}); ${skipped} waiting for a decision; log: ${logFile}`);
