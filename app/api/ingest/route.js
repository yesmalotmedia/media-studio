// Status/debug endpoint for the auto-ingest watcher (lib/ingest.js) — lets the
// UI (or us, while verifying) see what it's tracking without reading
// data/ingest.json by hand. Also exposes `folder` (the local raw folder) so
// the client can fetch /api/scan?folder=<that> to show auto-ingested segments
// alongside the manually-scanned ones.
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../../../lib/config.js';
import { getIngestFile, listIngestFiles, upsertIngestFile } from '../../../lib/ingestStore.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function resolveLocalFolder(cfg) {
  const lf = cfg.localFolder || 'data\\raw';
  return path.isAbsolute(lf) ? lf : path.join(process.cwd(), lf);
}

export async function GET() {
  const cfg = loadConfig().ingest || {};
  const folder = resolveLocalFolder(cfg);
  // surfaced so the UI can warn before a repeat of 2026-09-12 (disk filled
  // completely, crashed the server, corrupted data/ingest.json) — see
  // lib/ingest.js's minFreeSpaceGB guard, which silently pauses new copies
  // below this floor; silent-in-the-logs isn't good enough on its own.
  let freeSpaceGB = null;
  try {
    const st = fs.statfsSync(folder);
    freeSpaceGB = +((st.bavail * st.bsize) / 1e9).toFixed(1);
  } catch { /* older Node without fs.statfs, or folder not created yet — leave null */ }
  return Response.json({
    folder, enabled: cfg.enabled !== false, files: listIngestFiles(),
    freeSpaceGB, minFreeSpaceGB: cfg.minFreeSpaceGB ?? 40,
  });
}

// Manual trigger to re-check one file immediately (e.g. after fixing an
// error state) instead of waiting for the next poll interval.
export async function POST(req) {
  const { poll } = await import('../../../lib/ingest.js');
  await poll();
  return Response.json({ ok: true });
}

// Manual deletion of one local raw copy — for the case cleanupExported()
// (lib/ingest.js) deliberately never handles on its own: a file that was
// fully scanned but produced ZERO detected segments (e.g. "מבקשי פניך" — an
// internal room whose audio often has no speech loud enough to trigger the
// VAD at all). There's nothing to review there, so automatic cleanup could
// safely delete it, but per the user (2026-09-08): don't auto-delete
// anything — deletion only happens once THEY explicitly mark it. This is
// that explicit mark. Only ever removes our own local copy (state.localPath,
// under data/raw) — never touches the original on \\Servermedia, same rule
// as cleanupExported.
export async function DELETE(req) {
  const { sourcePath } = await req.json();
  if (!sourcePath) return Response.json({ error: 'sourcePath required' }, { status: 400 });
  const state = getIngestFile(sourcePath);
  if (!state || !state.localPath) return Response.json({ error: 'no local copy tracked for this file' }, { status: 404 });
  try {
    fs.rmSync(state.localPath, { force: true });
  } catch (e) {
    return Response.json({ error: String(e.message || e) }, { status: 500 });
  }
  upsertIngestFile(sourcePath, { status: 'deleted', deletedAt: Date.now(), deletedManually: true });
  return Response.json({ ok: true });
}
