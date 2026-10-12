// One-time migration of a show off Spotify for Creators into our R2 feed
// (lib/podcast.js): every episode of its current RSS feed is downloaded,
// re-encoded to speech-quality MP3 (mono 96 kbps — decided 2026-10-08, cuts
// the zohar archive from ~40 GB to ~13 GB), uploaded, and listed in
// data/podcast/episodes/<slug>.json with its ORIGINAL guid, title, description
// and date — so Spotify/Apple see the same episodes after the 301 redirect,
// not 900 new ones.
//
//   node scripts/import_podcast.mjs zohar          # import / resume
//   node scripts/import_podcast.mjs zohar --dry    # just list what would be done
//
// Safe to stop and re-run: an episode already in the list is skipped, so a
// re-run also picks up episodes uploaded to Spotify for Creators by hand since
// the last run (do one last run right before the redirect). Progress goes to
// data/podcast/import-<slug>.log.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { loadShows, loadEpisodes, saveEpisodes, putObject, publishFeed, makeMp3 } from '../lib/podcast.js';
import { probe } from '../lib/ff.js';

const slug = process.argv[2];
const dry = process.argv.includes('--dry');
const CONCURRENCY = 3;
if (!slug) { console.log('usage: node scripts/import_podcast.mjs <slug> [--dry]'); process.exit(1); }
const cfg = loadShows();
const show = cfg.shows[slug];
if (!show?.spotifyForCreatorsRss) { console.log(`show "${slug}" has no spotifyForCreatorsRss in data/podcast/shows.json`); process.exit(1); }

const LOG = path.join('data', 'podcast', `import-${slug}.log`);
const log = (msg) => { const line = `${new Date().toISOString()} ${msg}`; console.log(line); fs.appendFileSync(LOG, line + '\n', 'utf8'); };

// Parse the feed with Python's XML parser (already on this machine) rather than
// regexes — titles/descriptions contain HTML, CDATA and every kind of quote.
const xmlFile = path.join(os.tmpdir(), `feed-${slug}.xml`);
fs.writeFileSync(xmlFile, await (await fetch(show.spotifyForCreatorsRss)).text(), 'utf8');
const items = JSON.parse(execFileSync('python', ['-c', `
import xml.etree.ElementTree as ET,sys,json,email.utils
ch=ET.parse(sys.argv[1]).getroot().find('channel')
out=[]
for it in ch.findall('item'):
  e=it.find('enclosure')
  if e is None: continue
  d=email.utils.parsedate_to_datetime(it.findtext('pubDate'))
  out.append({'guid':(it.findtext('guid') or '').strip(),'title':(it.findtext('title') or '').strip(),'description':it.findtext('description') or '','pubDate':int(d.timestamp()*1000),'url':e.get('url')})
print(json.dumps(out,ensure_ascii=False))
`, xmlFile], { encoding: 'utf8', maxBuffer: 1e9, env: { ...process.env, PYTHONIOENCODING: 'utf-8' } }));
fs.rmSync(xmlFile, { force: true });

const have = new Set(loadEpisodes(slug).map((e) => e.guid));
const todo = items.filter((i) => i.guid && !have.has(i.guid));

// Episodes already imported: carry over edits made in Spotify for Creators since
// (title/description — CONFIRMED 2026-10-11: a title fixed there after the
// import stayed old in our feed). Audio is not re-downloaded.
const byGuid = new Map(items.map((i) => [i.guid, i]));
const changed = loadEpisodes(slug).filter((e) => {
  const src = byGuid.get(e.guid);
  return e.importedFrom === 'spotify-for-creators' && src && (src.title !== e.title || src.description !== e.description);
});
log(`${slug}: ${items.length} episodes in source feed, ${have.size} already imported, ${todo.length} to do, ${changed.length} with edited title/description${dry ? ' (dry run)' : ''}`);
for (const e of changed) log(`  edited: "${e.title}" -> "${byGuid.get(e.guid).title}"`);
if (dry) { todo.slice(0, 5).forEach((i) => console.log('  ', new Date(i.pubDate).toISOString().slice(0, 10), i.title)); process.exit(0); }
if (changed.length) {
  const edited = new Set(changed.map((e) => e.guid)); // by guid: loadEpisodes() returns fresh objects every call
  const eps = loadEpisodes(slug).map((e) => (edited.has(e.guid) ? { ...e, title: byGuid.get(e.guid).title, description: byGuid.get(e.guid).description } : e));
  saveEpisodes(slug, eps);
  await publishFeed(slug);
  log(`updated ${changed.length} edited episode(s) in the feed`);
}

// show artwork -> <slug>/cover.jpg (the feed then points at our copy)
if (show.sourceImage) {
  const img = Buffer.from(await (await fetch(show.sourceImage)).arrayBuffer());
  await putObject(`${slug}/cover.jpg`, img, 'image/jpeg', 'public, max-age=86400');
  log(`cover uploaded (${img.length} bytes)`);
}

let done = 0, failed = 0;
async function importOne(item) {
  const base = item.guid.replace(/[^a-zA-Z0-9_-]/g, '_');
  const src = path.join(os.tmpdir(), `imp-${base}.src`);
  const mp3 = path.join(os.tmpdir(), `imp-${base}.mp3`);
  try {
    const res = await fetch(item.url, { redirect: 'follow' });
    if (!res.ok) throw new Error(`download HTTP ${res.status}`);
    fs.writeFileSync(src, Buffer.from(await res.arrayBuffer()));
    await makeMp3(src, mp3, item.title);
    const body = fs.readFileSync(mp3);
    const audioKey = `${slug}/audio/${base}.mp3`;
    await putObject(audioKey, body, 'audio/mpeg', 'public, max-age=31536000, immutable');
    const { duration } = await probe(mp3);
    // re-read + append + save each time: several workers share the list
    const eps = loadEpisodes(slug).filter((e) => e.guid !== item.guid);
    eps.push({ guid: item.guid, title: item.title, description: item.description, audioKey, length: body.length, duration, pubDate: item.pubDate, importedFrom: 'spotify-for-creators' });
    saveEpisodes(slug, eps);
    done++;
    if (done % 25 === 0) { await publishFeed(slug); log(`progress: ${done}/${todo.length} imported, ${failed} failed (feed republished)`); }
  } catch (e) {
    failed++;
    log(`FAILED ${item.guid} "${item.title}": ${e.message}`);
  } finally {
    fs.rmSync(src, { force: true });
    fs.rmSync(mp3, { force: true });
  }
}

const queue = [...todo];
await Promise.all(Array.from({ length: CONCURRENCY }, async () => { while (queue.length) await importOne(queue.shift()); }));
await publishFeed(slug);
log(`DONE: ${done} imported, ${failed} failed, ${loadEpisodes(slug).length} episodes in ${slug} feed. Re-run to retry failures.`);
