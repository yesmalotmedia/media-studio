// Watches the studio's uploads for the moment a video is made PUBLIC (by hand,
// in YouTube Studio — uploads go up unlisted). Then:
//   - every channel (maalot + zohar): ticks column H ("יוטיוב הופץ") in the
//     titles sheet (user, 2026-10-19);
//   - maalot only: publishes the lesson on the website (lib/wordpress.js) and
//     ticks column P ("אתר הופץ") — agreed 2026-10-18 (option ג).
//
// Scope: uploaded by the studio on/after config.wordpress.since. Website posts
// skip videos shorter than minMinutes (the 1–3 minute vertical shorts keep
// being posted by hand by someone else).
// Runs inside the Next server, started from instrumentation.js next to the
// ingest watcher. Off unless config.json -> wordpress.enabled is true.
import { loadConfig } from './config.js';
import { readAllSegments, updateSegment } from './store.js';
import { videoStatuses } from './youtube.js';
import { postLesson, seriesRule } from './wordpress.js';
import { markSheet, SHEET_COLS, sheetMarkEnabled } from './sheetMarks.js';
import { releaseHeld } from './distribute.js';

const WP_DONE = ['done', 'exists', 'skipped-short', 'no-category', 'given-up'];
const cfgOf = () => ({ enabled: false, since: '2026-10-18', pollMinutes: 15, minMinutes: 5, ...(loadConfig().wordpress || {}) });

const needsWebsite = (seg) => seg.channel === 'maalot' && !WP_DONE.includes(seg.wpStatus);
// H is only ticked while config.json sheetMarks.youtube is on (off for the trial period, 2026-10-19)
const needsYoutubeMark = (seg) => sheetMarkEnabled('youtube') && !seg.ytSheetMarked && (seg.ytSheetErrorCount || 0) < 5;

async function handleWebsite(folder, seg, minutes, cfg) {
  if (minutes < cfg.minMinutes) { updateSegment(folder, seg.id, { wpStatus: 'skipped-short' }); return false; }
  if (!seriesRule(seg.series)) { updateSegment(folder, seg.id, { wpStatus: 'no-category', wpError: `series "${seg.series}" has no categories in data/wordpress/series-categories.json` }); return false; }
  try {
    const r = await postLesson(seg, { durationMin: minutes });
    updateSegment(folder, seg.id, { ...r, wpError: null });
    if (sheetMarkEnabled('website')) {
      try { await markSheet(seg, SHEET_COLS.website); updateSegment(folder, seg.id, { wpSheetMarked: true }); } catch (e) { updateSegment(folder, seg.id, { wpSheetError: String(e.message || e) }); }
    }
    console.log('[publish] website:', r.wpStatus, seg.title, r.wpUrl);
    return true;
  } catch (e) {
    const n = (seg.wpErrorCount || 0) + 1;
    updateSegment(folder, seg.id, { wpStatus: n >= 5 ? 'given-up' : 'error', wpError: String(e.message || e), wpErrorCount: n });
    console.error('[publish] website failed for', seg.title, e.message);
    return false;
  }
}

async function handleYoutubeMark(folder, seg) {
  try {
    await markSheet(seg, SHEET_COLS.youtube);
    updateSegment(folder, seg.id, { ytSheetMarked: true, ytPublicSeenAt: Date.now() });
  } catch (e) {
    updateSegment(folder, seg.id, { ytSheetError: String(e.message || e), ytSheetErrorCount: (seg.ytSheetErrorCount || 0) + 1 });
  }
}

export async function checkOnce() {
  const cfg = cfgOf();
  // Zohar lessons held back for order: out they go once their predecessor is up
  try { const n = await releaseHeld(); if (n) console.log(`[order] released ${n} held lesson(s)`); } catch (e) { console.error('[order] release failed', e.message); }
  const since = Date.parse(cfg.since);
  const todo = readAllSegments().filter(({ seg }) => ['maalot', 'zohar'].includes(seg.channel) && seg.uploadStatus === 'done' && seg.youtubeVideoId
    && (seg.uploadedAt || 0) >= since && (needsWebsite(seg) || needsYoutubeMark(seg)));
  const result = { checked: todo.length, posted: 0, marked: 0 };
  for (const channel of ['maalot', 'zohar']) {
    const mine = todo.filter(({ seg }) => seg.channel === channel);
    if (!mine.length) continue;
    const st = await videoStatuses(channel, mine.map(({ seg }) => seg.youtubeVideoId));
    for (const { folder, seg } of mine) {
      const v = st[seg.youtubeVideoId];
      if (!v || v.privacy !== 'public') continue; // not opened yet — check again next round
      if (needsYoutubeMark(seg)) { await handleYoutubeMark(folder, seg); result.marked++; }
      if (needsWebsite(seg) && await handleWebsite(folder, seg, v.durationSec / 60, cfg)) result.posted++;
    }
  }
  if (result.marked || result.posted) console.log(`[publish] round: ${result.marked} marked on YouTube (H), ${result.posted} posted to the website`);
  return result;
}

let timer = null;
export function startPublishWatcher() {
  if (timer) return;
  const cfg = cfgOf();
  if (!cfg.enabled) { console.log('[publish] disabled (config.json wordpress.enabled)'); return; }
  let busy = false;
  const tick = async () => { if (busy) return; busy = true; try { await checkOnce(); } catch (e) { console.error('[publish] check failed', e.message); } finally { busy = false; } };
  console.log(`[publish] watching for public videos every ${cfg.pollMinutes} min (since ${cfg.since})`);
  setTimeout(tick, 30_000);
  timer = setInterval(tick, cfg.pollMinutes * 60_000);
}
