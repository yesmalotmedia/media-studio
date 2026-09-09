import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { decodePath } from '../../../../lib/config.js';
import { thumbnail } from '../../../../lib/ff.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const CACHE = path.join(process.cwd(), 'data', 'cache');

export async function GET(req, { params }) {
  let file;
  try { file = decodePath(params.id); } catch { return new Response('bad id', { status: 400 }); }
  if (!fs.existsSync(file)) return new Response('not found', { status: 404 });

  const { searchParams } = new URL(req.url);
  const at = parseFloat(searchParams.get('t') || '0');

  fs.mkdirSync(CACHE, { recursive: true });
  // same collision bug as analyze/[id]/route.js — files sharing a folder
  // share a base64 prefix longer than 32 chars, so this used to serve the
  // wrong file's thumbnail. Hash the whole id instead.
  const idHash = crypto.createHash('sha1').update(params.id).digest('hex').slice(0, 16);
  const key = `${idHash}-${Math.round(at)}`;
  const out = path.join(CACHE, `${key}.jpg`);

  if (!fs.existsSync(out)) {
    try { await thumbnail(file, at, out); }
    catch (e) { return new Response(`thumb error: ${e.message}`, { status: 500 }); }
  }
  const buf = fs.readFileSync(out);
  return new Response(buf, { headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'max-age=3600' } });
}
