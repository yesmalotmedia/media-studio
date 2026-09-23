import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { defaultChannelForFile } from './rooms.js';

const DATA = path.join(process.cwd(), 'data');
const STORE = path.join(DATA, 'segments.json');

function ensure() {
  fs.mkdirSync(DATA, { recursive: true });
  if (!fs.existsSync(STORE)) fs.writeFileSync(STORE, JSON.stringify({ scans: {}, calibration: [], exportJob: null }, null, 2));
}

export function readStore() {
  ensure();
  try {
    const s = JSON.parse(fs.readFileSync(STORE, 'utf8'));
    if (!s.calibration) s.calibration = [];
    if (s.exportJob === undefined) s.exportJob = null;
    if (s.youtubeJob === undefined) s.youtubeJob = null;
    return s;
  } catch { return { scans: {}, calibration: [], exportJob: null, youtubeJob: null }; }
}

// Atomic write (temp file + rename) — see lib/ingestStore.js's write() for
// why: a plain writeFileSync that fails partway (disk full, crash) leaves
// this file at 0 bytes/corrupt instead of failing safely. This file holds
// every approval/rejection/trim/calibration ever recorded — CONFIRMED FOR
// REAL (2026-09-12) that a sibling store (data/ingest.json) was wiped this
// exact way by an ENOSPC crash; this one happened to survive that particular
// incident, but was equally exposed and deserves the same protection.
function writeStore(data) {
  ensure();
  const tmp = `${STORE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, STORE);
}

export function scanKey(folder) {
  return crypto.createHash('sha1').update(folder).digest('hex').slice(0, 12);
}

// Get the scan record for a folder (segments + progress)
export function getScan(folder) {
  const s = readStore();
  return s.scans[scanKey(folder)] || null;
}

// Initialize / reset a scan for a folder with a list of source files
export function initScan(folder, files) {
  const s = readStore();
  s.scans[scanKey(folder)] = {
    folder,
    startedAt: Date.now(),
    files: files.map((f) => ({ path: f, status: 'pending' })), // pending|scanning|done|error
    segments: [],
  };
  writeStore(s);
  return s.scans[scanKey(folder)];
}

// Like initScan, but additive instead of destructive — initScan wipes
// files+segments for the folder every call, which is fine for an on-demand
// full-folder rescan but wrong for the auto-ingest watcher (lib/ingest.js),
// which registers one newly-arrived file at a time and must never wipe out
// already-reviewed segments from other files already sitting in this same
// scan folder.
export function ensureScanFile(folder, filePath) {
  const s = readStore();
  const key = scanKey(folder);
  if (!s.scans[key]) {
    s.scans[key] = { folder, startedAt: Date.now(), files: [], segments: [] };
  }
  const scan = s.scans[key];
  if (!scan.files.find((f) => f.path === filePath)) {
    scan.files.push({ path: filePath, status: 'pending' });
  }
  writeStore(s);
  return scan;
}

// Mark a file's scan status
export function setFileStatus(folder, filePath, status, error = '') {
  const s = readStore();
  const scan = s.scans[scanKey(folder)];
  if (!scan) return;
  const f = scan.files.find((x) => x.path === filePath);
  if (f) { f.status = status; if (error) f.error = error; }
  writeStore(s);
}

// Append detected segments for a source file
export function addSegments(folder, filePath, segs) {
  const s = readStore();
  const scan = s.scans[scanKey(folder)];
  if (!scan) return;
  for (const seg of segs) {
    scan.segments.push({
      id: crypto.randomBytes(8).toString('hex'),
      source: filePath,
      sourceName: path.basename(filePath),
      start: seg.start,
      end: seg.end,
      // immutable snapshot of what the algorithm originally detected, kept
      // alongside the editable start/end so we can learn from the human's
      // correction once this segment is approved (see recordCorrection).
      detectedStart: seg.start,
      detectedEnd: seg.end,
      length: seg.length,
      confidence: seg.confidence,
      // suggested distribution destination, derived from the room name in
      // the filename (see lib/rooms.js) — a DEFAULT to save clicks in the
      // common case, not a rule blindly applied: rooms mix content from both
      // orgs, so the user confirms/overrides per segment before it's used
      // for anything (this only matters once YouTube/Spotify export exists).
      channel: defaultChannelForFile(path.basename(filePath)),
      status: 'detected', // detected|approved|rejected
      title: '', // picked from lib/titles.js candidates (see app/page.js title picker) or typed manually
      notes: '',
      series: '',
      titleRowId: null, // which titles.csv row was picked — excludes it from future candidates
      youtubeTitle: '', facebookTitle: '', spotifyTitle: '', whatsappTitle: '', websiteTitle: '', // per-platform titles from that same row, for when those integrations exist
    });
  }
  writeStore(s);
}

// Update one segment (status, start/end, title)
export function updateSegment(folder, segId, patch) {
  const s = readStore();
  const scan = s.scans[scanKey(folder)];
  if (!scan) return null;
  const seg = scan.segments.find((x) => x.id === segId);
  if (!seg) return null;
  Object.assign(seg, patch);
  if (patch.start != null || patch.end != null) {
    seg.length = +(seg.end - seg.start).toFixed(2);
  }
  writeStore(s);
  return seg;
}

// --- calibration feedback loop ---------------------------------------
// Every time a human approves a segment (possibly after trimming it in the
// editor), that's a ground-truth example: "the algorithm said X-Y, the real
// lesson is actually inP-outP". Recording these lets the detector correct
// its own systematic bias over time (see lib/detect.js applyBias / config.json
// detect.startBiasSec/endBiasSec) — this is what makes it "learn" from
// approvals: it's a running median correction, not a black box.
export function recordCorrection({ source, detectedStart, detectedEnd, approvedStart, approvedEnd }) {
  if (detectedStart == null || detectedEnd == null) return; // nothing to compare against
  const s = readStore();
  s.calibration.push({
    source, detectedStart, detectedEnd, approvedStart, approvedEnd,
    startDelta: +(approvedStart - detectedStart).toFixed(2),
    endDelta: +(approvedEnd - detectedEnd).toFixed(2),
    ts: Date.now(),
  });
  // keep the log bounded — old corrections matter less than recent ones
  if (s.calibration.length > 500) s.calibration = s.calibration.slice(-500);
  writeStore(s);
}

function median(nums) {
  if (!nums.length) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

// Median start/end correction over the most recent N approvals — robust to
// the occasional one-off outlier, unlike a plain average.
export function getBias(recentN = 30) {
  const s = readStore();
  const recent = s.calibration.slice(-recentN);
  return {
    n: recent.length,
    startBiasSec: +median(recent.map((c) => c.startDelta)).toFixed(2),
    endBiasSec: +median(recent.map((c) => c.endDelta)).toFixed(2),
  };
}

// --- batch export -------------------------------------------------------
// Approved segments across every scan that haven't been exported yet (or
// whose last export failed). Returns {folder, seg} pairs since export needs
// the owning folder to persist status back via updateSegment.
export function listApprovedForExport() {
  const s = readStore();
  const out = [];
  for (const scan of Object.values(s.scans)) {
    for (const seg of scan.segments) {
      if (seg.status === 'approved' && seg.exportStatus !== 'done') {
        out.push({ folder: scan.folder, seg });
      }
    }
  }
  return out;
}

export function getExportJob() {
  return readStore().exportJob;
}

export function setExportJob(patch) {
  const s = readStore();
  s.exportJob = patch === null ? null : { ...(s.exportJob || {}), ...patch };
  writeStore(s);
  return s.exportJob;
}

// Exported-but-not-yet-uploaded segments, optionally restricted to a single
// calendar date's exports (YYYY-MM-DD, matched against exportedAt) — see
// app/api/youtube-upload/route.js. The date filter exists specifically so a
// manual "catch up" upload run only touches today's batch, never the older
// test exports (2026-09-02/03) that were made before uploading existed and
// were never meant to go out publicly.
export function listExportedForUpload({ date } = {}) {
  const s = readStore();
  const out = [];
  for (const scan of Object.values(s.scans)) {
    for (const seg of scan.segments) {
      if (seg.exportStatus !== 'done' || seg.uploadStatus === 'done') continue;
      if (!seg.channel || seg.channel === 'internal') continue; // no channel = pre-dates the channel field entirely (old test exports) — never auto-upload those
      if (date) {
        const segDate = seg.exportedAt ? new Date(seg.exportedAt).toISOString().slice(0, 10) : null;
        if (segDate !== date) continue;
      }
      out.push({ folder: scan.folder, seg });
    }
  }
  return out;
}

export function getYoutubeJob() {
  return readStore().youtubeJob;
}

export function setYoutubeJob(patch) {
  const s = readStore();
  s.youtubeJob = patch === null ? null : { ...(s.youtubeJob || {}), ...patch };
  writeStore(s);
  return s.youtubeJob;
}

// The most recent successful uploads, across every scan — CONFIRMED FOR REAL
// (2026-09-14): a segment row disappears from the main list the moment its
// export+upload finishes (by design, see visibleSegs in app/page.js — only
// still-actionable rows stay visible), which means there was never any
// on-screen confirmation of a successful upload, not even long enough to
// click the resulting YouTube link. This gives the UI a small persistent
// panel, independent of that list's own visibility rules, so "it worked, and
// here's the real link" stays on screen instead of vanishing the instant it
// becomes true.
export function listRecentUploads(limit = 5) {
  const s = readStore();
  const out = [];
  for (const scan of Object.values(s.scans)) {
    for (const seg of scan.segments) {
      if (seg.uploadStatus === 'done' && seg.uploadedAt) {
        out.push({ sourceName: seg.sourceName, title: seg.title, channel: seg.channel, youtubeUrl: seg.youtubeUrl, uploadedAt: seg.uploadedAt });
      }
    }
  }
  out.sort((a, b) => b.uploadedAt - a.uploadedAt);
  return out.slice(0, limit);
}
