// One-time build of the zohar-pshat podcast (the Zohar short lessons, which were
// never on Spotify) from YouTube: every video on the zohar channel whose title says
// "שיעור קצר"/"פשט" — no filtering, irrelevant episodes get removed afterwards
// (user, 2026-10-12). Audio was downloaded with yt-dlp into data/cache/pshat-audio/
// <videoId>.mp3 (96k mono); 4 lessons that exist only as local files are
// converted from those. Plan (title, date, source) in data/podcast/import-zohar-pshat-plan.json.
//
//   node scripts/import_pshat.mjs          # upload what's ready, republish the feed
//
// Resumable: an episode already in data/podcast/episodes/zohar-pshat.json is skipped,
// one whose audio isn't downloaded yet is reported and left for the next run.
// guid = yesmalot-yt-<videoId> (or yesmalot-file-<hash>) — never change it.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { loadShows, loadEpisodes, saveEpisodes, putObject, publishFeed, makeMp3 } from '../lib/podcast.js';
import { probe } from '../lib/ff.js';

const SLUG = 'zohar-pshat';
const AUDIO = path.join('data', 'cache', 'pshat-audio');
const CONCURRENCY = 4;
const show = loadShows().shows[SLUG];
const plan = JSON.parse(fs.readFileSync(path.join('data', 'podcast', `import-${SLUG}-plan.json`), 'utf8'));
const LOG = path.join('data', 'podcast', `import-${SLUG}.log`);
const log = (m) => { const l = `${new Date().toISOString()} ${m}`; console.log(l); fs.appendFileSync(LOG, l + '\n', 'utf8'); };

const guidOf = (e) => (e.videoId ? `yesmalot-yt-${e.videoId}` : `yesmalot-file-${crypto.createHash('md5').update(e.file).digest('hex').slice(0, 12)}`);
const descOf = (e) => [e.videoId ? `לצפייה בשיעור ביוטיוב:\nhttps://youtu.be/${e.videoId}` : '', show.episodeFooter].filter(Boolean).join('\n\n');

const have = new Set(loadEpisodes(SLUG).map((e) => e.guid));
const todo = plan.filter((e) => !have.has(guidOf(e)));
const notReady = todo.filter((e) => e.videoId && !fs.existsSync(path.join(AUDIO, `${e.videoId}.mp3`)));
const ready = todo.filter((e) => !notReady.includes(e));
log(`${SLUG}: ${plan.length} in plan, ${have.size} already in feed, ${ready.length} to upload now, ${notReady.length} audio not downloaded yet`);

// show artwork
if (!have.size) {
  await putObject(`${SLUG}/cover.jpg`, fs.readFileSync(path.join('data', 'podcast', `${SLUG}-cover.jpg`)), 'image/jpeg', 'public, max-age=86400');
  log('cover uploaded');
}

let done = 0, failed = 0;
async function one(e) {
  const guid = guidOf(e);
  let mp3 = e.videoId ? path.join(AUDIO, `${e.videoId}.mp3`) : path.join(os.tmpdir(), `${guid}.mp3`);
  try {
    if (!e.videoId) await makeMp3(e.file, mp3, e.title);
    const body = fs.readFileSync(mp3);
    const audioKey = `${SLUG}/audio/${guid}.mp3`;
    await putObject(audioKey, body, 'audio/mpeg', 'public, max-age=31536000, immutable');
    const { duration } = await probe(mp3);
    const eps = loadEpisodes(SLUG).filter((x) => x.guid !== guid);
    eps.push({ guid, title: e.title, description: descOf(e), audioKey, length: body.length, duration, pubDate: e.at, videoId: e.videoId || undefined, importedFrom: e.videoId ? 'youtube' : 'file' });
    saveEpisodes(SLUG, eps);
    done++;
    if (done % 50 === 0) { await publishFeed(SLUG); log(`progress: ${done}/${ready.length}, ${failed} failed (feed republished)`); }
  } catch (err) {
    failed++;
    log(`FAILED ${guid} "${e.title}": ${err.message}`);
  } finally {
    if (!e.videoId) fs.rmSync(mp3, { force: true });
  }
}
const queue = [...ready];
await Promise.all(Array.from({ length: CONCURRENCY }, async () => { while (queue.length) await one(queue.shift()); }));
await publishFeed(SLUG);
log(`DONE: ${done} uploaded, ${failed} failed, ${loadEpisodes(SLUG).length} episodes in feed, ${notReady.length} waiting for audio. Re-run after downloads finish.`);
