// One-off (user, 2026-10-26, option א): ONE playlist "שיחות בנושאים שונים" for every rabbi's
// talks — the existing "… | הרב יהושע ויצן" playlist is renamed, and the public videos of
// every "שיחות בנושאים שונים | <rabbi>" series that aren't in it are added. Before/after and
// each added item go to data/playlist-renames/talks-2026-10-26.json. Dry run unless --apply.
import fs from 'node:fs';
import { google } from 'googleapis';
import { getClientFor } from '../lib/youtube.js';
const apply = process.argv.includes('--apply');
const ID = 'PLCYVl47m92O553kPyfFIop6wBrhT6QMHh', NAME = 'שיחות בנושאים שונים';
const yt = google.youtube({ version: 'v3', auth: getClientFor('maalot') });
const tight = (s) => String(s || '').replace(/[֑-ׇ]/g, '').replace(/[\s\-–"'()״׳]/g, '');
const pl = (await yt.playlists.list({ part: ['snippet'], id: [ID] })).data.items[0];
const items = async (id) => { const out = []; let t; do { const r = await yt.playlistItems.list({ part: ['snippet', 'contentDetails', 'status'], playlistId: id, maxResults: 50, pageToken: t }); out.push(...r.data.items); t = r.data.nextPageToken; } while (t); return out; };
const inIt = new Set((await items(ID)).map((i) => i.contentDetails.videoId));
const up = (await yt.channels.list({ part: ['contentDetails'], mine: true })).data.items[0].contentDetails.relatedPlaylists.uploads;
const talks = (await items(up)).filter((i) => i.status.privacyStatus === 'public' && tight(i.snippet.title).includes(tight(`| ${NAME} | הרב`)) && !inIt.has(i.contentDetails.videoId));
console.log(`playlist "${pl.snippet.title}" (${inIt.size} videos) -> "${NAME}"; to add: ${talks.length}`);
talks.forEach((i) => console.log('   +', i.snippet.title));
if (!apply) process.exit(0);
const log = { savedAt: new Date().toISOString(), playlistId: ID, titleBefore: pl.snippet.title, titleAfter: NAME, added: [] };
const f = 'data/playlist-renames/talks-2026-10-26.json';
fs.writeFileSync(f, JSON.stringify(log, null, 1), 'utf8');
await yt.playlists.update({ part: ['snippet'], requestBody: { id: ID, snippet: { ...pl.snippet, title: NAME, thumbnails: undefined, localized: undefined } } });
for (const i of talks) {
  const r = await yt.playlistItems.insert({ part: ['snippet'], requestBody: { snippet: { playlistId: ID, resourceId: { kind: 'youtube#video', videoId: i.contentDetails.videoId } } } });
  log.added.push({ videoId: i.contentDetails.videoId, itemId: r.data.id, title: i.snippet.title });
  fs.writeFileSync(f, JSON.stringify(log, null, 1), 'utf8');
}
console.log(`renamed; added ${log.added.length}; log ${f}`);
