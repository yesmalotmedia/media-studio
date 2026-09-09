import { loadConfig, saveConfig, listVideos, encodePath } from '../../../lib/config.js';
import { probe } from '../../../lib/ff.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const folder = searchParams.get('folder') || loadConfig().source_folder;
  const vids = listVideos(folder);
  // Probe lazily but include duration for the list (cheap enough for a few dozen)
  const out = [];
  for (const v of vids) {
    let meta = { duration: 0, width: 0, height: 0, fps: 30 };
    try { meta = await probe(v.path); } catch {}
    out.push({ id: encodePath(v.path), name: v.name, size: v.size, ...meta });
  }
  return Response.json({ folder, videos: out });
}

export async function POST(req) {
  const body = await req.json();
  const saved = saveConfig({
    source_folder: body.source_folder ?? undefined,
    output_folder: body.output_folder ?? undefined,
  });
  return Response.json({ ok: true, config: saved });
}
