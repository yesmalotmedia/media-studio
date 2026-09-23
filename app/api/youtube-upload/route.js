// Manual "catch up" upload — for segments that finished exporting BEFORE the
// automatic per-video upload (app/api/export/route.js) existed, so nothing
// uploaded them automatically. Restricted to a single calendar date's
// exports (default: today) specifically so this never touches the older
// test exports from 2026-09-02/03, which predate uploading entirely and
// were never meant to go out publicly. See lib/store.js listExportedForUpload.
import { listExportedForUpload, updateSegment, getYoutubeJob, setYoutubeJob, listRecentUploads } from '../../../lib/store.js';
import { uploadVideo } from '../../../lib/youtube.js';
import { buildDescription } from '../../../lib/rooms.js';

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
      const title = seg.youtubeTitle || seg.title || `${seg.sourceName.replace(/\.[^.]+$/, '')} ${fmtHMS(seg.start)}`;
      const { videoId, url } = await uploadVideo(seg.channel, seg.exportPath, { title, description: buildDescription(seg) });
      updateSegment(folder, seg.id, { uploadStatus: 'done', youtubeVideoId: videoId, youtubeUrl: url, uploadedAt: Date.now() });
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

export async function POST(req) {
  const job = getYoutubeJob();
  if (job?.running) return Response.json({ error: 'upload already running' }, { status: 409 });
  const { date } = await req.json().catch(() => ({}));
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
  });
}
