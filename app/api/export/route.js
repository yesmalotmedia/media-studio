import fs from 'node:fs';
import path from 'node:path';
import { loadConfig, isAudioFile } from '../../../lib/config.js';
import { cutSegment } from '../../../lib/ff.js';
import { computeHeadCrop } from '../../../lib/vision.js';
import { listApprovedForExport, updateSegment, getExportJob, setExportJob } from '../../../lib/store.js';
import { makeCover } from '../../../lib/cover.js';
import { uploadOrHold } from '../../../lib/distribute.js';
import { markSheetIf } from '../../../lib/sheetMarks.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 3600;

function safeName(s) {
  return String(s).replace(/[\\/:*?"<>|]/g, '_').trim();
}
function fmtHMS(t) {
  t = Math.max(0, Math.round(t));
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), sec = t % 60;
  return [h, m, sec].map((n) => String(n).padStart(2, '0')).join('-');
}

// Batch-export every approved-but-not-yet-exported segment: head-crop (fixed
// per lesson, see lib/vision.js) + echo reduction (Supertone Clear, see
// lib/dereverb.js) + cut + normalize (loudnorm) + fade in/out, into
// config.output_folder (default data/out). Both crop and de-reverb are
// calibrated against real shiurim with human review — see config.json ->
// crop/dereverb and data/crop_preview/, data/clear_test/.
async function runExport() {
  const items = listApprovedForExport();
  setExportJob({ running: true, startedAt: Date.now(), total: items.length, done: 0, current: null, errors: [] });
  const cfg = loadConfig();
  const outDir = cfg.output_folder || path.join(process.cwd(), 'data', 'out');
  fs.mkdirSync(outDir, { recursive: true });

  for (const { folder, seg } of items) {
    setExportJob({ current: `${seg.sourceName} ${fmtHMS(seg.start)}` });
    // tick "יוטיוב ערוך" (column G) as the lesson enters export — also takes the row
    // out of the title picker's candidates (lib/titles.js). Never blocks the export.
    if (seg.titleRowId != null || seg.title) updateSegment(folder, seg.id, await markSheetIf('edited', seg));
    try {
      // reuse a previously-computed crop for this segment (e.g. a retry
      // after a failed export) instead of re-running the ~5min detection
      // scan every time.
      const audioOnly = isAudioFile(seg.source);
      let crop = seg.cropRect || null;
      if (!crop && !audioOnly && cfg.crop?.enabled !== false) {
        const result = await computeHeadCrop(seg.source, seg.start, seg.end);
        if (result.ok) {
          crop = { x: result.x, y: result.y, w: result.w, h: result.h };
          updateSegment(folder, seg.id, { cropRect: crop, cropStats: { sampled: result.sampled, detected: result.detected } });
        } else {
          // no reliable face detections (different framing, camera off,
          // etc.) — export uncropped rather than fail the whole segment.
          updateSegment(folder, seg.id, { cropSkippedReason: result.reason });
        }
      }
      const base = safeName(seg.title || `${seg.sourceName.replace(/\.[^.]+$/, '')}__${fmtHMS(seg.start)}-${fmtHMS(seg.end)}`);
      const outPath = path.join(outDir, `${base}.mp4`);
      const dereverb = cfg.dereverb?.enabled !== false;
      // audio-only source (backup recorder): the video is the lesson's cover
      // image for its whole length — the same image that becomes its thumbnail
      // (user, 2026-10-15). Needs a series with a cover template and a title.
      let stillImage = null;
      if (audioOnly) {
        if (!seg.title || !seg.series) throw new Error('קובץ אודיו: צריך לבחור כותרת וסדרה לפני הייצוא (התמונה נבנית מהן)');
        stillImage = path.join(process.cwd(), 'data', 'covers', `${seg.id}.jpg`);
        await makeCover({ series: seg.series, title: seg.title }, stillImage);
      }
      await cutSegment(seg.source, seg.start, seg.end, outPath, { normalize: true, fade: true, crop, dereverb, stillImage });
      updateSegment(folder, seg.id, { exportStatus: 'done', exportPath: outPath, exportedAt: Date.now() });

      // upload immediately after this video finishes, not as a separate
      // batch phase at the end — see conversation 2026-09-07: a failure
      // uploading video N shouldn't hold back videos that already succeeded.
      // 'internal' segments (מבקשי פניך, see lib/rooms.js) are never
      // distributed publicly at all.
      if (seg.channel !== 'internal') {
        try {
          // upload + cover + playlist + site + podcast — or, for a Zohar lesson whose
          // predecessor isn't up yet, hold it (lib/distribute.js)
          await uploadOrHold(folder, { ...seg, youtubeTitle: seg.youtubeTitle || seg.title || `${seg.sourceName.replace(/\.[^.]+$/, '')} ${fmtHMS(seg.start)}` }, outPath);
        } catch (ue) {
          updateSegment(folder, seg.id, { uploadStatus: 'error', uploadError: String(ue.message || ue) });
        }
      }
    } catch (e) {
      updateSegment(folder, seg.id, { exportStatus: 'error', exportError: String(e.message || e) });
      const job = getExportJob();
      setExportJob({ errors: [...(job?.errors || []), { id: seg.id, source: seg.sourceName, error: String(e.message || e) }] });
    }
    const job = getExportJob();
    setExportJob({ done: (job?.done || 0) + 1 });
  }
  setExportJob({ running: false, current: null });
}

export async function POST() {
  const job = getExportJob();
  if (job?.running) return Response.json({ error: 'export already running' }, { status: 409 });
  const items = listApprovedForExport();
  if (!items.length) return Response.json({ ok: true, started: false, total: 0 });
  runExport().catch((e) => { console.error('export error', e); setExportJob({ running: false }); });
  return Response.json({ ok: true, started: true, total: items.length });
}

export async function GET() {
  return Response.json({ job: getExportJob(), pending: listApprovedForExport().length });
}
