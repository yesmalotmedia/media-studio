import fs from 'node:fs';
import { listVideos, loadConfig } from '../../../lib/config.js';
import { detectSegments } from '../../../lib/detect.js';
import { initScan, setFileStatus, addSegments, getScan } from '../../../lib/store.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 3600;

// Multi-file folders sometimes have a raw still being copied in over the
// network at the moment a scan starts (huge files, 10GB+, take a while to
// land on \\Servermedia). Confirmed on real data (2026-09-03): a file that
// failed with ffmpeg "No such file or directory" probed fine seconds later
// once the copy finished — a transient race, not a missing/corrupt file. So
// retry a failing file a few times with a delay before giving up on it,
// instead of requiring a manual full re-scan of the whole folder.
async function withRetry(fn, { retries = 3, delayMs = 20000 } = {}) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (i < retries) await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw lastErr;
}

async function runScan(folder) {
  const cfg = loadConfig();
  const d = cfg.detect || {};
  const vids = listVideos(folder);
  initScan(folder, vids.map((v) => v.path));
  for (const v of vids) {
    setFileStatus(folder, v.path, 'scanning');
    try {
      const segs = await withRetry(() => detectSegments(v.path, {
        bridgeSec: d.bridgeSec ?? 30,
        minRunSec: d.minRunSec ?? 90,
        pad: d.pad ?? 1.0,
        openFraction: d.openFraction ?? 0.5,
        continueFraction: d.continueFraction ?? 0.15,
        minSpeechRunSec: d.minSpeechRunSec ?? 3,
        startBiasSec: d.startBiasSec ?? 0,
        endBiasSec: d.endBiasSec ?? 0,
      }));
      addSegments(folder, v.path, segs);
      setFileStatus(folder, v.path, 'done');
    } catch (e) {
      setFileStatus(folder, v.path, 'error', String(e.message || e));
    }
  }
}

export async function POST(req) {
  const { folder: bodyFolder } = await req.json().catch(() => ({}));
  const folder = bodyFolder || loadConfig().source_folder;
  if (!folder) return Response.json({ error: 'no folder' }, { status: 400 });

  // fire and forget — client polls /api/segments
  runScan(folder).catch((e) => console.error('scan error', e));
  return Response.json({ ok: true, started: true, folder });
}

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const folder = searchParams.get('folder') || loadConfig().source_folder;
  const scan = getScan(folder);
  if (scan) {
    // Drop segments whose source file no longer exists — CONFIRMED FOR REAL
    // (2026-09-06): a manually-scanned folder (e.g. "test") has no cleanup at
    // all, so a segment whose raw the user deleted long ago (after already
    // approving it) just sat in the review list forever. This is a display
    // filter only — nothing is removed from the store, so it's harmless if a
    // slow/flaky UNC read momentarily reports a real file as missing.
    scan.segments = scan.segments.filter((s) => fs.existsSync(s.source));
    // add encoded source id so the client can build thumb/media URLs
    const { encodePath } = await import('../../../lib/config.js');
    scan.segments = scan.segments.map((s) => ({ ...s, sourceId: encodePath(s.source) }));
  }
  return Response.json({ folder, scan });
}
