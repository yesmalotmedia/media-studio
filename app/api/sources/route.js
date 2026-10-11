// Source sheets for one lesson — see lib/sources.js.
//   GET  ?folder&id         -> the link currently in column E of its row (so the
//                              UI can ask before replacing it)
//   POST multipart: folder, id, overwrite ('1' to replace an existing link),
//        files (one or more, in order) -> PDF -> Drive -> column E
import { loadConfig } from '../../../lib/config.js';
import { getScan, updateSegment } from '../../../lib/store.js';
import { findLessonRow, writeSourcesLink } from '../../../lib/sheetsSync.js';
import { buildPdf, uploadPdfToDrive, previewUrl, linkAccess } from '../../../lib/sources.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function lessonOf(folder, id) {
  const seg = getScan(folder)?.segments.find((x) => x.id === id);
  if (!seg) throw Object.assign(new Error('segment not found'), { status: 404 });
  if (!seg.title || !seg.series) throw Object.assign(new Error('pick a title for this lesson first (column B/C)'), { status: 400 });
  return seg;
}

const sheetRef = (seg) => {
  const { spreadsheetId, gid } = loadConfig().titles || {};
  return { spreadsheetId, gid, titleRowId: seg.titleRowId, series: seg.series, title: seg.title };
};

export async function GET(req) {
  try {
    const u = new URL(req.url);
    const seg = lessonOf(u.searchParams.get('folder'), u.searchParams.get('id'));
    const { row, value } = await findLessonRow(sheetRef(seg));
    return Response.json({ row, existing: value.trim() || null });
  } catch (e) {
    return Response.json({ error: String(e.message || e) }, { status: e.status || 500 });
  }
}

export async function POST(req) {
  try {
    const form = await req.formData();
    const folder = form.get('folder'), id = form.get('id');
    const seg = lessonOf(folder, id);
    const files = await Promise.all(form.getAll('files').map(async (f) => ({ name: f.name, type: f.type, bytes: Buffer.from(await f.arrayBuffer()) })));
    if (!files.length) return Response.json({ error: 'no files' }, { status: 400 });

    const ref = sheetRef(seg);
    const { row, value } = await findLessonRow(ref);
    if (value.trim() && form.get('overwrite') !== '1') {
      return Response.json({ needsConfirm: true, existing: value.trim(), row }, { status: 409 });
    }

    const pdf = await buildPdf(files);
    const name = `${seg.title.replace(/[\\/:*?"<>|]/g, '-')}.pdf`;
    const fileId = await uploadPdfToDrive(pdf, name, loadConfig().sources.driveFolderId);
    const url = previewUrl(fileId);
    await writeSourcesLink({ ...ref, row, url });
    updateSegment(folder, id, { sourcesUrl: url, sourcesAt: Date.now(), sourcesPages: files.length });
    let access = 'unknown';
    try { access = await linkAccess(fileId); } catch {}
    return Response.json({ ok: true, url, row, name, files: files.length, bytes: pdf.length, access });
  } catch (e) {
    return Response.json({ error: String(e.message || e) }, { status: e.status || 500 });
  }
}
