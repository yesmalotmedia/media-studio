// Adds YouTube lessons that are missing from one of our podcast feeds (e.g. a series
// that stopped being uploaded to Spotify for Creators by hand): audio via yt-dlp ->
// speech-quality MP3 -> addEpisode. Title = the sheet's Spotify title (column K) when
// the studio has the lesson, else the YouTube title's first part; description = the
// video's own YouTube description (what the hand-made episodes carry); date = the
// video's publish date. Idempotent per guid.
//
//   node scripts/fill_from_youtube.mjs <slug> <videoId> [<videoId> ...] [--dry]
//
// guid: yesmalot-<segmentId> when the studio uploaded the lesson (the same guid an
// automatic publish would use), else yesmalot-yt-<videoId>. Never change it later.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { google } from 'googleapis';
import { loadEpisodes, addEpisode, makeMp3, loadShows } from '../lib/podcast.js';
import { getClientFor } from '../lib/youtube.js';

const [slug, ...rest] = process.argv.slice(2);
const dry = rest.includes('--dry');
const ids = rest.filter((a) => !a.startsWith('--'));
const show = loadShows().shows[slug];
if (!show || !ids.length) { console.log('usage: node scripts/fill_from_youtube.mjs <slug> <videoId...> [--dry]'); process.exit(1); }
const channel = show.match?.channel || 'maalot';
const yt = google.youtube({ version: 'v3', auth: getClientFor(channel) });
const vids = [];
for (let i = 0; i < ids.length; i += 50) vids.push(...(await yt.videos.list({ part: ['snippet', 'status'], id: ids.slice(i, i + 50) })).data.items);
const segs = []; for (const sc of Object.values(JSON.parse(fs.readFileSync('data/segments.json', 'utf8')).scans)) segs.push(...sc.segments);
const have = new Set(loadEpisodes(slug).map((e) => e.guid));
for (const v of vids) {
  const seg = segs.find((g) => g.youtubeVideoId === v.id);
  const guid = seg ? `yesmalot-${seg.id}` : `yesmalot-yt-${v.id}`;
  const title = (seg?.spotifyTitle || v.snippet.title.split(' | ')[0]).trim();
  if (have.has(guid)) { console.log('already in feed:', title); continue; }
  console.log(`${dry ? '[dry] ' : ''}${v.snippet.publishedAt.slice(0, 10)} ${v.status.privacyStatus} | ${title} | ${guid}`);
  if (dry) continue;
  const base = path.join(os.tmpdir(), `fill-${v.id}`);
  try {
    execFileSync('python', ['-m', 'yt_dlp', '-q', '--no-warnings', '--no-progress', '-f', 'bestaudio', '--no-playlist', '-o', `${base}.%(ext)s`, `https://www.youtube.com/watch?v=${v.id}`], { stdio: 'pipe' });
    const src = fs.readdirSync(os.tmpdir()).find((f) => f.startsWith(`fill-${v.id}.`) && !f.endsWith('.mp3'));
    await makeMp3(path.join(os.tmpdir(), src), `${base}.mp3`, title);
    await addEpisode(slug, { guid, title, description: v.snippet.description || '', mp3Path: `${base}.mp3`, pubDate: Date.parse(v.snippet.publishedAt) });
    console.log('   added');
  } catch (e) {
    console.log('   FAILED:', String(e.stderr || e.message).trim().split('\n').pop());
  } finally {
    for (const f of fs.readdirSync(os.tmpdir()).filter((f) => f.startsWith(`fill-${v.id}.`))) fs.rmSync(path.join(os.tmpdir(), f), { force: true });
  }
}
