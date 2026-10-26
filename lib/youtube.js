// Uploads an exported video to the correct YouTube channel, based on the
// segment's own `channel` field (lib/rooms.js default, editable per-segment
// in the review UI — see app/page.js). Each channel has its own OAuth token
// file, obtained once via scripts/youtube_auth.mjs (see credentials/).
import fs from 'node:fs';
import path from 'node:path';
import { google } from 'googleapis';

const CRED_DIR = path.join(process.cwd(), 'credentials');

// The one YouTube channel each label must upload to. CONFIRMED FOR REAL
// (2026-09-30): the account manages several channels and the consent screen's
// picker decides which one a token gets — the zohar token had been issued for
// the old, inactive "הזוהר היומי" (UChZAmZylEfqR2lJlqp0Pqvw) instead of the
// live "העמוד היומי בזוהר" (@zoharday), and every zohar upload for three
// weeks silently went to the wrong channel. Checked on auth and before every
// upload so a wrong pick fails loudly instead.
export const EXPECTED_CHANNELS = {
  maalot: { id: 'UCXGUXEMhk3PaZxep7NVTM5A', title: 'ישיבת מעלות' },
  zohar: { id: 'UCrWDhDGWajXJ3YX2pMWj1mw', title: 'העמוד היומי בזוהר' },
};

function loadClientCreds() {
  const file = path.join(CRED_DIR, 'youtube_oauth_client.json');
  const { installed } = JSON.parse(fs.readFileSync(file, 'utf8'));
  return installed;
}

// One client per channel per process, cached by the token FILE'S mtime —
// googleapis' OAuth2Client refreshes its own access_token from the stored
// refresh_token automatically on every call, so no manual access-token
// refresh code is needed. CONFIRMED FOR REAL (2026-09-22): the cache used to
// be unconditional (once built, kept forever for the process's lifetime) —
// after re-running scripts/youtube_auth.mjs to fix an expired/revoked
// refresh_token (invalid_grant), uploads kept failing with the exact same
// invalid_grant for hours, because the live dev server was still holding the
// OLD OAuth2Client object in memory and never looked at the token file
// again. A standalone one-off script (fresh process, no stale cache) picked
// up the new file immediately and worked, which is what made this visible.
// Keying the cache on the file's mtime means a re-auth is picked up on the
// very next call, no server restart needed, while still avoiding a disk read
// on every single upload in the normal case (mtime unchanged).
const clients = {}; // channel -> { mtimeMs, client }
// (exported as getClientFor for lib/distribute.js, which reads the channel's uploads list)
export const getClientFor = (channel) => getClient(channel);
function getClient(channel) {
  const tokenFile = path.join(CRED_DIR, `youtube_token_${channel}.json`);
  if (!fs.existsSync(tokenFile)) {
    throw new Error(`no YouTube token for channel "${channel}" — run: node scripts/youtube_auth.mjs ${channel}`);
  }
  const mtimeMs = fs.statSync(tokenFile).mtimeMs;
  const cached = clients[channel];
  if (cached && cached.mtimeMs === mtimeMs) return cached.client;

  const { client_id, client_secret } = loadClientCreds();
  const tokens = JSON.parse(fs.readFileSync(tokenFile, 'utf8'));
  const oAuth2Client = new google.auth.OAuth2(client_id, client_secret);
  oAuth2Client.setCredentials(tokens);
  clients[channel] = { mtimeMs, client: oAuth2Client };
  return oAuth2Client;
}

// channel: 'maalot' | 'zohar' — never call this for 'internal' (not meant
// for public distribution at all, see lib/rooms.js).
// Unlisted by default (was private until 2026-10-11): the Zohar site embeds the
// video right after upload, and a private video won't play there; unlisted plays
// from the link/embed but stays off the channel page and search until it's
// published in Studio. Same for both channels, per the user.
export async function uploadVideo(channel, filePath, { title, description = '', privacyStatus = 'unlisted' } = {}) {
  if (channel === 'internal') throw new Error('channel "internal" is not for distribution — should never reach uploadVideo');
  // CONFIRMED FOR REAL (2026-09-08): fs.createReadStream() on a missing file
  // emits its 'error' EVENT asynchronously, after this call has already
  // returned — that's outside the promise googleapis awaits internally, so
  // it surfaced as an uncaughtException that hung the whole upload job
  // forever instead of failing just this one segment. Check up front so a
  // missing file is a normal, catchable rejection like any other failure.
  if (!fs.existsSync(filePath)) {
    throw new Error(`export file not found on disk: ${filePath}`);
  }
  const auth = getClient(channel);
  const youtube = google.youtube({ version: 'v3', auth });

  // Once per client (i.e. per token file version) — see EXPECTED_CHANNELS.
  const cached = clients[channel];
  if (!cached.verifiedChannelId) {
    const me = await youtube.channels.list({ mine: true, part: ['snippet'] });
    const ch = me.data.items?.[0];
    const expected = EXPECTED_CHANNELS[channel];
    if (!expected || ch?.id !== expected.id) {
      throw new Error(`YouTube token for "${channel}" is connected to channel "${ch?.snippet?.title}" (${ch?.id}), expected "${expected?.title}" (${expected?.id}) — reconnect and pick the right channel`);
    }
    cached.verifiedChannelId = ch.id;
  }

  const res = await youtube.videos.insert({
    part: ['snippet', 'status'],
    requestBody: {
      snippet: {
        title: title.slice(0, 100), // YouTube's hard title length limit
        description,
        categoryId: '22', // People & Blogs — reasonable default, editable per-video on YouTube later
      },
      status: { privacyStatus, selfDeclaredMadeForKids: false },
    },
    media: { body: fs.createReadStream(filePath) },
  });

  const videoId = res.data.id;
  return { videoId, url: `https://youtu.be/${videoId}` };
}

// The titles sheet is the source of truth for playlist names (decided
// 2026-10-05, when 37 playlists were renamed to match column B exactly — see
// data/playlist-renames/): a video goes into the playlist whose title is
// EXACTLY its series name. No fuzzy matching and no auto-creating — a series
// without a playlist is reported, not guessed. Each channel's playlist list is
// cached briefly so a batch of uploads doesn't re-list them every time.
const playlistCache = {}; // channel -> { at, byTitle: Map(title -> [ids]) }
async function playlistsByTitle(channel) {
  const c = playlistCache[channel];
  if (c && Date.now() - c.at < 10 * 60 * 1000) return c.byTitle;
  const youtube = google.youtube({ version: 'v3', auth: getClient(channel) });
  const byTitle = new Map();
  let pageToken;
  do {
    const r = await youtube.playlists.list({ part: ['snippet'], mine: true, maxResults: 50, pageToken });
    for (const p of r.data.items) {
      const t = p.snippet.title.trim();
      byTitle.set(t, [...(byTitle.get(t) || []), p.id]);
    }
    pageToken = r.data.nextPageToken;
  } while (pageToken);
  playlistCache[channel] = { at: Date.now(), byTitle };
  return byTitle;
}

// Series that share one playlist instead of one each (user, 2026-10-26): every rabbi's
// "שיחות בנושאים שונים | <rabbi>" goes into the single "שיחות בנושאים שונים" playlist.
const SHARED_PLAYLISTS = [[/^שיחות בנושאים שונים\s*\|/, 'שיחות בנושאים שונים']];
export const playlistNameFor = (series) => { const s = String(series || '').trim(); return SHARED_PLAYLISTS.find(([re]) => re.test(s))?.[1] || s; };

// The playlist id for a series (exact column-B name), or null if there's none
// or the name is ambiguous — used for the playlist link in descriptions.
export async function findSeriesPlaylistId(channel, series) {
  try {
    const ids = (await playlistsByTitle(channel)).get(playlistNameFor(series)) || [];
    return ids.length === 1 ? ids[0] : null;
  } catch {
    return null;
  }
}

// Adds an uploaded video to its series playlist. Needs youtube.force-ssl on the
// channel's token (youtube.upload alone can't touch playlists) — reconnect the
// channel via the app's connect button to get it. Never throws: returns the
// fields to store on the segment (playlistStatus 'done' | 'no-playlist' |
// 'ambiguous' | 'error').
export async function addToSeriesPlaylist(channel, videoId, series) {
  try {
    const ids = (await playlistsByTitle(channel)).get(playlistNameFor(series)) || [];
    if (!ids.length) return { playlistStatus: 'no-playlist' };
    if (ids.length > 1) return { playlistStatus: 'ambiguous', playlistError: `${ids.length} playlists named "${series}"` };
    const youtube = google.youtube({ version: 'v3', auth: getClient(channel) });
    await youtube.playlistItems.insert({ part: ['snippet'], requestBody: { snippet: { playlistId: ids[0], resourceId: { kind: 'youtube#video', videoId } } } });
    return { playlistStatus: 'done', playlistId: ids[0] };
  } catch (e) {
    const msg = String(e.message || e);
    return { playlistStatus: 'error', playlistError: /insufficient/i.test(msg) ? 'missing playlist permission — reconnect this channel' : msg };
  }
}

// A series taught book by book also gets one playlist per book, next to its main one
// (user, 2026-10-20): Rav Weiner's נ"ך -> "שופטים | הרב מנשה וינר" etc. The book is read
// from the start of the lesson title ("שופטים פרק א", "ספר שופטים - ..."); its playlist is
// created (public, like the others) the first time a book appears. Never throws.
const BOOK_SERIES = { 'נ"ך | הרב מנשה וינר': 'הרב מנשה וינר' };
const TANAKH_BOOKS = ['יהושע', 'שופטים', 'שמואל א', 'שמואל ב', 'מלכים א', 'מלכים ב', 'ישעיהו', 'ישעיה', 'ירמיהו', 'ירמיה', 'יחזקאל', 'הושע', 'יואל', 'עמוס', 'עובדיה', 'יונה', 'מיכה', 'נחום', 'חבקוק', 'צפניה', 'חגי', 'זכריה', 'מלאכי', 'תהלים', 'תהילים', 'משלי', 'איוב', 'שיר השירים', 'רות', 'איכה', 'קהלת', 'אסתר', 'דניאל', 'עזרא', 'נחמיה', 'דברי הימים א', 'דברי הימים ב'];
export function bookOfTitle(title) {
  const t = String(title || '').replace(/["״'׳]/g, '').replace(/^ספר\s+/, '').trim();
  return [...TANAKH_BOOKS].sort((a, b) => b.length - a.length).find((b) => t === b || t.startsWith(b + ' ') || t.startsWith(b + '-')) || null;
}
export async function addToBookPlaylist(channel, videoId, series, title) {
  const rav = BOOK_SERIES[String(series || '').trim()];
  if (!rav) return {};
  const book = bookOfTitle(title);
  if (!book) return { bookPlaylistStatus: 'no-book', bookPlaylistError: `no Tanakh book at the start of "${title}"` };
  const name = `${book} | ${rav}`;
  try {
    const youtube = google.youtube({ version: 'v3', auth: getClient(channel) });
    let id = ((await playlistsByTitle(channel)).get(name) || [])[0];
    if (!id) {
      id = (await youtube.playlists.insert({ part: ['snippet', 'status'], requestBody: { snippet: { title: name }, status: { privacyStatus: 'public' } } })).data.id;
      delete playlistCache[channel]; // the next lookup sees the new playlist
    }
    await youtube.playlistItems.insert({ part: ['snippet'], requestBody: { snippet: { playlistId: id, resourceId: { kind: 'youtube#video', videoId } } } });
    return { bookPlaylistStatus: 'done', bookPlaylist: name, bookPlaylistId: id };
  } catch (e) {
    return { bookPlaylistStatus: 'error', bookPlaylistError: String(e.message || e) };
  }
}

// Removes a video from a playlist (e.g. a re-exported lesson replaced its first
// upload). Returns how many entries were removed.
export async function removeFromPlaylist(channel, playlistId, videoId) {
  const youtube = google.youtube({ version: 'v3', auth: getClient(channel) });
  const r = await youtube.playlistItems.list({ part: ['id'], playlistId, videoId, maxResults: 50 });
  for (const it of r.data.items || []) await youtube.playlistItems.delete({ id: it.id });
  return (r.data.items || []).length;
}

// Replaces the description of an already-uploaded video (title, category and
// tags kept as they are — videos.update requires sending them back). Needs
// youtube.force-ssl, which both channel tokens have since 2026-10-07.
export async function updateVideoDescription(channel, videoId, description) {
  const youtube = google.youtube({ version: 'v3', auth: getClient(channel) });
  const cur = (await youtube.videos.list({ part: ['snippet'], id: [videoId] })).data.items?.[0];
  if (!cur) throw new Error(`video ${videoId} not found`);
  const { title, categoryId, tags, defaultLanguage } = cur.snippet;
  await youtube.videos.update({
    part: ['snippet'],
    requestBody: { id: videoId, snippet: { title, categoryId, tags, defaultLanguage, description } },
  });
}

// Privacy + duration of up to any number of videos on one channel:
// { [videoId]: { privacy: 'public'|'unlisted'|'private', durationSec } } (missing = deleted).
export async function videoStatuses(channel, ids) {
  const youtube = google.youtube({ version: 'v3', auth: getClient(channel) });
  const out = {};
  for (let i = 0; i < ids.length; i += 50) {
    const r = await youtube.videos.list({ part: ['status', 'contentDetails'], id: ids.slice(i, i + 50) });
    for (const it of r.data.items || []) {
      const m = it.contentDetails.duration.match(/P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/) || [];
      out[it.id] = { privacy: it.status.privacyStatus, durationSec: (+m[1] || 0) * 86400 + (+m[2] || 0) * 3600 + (+m[3] || 0) * 60 + (+m[4] || 0) };
    }
  }
  return out;
}

// Renames an uploaded video (e.g. the title was refined in the sheet after the
// upload), keeping its description and the rest of the snippet.
export async function updateVideoTitle(channel, videoId, title) {
  const youtube = google.youtube({ version: 'v3', auth: getClient(channel) });
  const cur = (await youtube.videos.list({ part: ['snippet'], id: [videoId] })).data.items?.[0];
  if (!cur) throw new Error(`video ${videoId} not found`);
  const { categoryId, tags, defaultLanguage, description } = cur.snippet;
  await youtube.videos.update({
    part: ['snippet'],
    requestBody: { id: videoId, snippet: { title, categoryId, tags, defaultLanguage, description } },
  });
}

// Changes a video's privacy ('private' | 'unlisted' | 'public'), keeping the
// other status fields (videos.update resets any status field not sent back).
export async function setVideoPrivacy(channel, videoId, privacyStatus) {
  const youtube = google.youtube({ version: 'v3', auth: getClient(channel) });
  const s = (await youtube.videos.list({ part: ['status'], id: [videoId] })).data.items?.[0]?.status;
  if (!s) throw new Error(`video ${videoId} not found`);
  await youtube.videos.update({
    part: ['status'],
    requestBody: { id: videoId, status: { privacyStatus, embeddable: s.embeddable, license: s.license, publicStatsViewable: s.publicStatsViewable, selfDeclaredMadeForKids: s.selfDeclaredMadeForKids ?? false } },
  });
}

// Sets a video's custom thumbnail (lib/cover.js makes the image). Works with
// the youtube.upload scope we already have — CONFIRMED FOR REAL (2026-09-30)
// on @zoharday. Only ever called right after uploadVideo for the same
// channel, whose token uploadVideo has already checked against
// EXPECTED_CHANNELS.
export async function setThumbnail(channel, videoId, imagePath) {
  const youtube = google.youtube({ version: 'v3', auth: getClient(channel) });
  await youtube.thumbnails.set({ videoId, media: { mimeType: 'image/jpeg', body: fs.createReadStream(imagePath) } });
}
