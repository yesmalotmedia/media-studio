// Read-only (user, 2026-10-26): is every public video of a channel in the playlist of its series?
// Series = a column-B name of the titles sheet found in the video's title ("<lesson> | <series>").
// The series playlist = a playlist named exactly as column B. Reports: missing from its playlist,
// sitting in another series' playlist, series without a playlist, videos whose series can't be told.
//   node scripts/audit_playlists.mjs [maalot|zohar]   -> data/audits/playlists-<channel>.json
import fs from 'node:fs';
import { google } from 'googleapis';
import { getClientFor } from '../lib/youtube.js';
import { fetchSheetValues } from '../lib/sheetsSync.js';
const channel = process.argv[2] || 'maalot';
const nn = (s) => String(s || '').replace(/[֑-ׇ]/g, '').replace(/[״]/g, '"').replace(/[׳]/g, "'").replace(/\s+/g, ' ').trim();
const rows = await fetchSheetValues({ spreadsheetId: '16GRfS33Wb4bYycoSmHuJyns-GUVX-4FNLUh5tA0BDUg', gid: 331063332 });
const SERIES = [...new Set(rows.slice(1).map((r) => nn(r[1])).filter((b) => b && b.includes('|')))].filter((b) => channel === 'zohar' ? /זוהר/.test(b) : !/זוהר/.test(b)).sort((a, b) => b.length - a.length);
const yt = google.youtube({ version: 'v3', auth: getClientFor(channel) });
const pls = []; let pt; do { const r = await yt.playlists.list({ part: ['snippet', 'contentDetails'], mine: true, maxResults: 50, pageToken: pt }); pls.push(...r.data.items); pt = r.data.nextPageToken; } while (pt);
const items = async (id) => { const out = []; let t; do { const r = await yt.playlistItems.list({ part: ['snippet', 'contentDetails', 'status'], playlistId: id, maxResults: 50, pageToken: t }); out.push(...r.data.items); t = r.data.nextPageToken; } while (t); return out; };
const up = (await yt.channels.list({ part: ['contentDetails'], mine: true })).data.items[0].contentDetails.relatedPlaylists.uploads;
const videos = (await items(up)).filter((i) => i.status.privacyStatus === 'public').map((i) => ({ id: i.contentDetails.videoId, title: i.snippet.title, at: (i.contentDetails.videoPublishedAt || '').slice(0, 10) }));
// spacing, dashes, quotes and brackets ignored ("שיעורים קצרים לדרך- החיזוק" = "… לדרך - החיזוק")
const tight = (s) => nn(s).replace(/[\s\-–"'()]/g, '');
const seriesOf = (title) => { const t = tight(title); return SERIES.find((s) => t.endsWith(tight(s)) || t.includes('|' + tight(s))) || null; };
const plByName = new Map(pls.map((p) => [nn(p.snippet.title), p]));
const member = new Map(); // videoId -> [playlist names]
for (const p of pls) for (const i of await items(p.id)) { const v = i.contentDetails.videoId; member.set(v, [...(member.get(v) || []), nn(p.snippet.title)]); }
const missing = [], wrong = [], noPlaylist = {}, unknown = [];
for (const v of videos) {
  const s = seriesOf(v.title), inLists = member.get(v.id) || [];
  if (!s) { unknown.push({ ...v, inLists }); continue; }
  if (!plByName.has(s)) { noPlaylist[s] = (noPlaylist[s] || 0) + 1; continue; }
  if (!inLists.includes(s)) missing.push({ ...v, series: s, inLists });
  const others = inLists.filter((l) => l !== s && SERIES.includes(l));
  if (others.length) wrong.push({ ...v, series: s, alsoIn: others });
}
console.log(`${channel}: ${videos.length} public videos, ${pls.length} playlists, ${SERIES.length} column-B series`);
console.log(`  missing from their series playlist: ${missing.length}`);
console.log(`  also in ANOTHER series' playlist:   ${wrong.length}`);
console.log(`  series with no playlist: ${Object.keys(noPlaylist).length} (${Object.values(noPlaylist).reduce((a, b) => a + b, 0)} videos)`);
for (const [s, n] of Object.entries(noPlaylist)) console.log(`     ${n}  ${s}`);
console.log(`  series not identifiable from the title: ${unknown.length}`);
const bySeries = {}; for (const m of missing) bySeries[m.series] = (bySeries[m.series] || 0) + 1;
console.log('  missing, by series:'); Object.entries(bySeries).sort((a, b) => b[1] - a[1]).forEach(([s, n]) => console.log(`     ${n}  ${s}`));
fs.mkdirSync('data/audits', { recursive: true });
fs.writeFileSync(`data/audits/playlists-${channel}.json`, JSON.stringify({ missing, wrong, noPlaylist, unknown }, null, 1), 'utf8');
