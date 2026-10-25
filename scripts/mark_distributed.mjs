// Ticks the "הופץ" checkboxes (H YouTube, L Spotify, P website) for recent sheet rows by
// CHECKING each platform, not by trusting the studio's own records (user, 2026-10-25):
//   H — a PUBLIC video on the channel whose title is the row's YouTube title (F) / title (C)
//   L — the episode is in the feed Spotify actually reads: our R2 feed if the show was
//       redirected (shows.json redirectedAt) or created by us, else its Spotify-for-Creators feed
//   P — Maalot: a published WordPress post embedding that video; Zohar: a Wix row with it
// Only ticks (never unticks). Dry run unless --apply.
//
//   node scripts/mark_distributed.mjs [--days 7] [--apply]
import fs from 'node:fs';
import { google } from 'googleapis';
import { googleUserAuth } from '../lib/sheetsSync.js';
import { getClientFor } from '../lib/youtube.js';
import { loadShows, loadEpisodes, showForSegment } from '../lib/podcast.js';
import { findPostByVideo } from '../lib/wordpress.js';

const apply = process.argv.includes('--apply');
const days = Number(process.argv[process.argv.indexOf('--days') + 1]) || 7;
const SHEET = '16GRfS33Wb4bYycoSmHuJyns-GUVX-4FNLUh5tA0BDUg', TAB = "'תגובות לטופס 1'!";
const sheets = google.sheets({ version: 'v4', auth: await googleUserAuth() });
const rows = (await sheets.spreadsheets.values.get({ spreadsheetId: SHEET, range: `${TAB}A1:Q2000`, valueRenderOption: 'UNFORMATTED_VALUE' })).data.values || [];
const since = Date.now() - days * 864e5;
const toMs = (serial) => (Number(serial) - 25569) * 864e5 + new Date().getTimezoneOffset() * 60000;
const norm = (s) => String(s || '').replace(/[֑-ׇ]/g, '').replace(/["״'׳?!.,:;()\-–|*]/g, ' ').replace(/\s+/g, ' ').trim();
const isZohar = (b) => /זוהר/.test(b);

// YouTube: recent uploads of both channels with privacy
const ytVideos = {};
for (const ch of ['maalot', 'zohar']) {
  const yt = google.youtube({ version: 'v3', auth: getClientFor(ch) });
  const up = (await yt.channels.list({ part: ['contentDetails'], mine: true })).data.items[0].contentDetails.relatedPlaylists.uploads;
  const list = []; let pt;
  for (let i = 0; i < 4; i++) { const r = await yt.playlistItems.list({ part: ['snippet', 'status'], playlistId: up, maxResults: 50, pageToken: pt }); list.push(...r.data.items.map((it) => ({ id: it.snippet.resourceId.videoId, title: it.snippet.title, privacy: it.status.privacyStatus }))); pt = r.data.nextPageToken; if (!pt) break; }
  ytVideos[ch] = list;
}
// Spotify: the feed Spotify reads for a show
const feedCache = {};
async function spotifyTitles(slug) {
  if (feedCache[slug]) return feedCache[slug];
  const show = loadShows().shows[slug];
  let titles;
  if (show.redirectedAt || !show.spotifyForCreatorsRss) titles = loadEpisodes(slug).map((e) => e.title);
  else { const xml = await (await fetch(show.spotifyForCreatorsRss)).text(); titles = [...xml.matchAll(/<item>[\s\S]*?<title>([\s\S]*?)<\/title>/g)].map((m) => m[1].replace(/<!\[CDATA\[|\]\]>/g, '').trim()); }
  return (feedCache[slug] = titles.map(norm));
}
// Wix (Zohar site): rows by video id
let wixItems = null;
async function wixHas(videoId) {
  if (!wixItems) {
    const c = JSON.parse(fs.readFileSync('credentials/wix.json', 'utf8')), out = [];
    for (const col of [c.collections.iyun, c.collections.pshat]) {
      const r = await fetch('https://www.wixapis.com/wix-data/v2/items/query', { method: 'POST', headers: { Authorization: c.apiKey, 'wix-site-id': c.siteId, 'Content-Type': 'application/json' }, body: JSON.stringify({ dataCollectionId: col, query: { sort: [{ fieldName: '_createdDate', order: 'DESC' }], paging: { limit: 100 } } }) });
      out.push(...((await r.json()).dataItems || []));
    }
    wixItems = out;
  }
  return wixItems.some((it) => JSON.stringify(it.data?.youtube || '').includes(videoId));
}

const writes = [];
for (const [i, r] of rows.entries()) {
  if (i === 0 || !r[0] || typeof r[0] !== 'number' || toMs(r[0]) < since) continue;
  const row = i + 1, B = String(r[1] || '').trim(), C = String(r[2] || '').trim(), F = String(r[5] || '').trim(), K = String(r[10] || '').trim();
  if (!B || !C || /מבקשי פניך/.test(B)) continue;
  const ch = isZohar(B) ? 'zohar' : 'maalot';
  const res = { row, title: C, H: r[7] === true, L: r[11] === true, P: r[15] === true };
  // YouTube
  const v = ytVideos[ch].find((x) => norm(x.title) === norm(F)) || ytVideos[ch].find((x) => norm(x.title.split(' | ')[0]) === norm(C));
  res.video = v ? `${v.id} (${v.privacy})` : 'not found';
  if (!res.H && v?.privacy === 'public') { res.H = 'NEW'; writes.push([row, 'H']); }
  // Spotify
  const slug = showForSegment({ channel: ch, series: B });
  if (!slug) res.spotify = 'no podcast for this series';
  else {
    const t = await spotifyTitles(slug), want = norm(K || C);
    const inFeed = t.some((x) => x === want || (want.length > 6 && (x.includes(want) || want.includes(x))));
    res.spotify = `${slug}: ${inFeed ? 'in the feed' : 'not in the feed'}`;
    if (!res.L && inFeed) { res.L = 'NEW'; writes.push([row, 'L']); }
  }
  // website
  if (v) {
    const onSite = ch === 'zohar' ? await wixHas(v.id) : !!(await findPostByVideo(v.id, { title: C }))?.link;
    res.site = onSite ? 'on the site' : 'not on the site';
    if (!res.P && onSite) { res.P = 'NEW'; writes.push([row, 'P']); }
  }
  console.log(`row ${row} | ${C.slice(0, 45).padEnd(45)} | YT ${res.video} H:${res.H} | ${res.spotify} L:${res.L} | ${res.site || '-'} P:${res.P}`);
}
console.log(`\n${writes.length} checkbox(es) to tick${apply ? '' : ' (dry run — add --apply)'}`);
if (apply && writes.length) {
  await sheets.spreadsheets.values.batchUpdate({ spreadsheetId: SHEET, requestBody: { valueInputOption: 'USER_ENTERED', data: writes.map(([row, col]) => ({ range: `${TAB}${col}${row}`, values: [[true]] })) } });
  console.log('ticked.');
}
