// One-off (user, 2026-10-26): Rav Menashe Weiner's older PUBLIC נ"ך lessons -> maalot-nach,
// one season per course (1..10, Tanakh order), the topical ones in "מעגל השנה בתנ"ך" with that
// prefix on their titles. Input: data/podcast/nach-plan2-2026-10-26.json (built from his
// YouTube playlists). Dry run unless --apply.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { google } from 'googleapis';
import { getClientFor } from '../lib/youtube.js';
import { loadEpisodes, saveEpisodes, addEpisode, makeMp3, publishFeed } from '../lib/podcast.js';

const apply = process.argv.includes('--apply');
const SLUG = 'maalot-nach', CYCLE_NAME = 'מעגל השנה בתנ"ך';
const SEASONS = [
  { n: 1, name: 'שופטים', books: ['שופטים'] }, { n: 2, name: 'שמואל א', books: ['שמואל א'] },
  { n: 3, name: 'מלכים א', books: ['מלכים א'] }, { n: 4, name: 'מלכים ב', books: ['מלכים ב'] },
  { n: 5, name: 'סיפורי אליהו ואלישע', books: [] }, { n: 6, name: 'ישעיהו, ירמיהו ויחזקאל', books: ['ישעיהו', 'ירמיהו', 'יחזקאל'] },
  { n: 7, name: 'הושע', books: ['הושע'] }, { n: 8, name: 'איוב', books: ['איוב'] }, { n: 9, name: 'דניאל', books: ['דניאל'] },
  { n: 10, name: CYCLE_NAME, books: [] },
];
const ELIYAHU = 'סיפורי אליהו ואלישע I הרב מנשה וינר', JOB = 'איוב | הרב מנשה וינר';
const norm = (s) => String(s || '').replace(/[֑-ׇ]/g, '').replace(/["״'׳?!.,:;()\-–]/g, ' ').replace(/\s+/g, ' ').trim();
const plan = JSON.parse(fs.readFileSync('data/podcast/nach-plan2-2026-10-26.json', 'utf8'));

const items = [], problems = [];
for (const r of plan) {
  if (r.decision?.startsWith('drop')) continue;
  let n, title = String(r.title2 || '').replace(/\s+/g, ' ').trim();
  if (r.lists.includes(ELIYAHU)) n = 5;
  else if (r.season === 35) { n = 10; title = `${CYCLE_NAME} - ${title}`; }
  else if (r.decision === 'UNSURE' && r.lists.includes(JOB)) { n = 8; if (!title.startsWith('איוב')) title = `איוב - ${title}`; }
  else if (r.decision === 'UNSURE') n = 6; // the ישעיהו/ירמיהו/יחזקאל course (user-approved grouping)
  else n = SEASONS.find((s) => s.books.includes(r.seasonName))?.n;
  if (!n) { problems.push(`no season: ${r.title}`); continue; }
  items.push({ id: r.id, at: r.at, title, season: n, yt: r.title });
}
// the 4 episodes already in the feed (imported from the old Spotify feed) are שופטים
const eps = loadEpisodes(SLUG);
const existing = eps.map((e) => norm(e.title));
const todo = items.filter((i) => { const t = norm(i.yt.split(' | ')[0]); return !existing.some((x) => x === t || (t.length > 6 && (x.includes(t) || t.includes(x)))); });
const by = {}; for (const i of items) by[i.season] = (by[i.season] || 0) + 1;
console.log('seasons:'); for (const s of SEASONS) console.log(`  ${s.n} ${s.name}: ${by[s.n] || 0}`);
console.log(`plan ${items.length} | already in the feed ${items.length - todo.length} | to add ${todo.length} | problems ${problems.length}`);
problems.forEach((p) => console.log('  ', p));
if (!apply) { todo.slice(0, 6).forEach((i) => console.log('   e.g.', i.season, i.title)); process.exit(0); }

// 1. seasons on the show + the existing episodes
const f = 'data/podcast/shows.json', cfg = JSON.parse(fs.readFileSync(f, 'utf8'));
cfg.shows[SLUG].seasons = SEASONS; delete cfg.shows[SLUG].seasonsPending; delete cfg.shows[SLUG].seasonByBook;
fs.writeFileSync(f, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
saveEpisodes(SLUG, eps.map((e) => ({ ...e, season: 1 }))); await publishFeed(SLUG);
console.log('seasons set; existing episodes -> season 1');
// 2. the rest
const yt = google.youtube({ version: 'v3', auth: getClientFor('maalot') });
const meta = {};
for (let k = 0; k < todo.length; k += 50) for (const v of (await yt.videos.list({ part: ['snippet'], id: todo.slice(k, k + 50).map((i) => i.id) })).data.items) meta[v.id] = v.snippet;
const segs = []; for (const sc of Object.values(JSON.parse(fs.readFileSync('data/segments.json', 'utf8')).scans)) segs.push(...sc.segments);
let ok = 0;
for (const i of todo) {
  const seg = segs.find((g) => g.youtubeVideoId === i.id), guid = seg ? `yesmalot-${seg.id}` : `yesmalot-yt-${i.id}`;
  if (loadEpisodes(SLUG).some((e) => e.guid === guid)) continue;
  const base = path.join(os.tmpdir(), `nach-${i.id}`);
  try {
    execFileSync('python', ['-m', 'yt_dlp', '-q', '--no-warnings', '--no-progress', '-f', 'bestaudio', '--no-playlist', '-o', `${base}.%(ext)s`, `https://www.youtube.com/watch?v=${i.id}`], { stdio: 'pipe' });
    const src = fs.readdirSync(os.tmpdir()).find((x) => x.startsWith(`nach-${i.id}.`) && !x.endsWith('.mp3'));
    await makeMp3(path.join(os.tmpdir(), src), `${base}.mp3`, i.title);
    await addEpisode(SLUG, { guid, title: i.title, description: meta[i.id]?.description || '', mp3Path: `${base}.mp3`, pubDate: Date.parse(meta[i.id]?.publishedAt || i.at), season: i.season });
    ok++; console.log(`added ${ok}/${todo.length}: [${i.season}] ${i.title}`);
  } catch (e) { console.log(`FAILED ${i.id} ${i.title}: ${String(e.stderr || e.message).trim().split('\n').pop()}`); }
  finally { for (const x of fs.readdirSync(os.tmpdir()).filter((x) => x.startsWith(`nach-${i.id}.`))) fs.rmSync(path.join(os.tmpdir(), x), { force: true }); }
}
console.log(`DONE: ${ok} added, feed now ${loadEpisodes(SLUG).length}`);
