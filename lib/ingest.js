// Auto-ingest watcher: polls \\Servermedia\הקלטות for new camera recordings,
// waits for each one to actually finish recording, copies it (never deletes
// the source) into a local folder, then runs the exact same VAD detection
// used everywhere else in the app — so new lessons show up for review
// automatically instead of requiring a manual "סרוק תיקייה" click.
//
// Real-world recording pattern this is built against (confirmed against the
// actual \\Servermedia\הקלטות folder, not guessed):
//   - 3 cameras, one file each, named like:
//     "2026-09-06 06-00-00 - פנסיונרים.mp4"
//     "2026-09-06 06-00-02 - בית מדרש ישן.mp4"
//     "2026-09-06 06-00-04 -מבקשי פניך.mp4"
//   - CONFIRMED BY MEASUREMENT: a file actively being recorded does NOT get
//     its mtime updated in real time (checked a live-recording file, mtime
//     was stale) — so completion is judged purely by SIZE STABILITY across
//     polls (unchanged size across several consecutive checks = not
//     currently being written to), never by a clock/schedule. An earlier
//     version of this gated on fixed daily session boundaries the user
//     described (06:00/13:15/19:45) — the user explicitly asked (2026-09-06)
//     to drop that: real recordings restart irregularly (observed multiple
//     restarts within one nominal session on a single day) and the source
//     files can be REPLACED/DELETED by the recording system within as little
//     as ~30 minutes of a new one starting (confirmed: files from a 06:00 and
//     a 13:15 batch both vanished from the share within an hour). So polling
//     is now frequent (see pollIntervalSec) and reacts only to "is this file
//     still growing", to minimize the window in which a finished file could
//     disappear before we copy it.
//   - Older, manually-named files (e.g. "זוהר עיון 4-9.mp4") sit in the SAME
//     root folder — they don't match the fixed pattern below, so the watcher
//     naturally ignores them; no folder-based filtering needed.

import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from './config.js';
import { robustCopy } from './ff.js';
import { detectSegments } from './detect.js';
import { ensureScanFile, setFileStatus, addSegments, getScan } from './store.js';
import { getIngestFile, upsertIngestFile, listIngestFiles } from './ingestStore.js';

const FILENAME_RE = /^(\d{4})-(\d{2})-(\d{2}) (\d{2})-(\d{2})-(\d{2}) ?-\s?(.+)\.mp4$/i;

const DEFAULTS = {
  enabled: true,
  watchFolder: '\\\\Servermedia\\הקלטות',
  localFolder: 'data\\raw',
  // Frequent by design: real files were observed to disappear within ~30min
  // of being superseded, so detection latency (roughly pollIntervalSec *
  // (stableChecksRequired + 1)) needs to stay well under that.
  pollIntervalSec: 60,
  stableChecksRequired: 2,
  // 'YYYY-MM-DD' or null. The user explicitly asked to only auto-ingest
  // going forward, not the pre-existing backlog already sitting in the
  // folder (11 finished sessions, ~100GB, as of 2026-09-06) — files dated
  // before this are ignored entirely, left for manual scanning if ever
  // wanted. Plain string comparison works since the format is zero-padded.
  minDate: null,
};

function cfgIngest() {
  return { ...DEFAULTS, ...(loadConfig().ingest || {}) };
}

function resolveLocalFolder(cfg) {
  return path.isAbsolute(cfg.localFolder) ? cfg.localFolder : path.join(process.cwd(), cfg.localFolder);
}

// A file left at 'copying' or 'scanning' status is only ever valid while
// SOME live process is actually in the middle of that async work — nothing
// should ever observe it in that state otherwise. CONFIRMED FOR REAL
// (2026-09-08): a dev-server restart (or crash) while a copy was in flight
// left exactly that — a file frozen at 'copying' forever after, because that
// status is in poll()'s skip-list (by design, so a live copy isn't
// double-started), so a fresh process just left it untouched permanently. At
// the moment THIS function runs (watcher startup, before any poll has run),
// nothing in this process is doing anything yet, so any record already in
// one of those states is unconditionally stale — reset it to re-enter the
// normal watching flow (lastSize -1 forces stableCount back to 0, so it
// re-earns stability from scratch rather than assuming the old size is
// final).
function resetStuckIngests() {
  for (const [srcPath, state] of Object.entries(listIngestFiles())) {
    if (state.status === 'copying' || state.status === 'scanning') {
      console.warn('[ingest] found stuck', state.status, 'from a previous run, resetting:', path.basename(srcPath));
      upsertIngestFile(srcPath, { status: 'watching', stableCount: 0, lastSize: -1, missingSince: null });
    }
  }
}

let started = false;
let timer = null;

export function startIngestWatcher() {
  if (started) return; // guard against double-init (Next dev can re-run register())
  started = true;
  const cfg = cfgIngest();
  if (!cfg.enabled) {
    console.log('[ingest] disabled in config.json (ingest.enabled=false)');
    return;
  }
  resetStuckIngests();
  const intervalMs = cfg.pollIntervalSec * 1000;
  console.log(`[ingest] watcher starting — watching ${cfg.watchFolder}, polling every ${cfg.pollIntervalSec}s`);
  const tick = () => poll().catch((e) => console.error('[ingest] poll error', e));
  tick();
  timer = setInterval(tick, intervalMs);
}

export async function poll() {
  const cfg = cfgIngest();
  if (!cfg.enabled) return;
  const watchFolder = cfg.watchFolder;
  const localFolder = resolveLocalFolder(cfg);

  if (!fs.existsSync(watchFolder)) {
    console.warn('[ingest] watch folder not reachable, skipping this poll:', watchFolder);
    return;
  }
  fs.mkdirSync(localFolder, { recursive: true });

  let entries;
  try {
    entries = fs.readdirSync(watchFolder, { withFileTypes: true }).filter((e) => e.isFile());
  } catch (e) {
    console.warn('[ingest] could not list watch folder this poll:', e.message);
    return;
  }

  const presentPaths = new Set();

  for (const entry of entries) {
    const m = entry.name.match(FILENAME_RE);
    if (!m) continue; // not a new-pattern camera file — leave old/manual files untouched
    const srcPath = path.join(watchFolder, entry.name);
    presentPaths.add(srcPath);
    const existing = getIngestFile(srcPath);
    // 'deleted' = cleanupExported already finished with this file (every
    // segment approved+exported, local copy removed) — CONFIRMED FOR REAL
    // (2026-09-08): this status was missing from the skip-list, so the next
    // poll re-copied an already-fully-processed file right as an export job
    // was still reading its local copy, hitting a real file-lock (EPERM).
    if (existing && ['copied', 'copying', 'scanning', 'gone', 'deleted'].includes(existing.status)) continue;
    // 'error' is retried, not permanent — CONFIRMED for real (2026-09-06): a
    // file that failed to copy (robocopy exited 16) copied fine seconds
    // later when tried again by hand. A one-off transient failure (network
    // hiccup, brief lock during a rotation) shouldn't blacklist a file
    // forever — only give up after several attempts.
    if (existing?.status === 'error') {
      const errorCount = existing.errorCount || 1;
      if (errorCount >= 5) continue; // genuinely stuck (or the source really is gone) — stop trying
      const cooldownMs = 2 * cfg.pollIntervalSec * 1000;
      if (Date.now() - (existing.lastCheckedAt || 0) < cooldownMs) continue; // not yet, give it a beat
    }

    const [, y, mo, d] = m;
    if (cfg.minDate && `${y}-${mo}-${d}` < cfg.minDate) continue; // pre-existing backlog — explicitly excluded

    let size;
    try {
      size = fs.statSync(srcPath).size;
    } catch {
      continue; // transient stat failure (e.g. mid-write on a flaky share) — retry next poll
    }

    // "Done" is decided purely by activity, never a clock: unchanged size
    // across stableChecksRequired consecutive polls means nothing is
    // currently writing to it. No schedule gate — see module comment for why.
    const prevSize = existing?.lastSize ?? -1;
    const prevStable = existing?.stableCount ?? 0;
    const stableCount = (size === prevSize && size > 0) ? prevStable + 1 : 0;
    upsertIngestFile(srcPath, { status: 'watching', lastSize: size, stableCount, lastCheckedAt: Date.now(), missingSince: null });

    if (stableCount >= cfg.stableChecksRequired) {
      await ingestOne(srcPath, entry.name, localFolder);
      // CONFIRMED FOR REAL (2026-09-06): several robocopy child processes
      // fired back-to-back (e.g. 6 files all becoming ready in the same poll
      // right at server startup) raced each other over the shared console
      // codepage set by `chcp 65001`, causing some to misparse the Hebrew
      // filename argument as command-line switches ("Invalid Parameter").
      // The error-retry logic above already recovers from this on the next
      // poll, but spacing out consecutive copies avoids the race outright.
      await new Promise((r) => setTimeout(r, 1000));
    }
  }

  // A tracked file that's no longer in the directory listing at all is a
  // different case from a stat() failure mid-loop (which only happens in a
  // tiny race window right after a successful readdir) — CONFIRMED FOR REAL
  // (2026-09-06): files disappear from the share entirely (replaced/deleted
  // by the recording system) while still sitting in our store as
  // 'watching' or 'error', with nothing updating them ever again since the
  // main loop above only touches files readdir still returns. Mark them
  // 'gone' (terminal, hidden by the UI filter) once absent for two
  // consecutive polls, instead of leaving stale status forever.
  for (const [srcPath, state] of Object.entries(listIngestFiles())) {
    if (presentPaths.has(srcPath)) continue;
    if (['copied', 'gone'].includes(state.status)) continue;
    if (!path.dirname(srcPath).toLowerCase().includes(watchFolder.toLowerCase())) continue; // not from this watch folder
    if (state.missingSince) {
      if (Date.now() - state.missingSince > cfg.pollIntervalSec * 1000) {
        upsertIngestFile(srcPath, { status: 'gone' });
        console.log('[ingest] source no longer exists, giving up on', path.basename(srcPath));
      }
    } else {
      upsertIngestFile(srcPath, { missingSince: Date.now() });
    }
  }

  cleanupExported(localFolder);
}

async function ingestOne(srcPath, fileName, localFolder) {
  upsertIngestFile(srcPath, { status: 'copying' });
  console.log('[ingest] copying', fileName);
  try {
    const destPath = await robustCopy(srcPath, localFolder);
    const srcSize = fs.statSync(srcPath).size;
    const destSize = fs.statSync(destPath).size;
    if (srcSize !== destSize) {
      throw new Error(`size mismatch after copy: src=${srcSize} dest=${destSize}`);
    }

    upsertIngestFile(srcPath, { status: 'scanning', localPath: destPath });
    ensureScanFile(localFolder, destPath);
    setFileStatus(localFolder, destPath, 'scanning');

    const dd = loadConfig().detect || {};
    const segs = await detectSegments(destPath, {
      bridgeSec: dd.bridgeSec ?? 30,
      minRunSec: dd.minRunSec ?? 90,
      pad: dd.pad ?? 1.0,
      openFraction: dd.openFraction ?? 0.5,
      continueFraction: dd.continueFraction ?? 0.15,
      minSpeechRunSec: dd.minSpeechRunSec ?? 3,
      startBiasSec: dd.startBiasSec ?? 0,
      endBiasSec: dd.endBiasSec ?? 0,
    });
    addSegments(localFolder, destPath, segs);
    setFileStatus(localFolder, destPath, 'done');
    upsertIngestFile(srcPath, { status: 'copied', localPath: destPath, copiedAt: Date.now(), segmentCount: segs.length });
    console.log(`[ingest] done: ${fileName} → ${segs.length} segment(s) found`);
  } catch (e) {
    console.error('[ingest] failed for', fileName, e);
    const prevErrors = getIngestFile(srcPath)?.errorCount || 0;
    upsertIngestFile(srcPath, {
      status: 'error',
      error: String(e.message || e),
      errorCount: prevErrors + 1,
      lastCheckedAt: Date.now(), // drives the retry cooldown in poll()
    });
  }
}

// Delete a local raw copy once every segment sourced from it has reached a
// terminal state (approved+exported, or rejected). Only ever touches our own
// local copy (state.localPath) — never the original on \\Servermedia.
function cleanupExported(localFolder) {
  const scan = getScan(localFolder);
  if (!scan) return;
  const files = listIngestFiles();
  for (const [srcPath, state] of Object.entries(files)) {
    if (state.status !== 'copied' || !state.localPath) continue;
    const segsOfFile = scan.segments.filter((s) => s.source === state.localPath);
    if (segsOfFile.length === 0) continue; // nothing detected in it at all — leave alone, nothing to decide from
    const allDone = segsOfFile.every((s) => (s.status === 'approved' && s.exportStatus === 'done') || s.status === 'rejected');
    if (!allDone) continue;
    try {
      fs.rmSync(state.localPath, { force: true });
      upsertIngestFile(srcPath, { status: 'deleted', deletedAt: Date.now() });
      console.log('[ingest] cleaned up local copy of', path.basename(srcPath));
    } catch (e) {
      console.error('[ingest] cleanup failed for', srcPath, e.message);
    }
  }
}

export function stopIngestWatcher() {
  if (timer) clearInterval(timer);
  timer = null;
  started = false;
}

// exported for a quick offline sanity check (see scripts/ingest_selftest.mjs)
export const _internal = { FILENAME_RE };
