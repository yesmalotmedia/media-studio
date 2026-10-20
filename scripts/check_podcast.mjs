// Read-only: one of our podcast feeds vs. the titles sheet vs. the YouTube playlist(s) of
// its series — lesson by lesson (user, 2026-10-20: "make sure it matches the sheet and YouTube").
//
//   node scripts/check_podcast.mjs <slug> [--all]     (--all: list every lesson, not only problems)
import { google } from 'googleapis';
import { fetchSheetValues } from '../lib/sheetsSync.js';
import { getClientFor } from '../lib/youtube.js';
import { loadEpisodes, loadShows } from '../lib/podcast.js';
const [slug] = process.argv.slice(2), all = process.argv.includes('--all');
const show = loadShows().shows[slug];
const series = show.match.series, playlists = [...series, ...(show.extraPlaylists || [])];
const norm = (s) => String(s || '').replace(/[֑-ׇ]/g, '').replace(/["״'׳?!.,:;()\-–]/g, ' ').replace(/\s+/g, ' ').trim();
const rows = (await fetchSheetValues({ spreadsheetId: '16GRfS33Wb4bYycoSmHuJyns-GUVX-4FNLUh5tA0BDUg', gid: 331063332 }))
  .map((r, i) => ({ row: i + 1, B: String(r[1] || '').trim(), C: String(r[2] || '').trim(), K: String(r[10] || '').trim() })).filter((r) => series.includes(r.B));
const yt = google.youtube({ version: 'v3', auth: getClientFor(show.match.channel || 'maalot') });
const pls = []; let pt; do { const r = await yt.playlists.list({ part: ['snippet'], mine: true, maxResults: 50, pageToken: pt }); pls.push(...r.data.items); pt = r.data.nextPageToken; } while (pt);
const vids = [];
for (const t of playlists) {
  const p = pls.find((x) => x.snippet.title.trim() === t); if (!p) { console.log('no YouTube playlist named:', t); continue; }
  pt = undefined; do { const r = await yt.playlistItems.list({ part: ['snippet', 'contentDetails', 'status'], playlistId: p.id, maxResults: 50, pageToken: pt }); for (const i of r.data.items) if (!vids.some((v) => v.id === i.contentDetails.videoId)) vids.push({ id: i.contentDetails.videoId, core: i.snippet.title.split(' | ')[0].trim(), at: (i.contentDetails.videoPublishedAt || '').slice(0, 10), privacy: i.status.privacyStatus }); pt = r.data.nextPageToken; } while (pt);
}
const eps = loadEpisodes(slug), used = new Set();
const same = (a, b) => { a = norm(a); b = norm(b); return a === b || (Math.min(a.length, b.length) > 6 && (a.includes(b) || b.includes(a))); };
let ok = 0, noFeed = [], private_ = 0;
for (const v of vids.sort((a, b) => a.at.localeCompare(b.at))) {
  if (v.privacy === 'private') { private_++; continue; }
  const ep = eps.find((e) => !used.has(e.guid) && same(e.title, v.core)); if (ep) used.add(ep.guid);
  const row = rows.find((r) => same(r.C, v.core) || same(r.K, v.core));
  if (ep) ok++; else noFeed.push(v);
  if (all || !ep) console.log(`${v.at} | sheet ${row ? 'row ' + row.row : '—'} | feed ${ep ? '✓' : '✗'} | ${v.core}`);
}
const feedOnly = eps.filter((e) => !used.has(e.guid));
const sheetOnly = rows.filter((r) => !vids.some((v) => same(r.C, v.core) || same(r.K, v.core)));
console.log(`\n${show.title}\nfeed ${eps.length} | YouTube ${vids.length} (${private_} private, skipped) | sheet rows ${rows.length}`);
console.log(`YouTube lessons in the feed: ${ok} | not in the feed: ${noFeed.length} (older than the feed = never uploaded to Spotify)`);
console.log(`feed episodes not on YouTube (by title): ${feedOnly.length}${feedOnly.length ? ' — e.g. ' + feedOnly.slice(0, 3).map((e) => e.title).join(' / ') : ''}`);
console.log(`sheet rows not on YouTube: ${sheetOnly.length}${sheetOnly.length ? ' — ' + sheetOnly.map((r) => 'row ' + r.row + ': ' + r.C).join(' / ') : ''}`);
