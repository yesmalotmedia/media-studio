// Self-hosted podcast feeds on Cloudflare R2 — Spotify (and Apple etc.) read
// a plain RSS feed, so instead of a paid host we publish the feed + MP3s to our
// own R2 bucket, served at a fixed public address by a tiny Worker
// (cloudflare/podcast-worker.js). Decided 2026-10-08: Spotify for Creators has
// no upload API, and audio-only is fine on Spotify.
//
// Layout in the bucket, per show (slug):
//   <slug>/feed.xml            the RSS feed Spotify/Apple poll
//   <slug>/cover.jpg           show artwork (square)
//   <slug>/audio/<file>.mp3    one file per episode
//
// State (in git, not secret): data/podcast/shows.json — show settings and which
// lessons go to which show; data/podcast/episodes/<slug>.json — the episode list
// the feed is rebuilt from. Credentials: credentials/r2.json (git-ignored).
//
// A show only receives new lessons automatically once its "autoPublish" is
// true. It stays false while the show still lives on Spotify for Creators:
// episodes uploaded there by hand in the meantime come over with the one-time
// import at migration time, so publishing here too would duplicate them.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { runFfmpeg, probe } from './ff.js';
import { buildDescription } from './rooms.js';
import { markSheetIf } from './sheetMarks.js';

const ROOT = process.cwd();
const SHOWS_FILE = path.join(ROOT, 'data', 'podcast', 'shows.json');
const EP_DIR = path.join(ROOT, 'data', 'podcast', 'episodes');

export function loadShows() {
  return JSON.parse(fs.readFileSync(SHOWS_FILE, 'utf8'));
}

let s3cache = null;
function r2() {
  if (s3cache) return s3cache;
  const c = JSON.parse(fs.readFileSync(path.join(ROOT, 'credentials', 'r2.json'), 'utf8'));
  const client = new S3Client({
    region: 'auto',
    endpoint: `https://${c.accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: c.accessKeyId, secretAccessKey: c.secretAccessKey },
  });
  s3cache = { client, bucket: c.bucket };
  return s3cache;
}

export async function putObject(key, body, contentType, cacheControl) {
  const { client, bucket } = r2();
  await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType, CacheControl: cacheControl }));
}

export function loadEpisodes(slug) {
  const f = path.join(EP_DIR, `${slug}.json`);
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : [];
}
export function saveEpisodes(slug, eps) {
  fs.mkdirSync(EP_DIR, { recursive: true });
  fs.writeFileSync(path.join(EP_DIR, `${slug}.json`), JSON.stringify(eps, null, 1), 'utf8');
}

// Which show a lesson belongs to: the first show whose "match" fits — by
// YouTube channel, exact column-B series names (maalot: one podcast per
// series) and/or a series-name prefix. The zohar podcast is iyun lessons only
// (seriesPrefix "שיעור עיון בזוהר", one series per parsha). The short lessons
// ("העמוד היומי בזוהר - פרשת X | שיעור קצר") were never on Spotify and got
// their own show, zohar-pshat, created on R2 directly (2026-10-12).
// A lesson can belong to SEVERAL shows (user, 2026-10-20): every עתים לתורה lesson goes to the
// shared "עתים לתורה" podcast AND to its own series' podcast.
export function showsForSegment(seg) {
  const { shows } = loadShows();
  const series = String(seg.series || '').trim();
  return Object.entries(shows).filter(([, s]) => {
    const m = s.match || {};
    if (m.channel && m.channel !== seg.channel) return false;
    if (m.series && !m.series.includes(series)) return false;
    if (m.seriesPrefix && !series.startsWith(m.seriesPrefix)) return false;
    return !!(m.channel || m.series || m.seriesPrefix);
  }).map(([slug]) => slug);
}
export const showForSegment = (seg) => showsForSegment(seg)[0] || null;

// Speech: mono 96 kbps MP3 is plenty and keeps a 40-minute lesson around 30 MB.
// The title only goes into the MP3's own ID3 tag (the feed has its own copy).
// CONFIRMED FOR REAL (2026-10-08): a '"' in it (e.g. a title that starts with
// one, or יו"כ) breaks the cmd /c quoting in lib/ff.js and ffmpeg takes a piece
// of the title as the output file name — so swap it for a Hebrew gershayim.
export async function makeMp3(videoPath, outPath, title) {
  const tag = String(title || '').replace(/"/g, '״');
  await runFfmpeg(['-v', 'error', '-y', '-i', videoPath, '-vn', '-ac', '1', '-ar', '44100', '-c:a', 'libmp3lame', '-b:a', '96k',
    '-metadata', `title=${tag}`, outPath]);
}

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const cdata = (s) => `<![CDATA[${String(s ?? '').replace(/]]>/g, ']]]]><![CDATA[>')}]]>`;
const hms = (sec) => { sec = Math.round(sec); return [Math.floor(sec / 3600), Math.floor((sec % 3600) / 60), sec % 60].map((n) => String(n).padStart(2, '0')).join(':'); };

// RSS 2.0 + iTunes/podcast namespaces — the fields Spotify and Apple require.
// Episode guids NEVER change once published (apps use them to tell episodes
// apart; a changed guid shows up as a duplicate episode).
export function buildFeed(slug, show, episodes, publicBase) {
  const base = publicBase.replace(/\/$/, '');
  const items = [...episodes].sort((a, b) => b.pubDate - a.pubDate).map((e) => `
    <item>
      <title>${esc(e.title)}</title>
      <description>${cdata(e.description)}</description>
      <guid isPermaLink="false">${esc(e.guid)}</guid>
      <pubDate>${new Date(e.pubDate).toUTCString()}</pubDate>
      <enclosure url="${esc(e.audioUrl || `${base}/${e.audioKey}`)}" length="${e.length}" type="audio/mpeg"/>
      <itunes:duration>${hms(e.duration)}</itunes:duration>${e.season ? `
      <itunes:season>${e.season}</itunes:season>` : ''}
      <itunes:episodeType>full</itunes:episodeType>
      <itunes:explicit>false</itunes:explicit>
    </item>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:podcast="https://podcastindex.org/namespace/1.0">
  <channel>
    <title>${esc(show.title)}</title>
    <link>${esc(show.link)}</link>
    <language>${esc(show.language || 'he')}</language>
    <description>${cdata(show.description)}</description>
    <atom:link href="${esc(`${base}/${slug}/feed.xml`)}" rel="self" type="application/rss+xml"/>
    <itunes:author>${esc(show.author)}</itunes:author>
    <itunes:owner><itunes:name>${esc(show.ownerName || show.author)}</itunes:name><itunes:email>${esc(show.ownerEmail)}</itunes:email></itunes:owner>
    <itunes:image href="${esc(show.image || `${base}/${slug}/cover.jpg`)}"/>
    <itunes:category text="${esc(show.category || 'Religion & Spirituality')}">${show.subcategory ? `<itunes:category text="${esc(show.subcategory)}"/>` : ''}</itunes:category>
    <itunes:explicit>false</itunes:explicit>
    <itunes:type>episodic</itunes:type>${items}
  </channel>
</rss>
`;
}

export async function publishFeed(slug) {
  const cfg = loadShows();
  const show = cfg.shows[slug];
  const xml = buildFeed(slug, show, loadEpisodes(slug), cfg.publicBase);
  // short cache: apps should see a new episode within minutes
  await putObject(`${slug}/feed.xml`, xml, 'application/rss+xml; charset=utf-8', 'public, max-age=300');
  return xml;
}

// Adds one episode (audio already encoded) to a show and republishes its feed.
// Idempotent per guid — re-running for the same lesson updates, never duplicates.
// A show taught book by book (shows.json seasonByBook, e.g. Rav Weiner's נ"ך — user,
// 2026-10-20) numbers its seasons by the book's place in the Tanakh (שופטים = 2).
export function seasonOfTitle(title) {
  const ORDER = ['יהושע', 'שופטים', 'שמואל א', 'שמואל ב', 'מלכים א', 'מלכים ב', 'ישעיהו', 'ירמיהו', 'יחזקאל', 'הושע', 'יואל', 'עמוס', 'עובדיה', 'יונה', 'מיכה', 'נחום', 'חבקוק', 'צפניה', 'חגי', 'זכריה', 'מלאכי', 'תהלים', 'משלי', 'איוב', 'שיר השירים', 'רות', 'איכה', 'קהלת', 'אסתר', 'דניאל', 'עזרא', 'נחמיה', 'דברי הימים א', 'דברי הימים ב'];
  const t = String(title || '').replace(/["״'׳]/g, '').replace(/^ספר\s+/, '').replace(/^ישעיה(?=[\s-])/, 'ישעיהו').replace(/^ירמיה(?=[\s-])/, 'ירמיהו').trim();
  const i = ORDER.slice().sort((a, b) => b.length - a.length).map((b) => [b, ORDER.indexOf(b)]).find(([b]) => t === b || t.startsWith(b + ' ') || t.startsWith(b + '-'));
  return i ? i[1] + 1 : undefined;
}

export async function addEpisode(slug, { guid, title, description, mp3Path, pubDate = Date.now() }) {
  const season = loadShows().shows[slug]?.seasonByBook ? seasonOfTitle(title) : undefined;
  const fileName = `${guid.replace(/[^a-zA-Z0-9_-]/g, '_')}.mp3`;
  const audioKey = `${slug}/audio/${fileName}`;
  const body = fs.readFileSync(mp3Path);
  await putObject(audioKey, body, 'audio/mpeg', 'public, max-age=31536000, immutable');
  const { duration } = await probe(mp3Path);
  const eps = loadEpisodes(slug).filter((e) => e.guid !== guid);
  eps.push({ guid, title, description, audioKey, length: body.length, duration, pubDate, ...(season ? { season } : {}) });
  saveEpisodes(slug, eps);
  await publishFeed(slug);
  return { audioKey, length: body.length, duration };
}

// Called right after a lesson's YouTube upload (app/api/export,
// app/api/youtube-upload). Never throws — a podcast problem must not fail
// the upload. Returns the fields to store on the segment.
export async function publishSegment(seg) {
  const slugs = showsForSegment(seg);
  if (!slugs.length) return { podcastStatus: 'no-show' };
  const live = slugs.filter((s) => loadShows().shows[s].autoPublish);
  if (!live.length) return { podcastStatus: 'not-migrated', podcastShow: slugs.join(',') };
  if (!seg.exportPath || !fs.existsSync(seg.exportPath)) return { podcastStatus: 'error', podcastError: 'export file not found' };
  const mp3 = path.join(os.tmpdir(), `shiur-${seg.id}.mp3`);
  const done = [], errors = [];
  try {
    const title = seg.spotifyTitle || seg.youtubeTitle || seg.title;
    await makeMp3(seg.exportPath, mp3, title);
    for (const slug of live) {
      try {
        // optional per-show footer (site/WhatsApp links) under the lesson's own notes
        const description = [buildDescription(seg), loadShows().shows[slug].episodeFooter].filter(Boolean).join('\n\n');
        await addEpisode(slug, { guid: `yesmalot-${seg.id}`, title, description, mp3Path: mp3 });
        done.push(slug);
      } catch (e) { errors.push(`${slug}: ${e.message || e}`); }
    }
  } catch (e) {
    errors.push(String(e.message || e));
  } finally {
    fs.rmSync(mp3, { force: true });
  }
  if (!done.length) return { podcastStatus: 'error', podcastShow: live.join(','), podcastError: errors.join(' | ') };
  // tick "ספוטיפיי הופץ" (column L) when switched on (lib/sheetMarks.js) — never a podcast failure
  const sheet = await markSheetIf('spotify', seg);
  return { podcastStatus: errors.length ? 'partial' : 'done', podcastShow: done.join(','), podcastAt: Date.now(), ...(errors.length ? { podcastError: errors.join(' | ') } : {}), ...sheet };
}
