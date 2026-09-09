import fs from 'node:fs';
import path from 'node:path';
import { decodePath, loadConfig } from '../../../lib/config.js';
import { cutSegment } from '../../../lib/ff.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 3600;

export async function POST(req) {
  const { id, start, end, name, normalize, fade } = await req.json();
  let file;
  try { file = decodePath(id); } catch { return Response.json({ error: 'bad id' }, { status: 400 }); }
  if (!fs.existsSync(file)) return Response.json({ error: 'source not found' }, { status: 404 });

  const cfg = loadConfig();
  const outDir = cfg.output_folder || path.join(process.cwd(), 'data', 'out');
  fs.mkdirSync(outDir, { recursive: true });

  const base = (name || path.basename(file).replace(/\.[^.]+$/, '')).replace(/[\\/:*?"<>|]/g, '_');
  const outPath = path.join(outDir, `${base}.mp4`);

  try {
    await cutSegment(file, Number(start), Number(end), outPath, { normalize: !!normalize, fade: !!fade });
    return Response.json({ ok: true, outPath });
  } catch (e) {
    return Response.json({ error: String(e.message || e) }, { status: 500 });
  }
}
