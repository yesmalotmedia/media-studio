// Manual "catch up" upload — for segments that finished exporting BEFORE the
// automatic per-video upload (app/api/export/route.js) existed, so nothing
// uploaded them automatically. Restricted to a single calendar date's
// exports (default: today) specifically so this never touches the older
// test exports from 2026-09-02/03, which predate uploading entirely and
// were never meant to go out publicly. See lib/store.js listExportedForUpload.
import fs from 'node:fs';
import { listExportedForUpload, updateSegment, getYoutubeJob, setYoutubeJob, listRecentUploads, listFailedUploads, listHeldLessons, getScan } from '../../../lib/store.js';
import { uploadOrHold, distributeSegment } from '../../../lib/distribute.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 3600;

function fmtHMS(t) {
  t = Math.max(0, Math.round(t));
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), sec = t % 60;
  return [h, m, sec].map((n) => String(n).padStart(2, '0')).join('-');
}

async function runUpload(date) {
  const items = listExportedForUpload({ date });
  setYoutubeJob({ running: true, startedAt: Date.now(), date, total: items.length, done: 0, current: null, errors: [] });

  for (const { folder, seg } of items) {
    setYoutubeJob({ current: `${seg.sourceName} ${fmtHMS(seg.start)}` });
    try {
      await uploadOrHold(folder, { ...seg, youtubeTitle: seg.youtubeTitle || seg.title || `${seg.sourceName.replace(/\.[^.]+$/, '')} ${fmtHMS(seg.start)}` }, seg.exportPath);
    } catch (e) {
      updateSegment(folder, seg.id, { uploadStatus: 'error', uploadError: String(e.message || e) });
      const job = getYoutubeJob();
      setYoutubeJob({ errors: [...(job?.errors || []), { id: seg.id, source: seg.sourceName, error: String(e.message || e) }] });
    }
    const job = getYoutubeJob();
    setYoutubeJob({ done: (job?.done || 0) + 1 });
  }
  setYoutubeJob({ running: false, current: null });
}

// One failed upload from the red "העלאות שנכשלו" panel (app/page.js):
// retry = upload again if the exported file is still on disk, otherwise send
// the segment back to the export queue (re-cut + upload on the next export);
// dismiss = take it off the panel without uploading (e.g. it was uploaded by
// hand).
async function handleFailure({ folder, id, action }) {
  const seg = getScan(folder)?.segments.find((x) => x.id === id);
  // a lesson held back for order (lib/distribute.js): "העלה בכל זאת" — e.g. its
  // predecessor was genuinely skipped. The override sticks, so site + podcast follow too.
  if (action === 'release' && seg?.uploadStatus === 'held') {
    updateSegment(folder, id, { uploadStatus: 'uploading', orderOverride: true });
    distributeSegment(folder, { ...seg, orderOverride: true }, seg.exportPath)
      .catch((e) => updateSegment(folder, id, { uploadStatus: 'error', uploadError: String(e.message || e) }));
    return Response.json({ ok: true, releasing: true });
  }
  if (!seg || seg.uploadStatus !== 'error') return Response.json({ error: 'not a failed upload' }, { status: 404 });
  if (action === 'dismiss') {
    updateSegment(folder, id, { uploadStatus: 'dismissed', previousUploadError: seg.uploadError, uploadError: '' });
    return Response.json({ ok: true, dismissed: true });
  }
  if (seg.exportPath && fs.existsSync(seg.exportPath)) {
    updateSegment(folder, id, { uploadStatus: 'uploading', uploadError: '' });
    (async () => {
      try {
        await uploadOrHold(folder, seg, seg.exportPath);
      } catch (e) {
        updateSegment(folder, id, { uploadStatus: 'error', uploadError: String(e.message || e) });
      }
    })();
    return Response.json({ ok: true, retrying: true });
  }
  updateSegment(folder, id, { exportStatus: null, exportPath: null, uploadStatus: null, previousUploadError: seg.uploadError, uploadError: '' });
  return Response.json({ ok: true, requeued: true });
}

export async function POST(req) {
  const body = await req.json().catch(() => ({}));
  if (body.failure) return handleFailure(body.failure);
  const job = getYoutubeJob();
  if (job?.running) return Response.json({ error: 'upload already running' }, { status: 409 });
  const { date } = body;
  const targetDate = date || new Date().toISOString().slice(0, 10);
  const items = listExportedForUpload({ date: targetDate });
  if (!items.length) return Response.json({ ok: true, started: false, total: 0, date: targetDate });
  runUpload(targetDate).catch((e) => { console.error('youtube upload error', e); setYoutubeJob({ running: false }); });
  return Response.json({ ok: true, started: true, total: items.length, date: targetDate });
}

export async function GET() {
  const today = new Date().toISOString().slice(0, 10);
  return Response.json({
    job: getYoutubeJob(),
    pendingToday: listExportedForUpload({ date: today }).length,
    recentUploads: listRecentUploads(),
    failedUploads: listFailedUploads(),
    heldLessons: listHeldLessons(),
  });
}
