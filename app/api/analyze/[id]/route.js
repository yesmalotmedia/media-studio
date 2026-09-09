import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { decodePath } from '../../../../lib/config.js';
import { waveformPeaks, probe } from '../../../../lib/ff.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CACHE = path.join(process.cwd(), 'data', 'cache');

export async function GET(req, { params }) {
  let file;
  try { file = decodePath(params.id); } catch { return new Response('bad id', { status: 400 }); }
  if (!fs.existsSync(file)) return new Response('not found', { status: 404 });

  const { searchParams } = new URL(req.url);
  const startQ = searchParams.get('start');
  const endQ = searchParams.get('end');
  // Range mode: only decode+return peaks for [start,end) of the file. This is
  // what the editor uses — fast (seeks instead of decoding the whole raw)
  // and far more precise per pixel than a whole-file overview.
  const ranged = startQ != null && endQ != null;
  const start = ranged ? Math.max(0, parseFloat(startQ)) : null;
  const end = ranged ? parseFloat(endQ) : null;

  fs.mkdirSync(CACHE, { recursive: true });
  // BUG FIX (2026-09-03): this used to be params.id.slice(0, 40) — but every
  // file in the same folder shares that folder's path as a base64 prefix,
  // and the folder path alone is >40 chars once UTF-8-encoded (Hebrew path
  // segments), so EVERY file in a folder collided on the same cache key —
  // one file's waveform (and duration!) got served for a completely
  // different file. Hash the whole id instead so it's actually unique.
  const idHash = crypto.createHash('sha1').update(params.id).digest('hex').slice(0, 20);
  const key = idHash + (ranged ? `-${Math.round(start)}-${Math.round(end)}` : '');
  const cacheFile = path.join(CACHE, `${key}.wf.json`);

  if (fs.existsSync(cacheFile)) {
    return Response.json(JSON.parse(fs.readFileSync(cacheFile, 'utf8')));
  }

  const meta = await probe(file);
  let data;
  if (ranged) {
    const durSec = Math.max(0.1, Math.min(end, meta.duration) - start);
    const peaks = await waveformPeaks(file, 1000, { startSec: start, durSec });
    data = { peaks, rangeStart: start, rangeEnd: start + durSec, duration: meta.duration, fps: meta.fps };
  } else {
    const peaks = await waveformPeaks(file, 1000);
    data = { peaks, duration: meta.duration, fps: meta.fps };
  }
  fs.writeFileSync(cacheFile, JSON.stringify(data));
  return Response.json(data);
}
