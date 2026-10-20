// Everything after a lesson's video file exists: YouTube upload -> cover ->
// series playlist -> Zohar site -> podcast. Shared by the export job, the manual
// catch-up upload and the release of held lessons, so they can't drift apart.
//
// Zohar lessons go out IN ORDER (user, 2026-10-19): a lesson whose predecessor
// isn't on YouTube yet — e.g. ויקרא טז א exported before טו ב, CONFIRMED
// 2026-10-15 (טו came later from backup audio) — is a fault, so it is HELD
// (uploadStatus 'held', exported file kept) and goes out automatically, in
// order, once the missing lesson is up (releaseHeld, run every few minutes by
// lib/publishWatch.js). A held lesson can also be released by hand from the
// studio ("העלה בכל זאת" — e.g. when a lesson was genuinely skipped).
import fs from 'node:fs';
import { updateSegment, readAllSegments } from './store.js';
import { uploadVideo, addToSeriesPlaylist, addToBookPlaylist, getClientFor } from './youtube.js';
import { buildYoutubeDescription, zoharKind } from './description.js';
import { applyCover } from './cover.js';
import { publishSegment } from './podcast.js';
import { publishToSite, parseDafPagePar } from './wix.js';
import { google } from 'googleapis';

const GEM = { א: 1, ב: 2, ג: 3, ד: 4, ה: 5, ו: 6, ז: 7, ח: 8, ט: 9, י: 10, כ: 20, ך: 20, ל: 30, מ: 40, ם: 40, נ: 50, ן: 50, ס: 60, ע: 70, פ: 80, ף: 80, צ: 90, ץ: 90, ק: 100, ר: 200, ש: 300, ת: 400 };
const amudNo = (loc) => [...String(loc.daf || '').replace(/[^א-ת]/g, '')].reduce((s, ch) => s + (GEM[ch] || 0), 0) * 2 + (loc.page === 'ב' ? 1 : 0);
const parshaOf = (s) => (String(s || '').match(/פרשת\s+([^|]+?)\s*(\||$)/) || [])[1]?.trim() || '';
const kindOfTitle = (t) => (/שיעור קצר|שיעור פשט/.test(t) ? 'short' : /שיעור עיון/.test(t) ? 'iyun' : null);

// What's already on the Zohar channel (incl. unlisted — the owner's uploads list), cached briefly.
let ytCache = null;
async function zoharVideos() {
  if (ytCache && Date.now() - ytCache.at < 5 * 60_000) return ytCache.list;
  const yt = google.youtube({ version: 'v3', auth: getClientFor('zohar') });
  const ch = await yt.channels.list({ part: ['contentDetails'], mine: true });
  const uploads = ch.data.items[0].contentDetails.relatedPlaylists.uploads;
  const list = [];
  let pageToken;
  for (let i = 0; i < 4; i++) { // the last ~200 uploads are plenty to find a predecessor
    const r = await yt.playlistItems.list({ part: ['snippet'], playlistId: uploads, maxResults: 50, pageToken });
    for (const it of r.data.items) {
      const t = it.snippet.title, loc = parseDafPagePar(t);
      if (loc) list.push({ videoId: it.snippet.resourceId.videoId, kind: kindOfTitle(t), parsha: parshaOf(t), loc });
    }
    pageToken = r.data.nextPageToken;
    if (!pageToken) break;
  }
  ytCache = { at: Date.now(), list };
  return list;
}
const noteUploaded = (seg, videoId) => { // keep the cache right without refetching
  const loc = parseDafPagePar(seg.title);
  if (ytCache && loc) ytCache.list.unshift({ videoId, kind: zoharKind(seg.series), parsha: parshaOf(seg.series), loc });
};

// { ok } or { ok:false, reason } — is the lesson that should precede this one already on YouTube?
export async function zoharOrderCheck(seg) {
  const kind = seg.channel === 'zohar' ? zoharKind(seg.series) : null;
  const loc = parseDafPagePar(seg.title);
  if (!kind || !loc || seg.orderOverride) return { ok: true };
  const parsha = parshaOf(seg.series);
  const same = (await zoharVideos()).filter((v) => v.kind === kind && v.parsha === parsha && v.videoId !== seg.youtubeVideoId);
  if (!same.length) return { ok: true }; // first lesson of the parsha — nothing to wait for
  const n = amudNo(loc), par = loc.par || 0;
  const has = (pred) => same.some((v) => pred(amudNo(v.loc), v.loc.par || 0));
  if (has((m, p) => m === n && p === par)) return { ok: true }; // already there (re-upload)
  let ok;
  if (kind === 'short') ok = has((m) => m === n - 1);
  else ok = par > 1 ? has((m, p) => m === n && p === par - 1) : has((m) => m === n - 1);
  if (ok) return { ok: true };
  const want = kind === 'short' || par <= 1 ? 'שיעור על העמוד הקודם' : `#${par - 1} באותו עמוד`;
  return { ok: false, reason: `ממתין ל${want} — הוא עוד לא ביוטיוב` };
}

// Upload + everything after it. Throws only if the YouTube upload itself fails.
export async function distributeSegment(folder, seg, filePath) {
  const title = seg.youtubeTitle || seg.title || seg.sourceName;
  const { videoId, url } = await uploadVideo(seg.channel, filePath, { title, description: await buildYoutubeDescription(seg) });
  updateSegment(folder, seg.id, { uploadStatus: 'done', youtubeVideoId: videoId, youtubeUrl: url, uploadedAt: Date.now(), heldReason: null });
  noteUploaded(seg, videoId);
  updateSegment(folder, seg.id, await applyCover(seg, videoId));
  updateSegment(folder, seg.id, await addToSeriesPlaylist(seg.channel, videoId, seg.series));
  updateSegment(folder, seg.id, await addToBookPlaylist(seg.channel, videoId, seg.series, seg.title)); // נ"ך: also the book's own playlist
  updateSegment(folder, seg.id, await publishToSite(seg, videoId));
  updateSegment(folder, seg.id, await publishSegment({ ...seg, exportPath: filePath }));
  return videoId;
}

// The export job's entry point: hold a Zohar lesson that's out of order, else distribute.
export async function uploadOrHold(folder, seg, filePath) {
  const order = await zoharOrderCheck(seg);
  if (!order.ok) {
    updateSegment(folder, seg.id, { uploadStatus: 'held', heldReason: order.reason, heldSince: seg.heldSince || Date.now() });
    console.log('[order] held:', seg.title, '—', order.reason);
    return null;
  }
  return distributeSegment(folder, seg, filePath);
}

// Held lessons whose predecessor is now up go out, lowest amud first (one may unblock the next).
export async function releaseHeld() {
  const held = () => readAllSegments().filter(({ seg }) => seg.uploadStatus === 'held');
  let released = 0;
  for (let progress = true; progress;) {
    progress = false;
    const list = held().sort((a, b) => (amudNo(parseDafPagePar(a.seg.title) || {}) * 100 + (parseDafPagePar(a.seg.title)?.par || 0)) - (amudNo(parseDafPagePar(b.seg.title) || {}) * 100 + (parseDafPagePar(b.seg.title)?.par || 0)));
    for (const { folder, seg } of list) {
      if (!(await zoharOrderCheck(seg)).ok) continue;
      if (!seg.exportPath || !fs.existsSync(seg.exportPath)) { updateSegment(folder, seg.id, { uploadStatus: 'error', uploadError: 'held lesson: exported file is gone' }); continue; }
      updateSegment(folder, seg.id, { uploadStatus: 'uploading' });
      try { await distributeSegment(folder, seg, seg.exportPath); released++; progress = true; console.log('[order] released:', seg.title); } catch (e) { updateSegment(folder, seg.id, { uploadStatus: 'error', uploadError: String(e.message || e) }); }
      break; // re-read: this upload may unblock the next one
    }
  }
  // site rows held on their own (lib/wix.js) — e.g. the video went up by hand
  for (const { folder, seg } of readAllSegments().filter(({ seg }) => seg.wixStatus === 'held' && seg.youtubeVideoId)) {
    const r = await publishToSite(seg, seg.youtubeVideoId);
    if (r.wixStatus !== 'held') updateSegment(folder, seg.id, r);
  }
  return released;
}
