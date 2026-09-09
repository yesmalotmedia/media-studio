import fs from 'node:fs';
import { decodePath } from '../../../../lib/config.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Open a read stream with retry — UNC / network files can transiently report
// EBUSY when another process holds a handle. We retry a few times.
function openStream(file, opts, tries = 4) {
  return new Promise((resolve, reject) => {
    const attempt = (n) => {
      const s = fs.createReadStream(file, opts);
      s.on('error', (e) => {
        if ((e.code === 'EBUSY' || e.code === 'EMFILE' || e.code === 'EAGAIN') && n > 0) {
          setTimeout(() => attempt(n - 1), 150);
        } else {
          reject(e);
        }
      });
      s.on('open', () => resolve(s));
    };
    attempt(tries);
  });
}

export async function GET(req, { params }) {
  let file;
  try { file = decodePath(params.id); } catch { return new Response('bad id', { status: 400 }); }

  let stat;
  try { stat = fs.statSync(file); } catch { return new Response('not found', { status: 404 }); }
  const total = stat.size;
  const range = req.headers.get('range');

  const base = { 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' };

  try {
    if (!range) {
      const stream = await openStream(file, {});
      return new Response(stream, { status: 200, headers: { ...base, 'Content-Length': String(total) } });
    }
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    let start = m && m[1] ? parseInt(m[1], 10) : 0;
    let end = m && m[2] ? parseInt(m[2], 10) : total - 1;
    if (isNaN(start) || start < 0) start = 0;
    if (isNaN(end) || end >= total) end = total - 1;
    if (start > end) { start = 0; end = total - 1; }
    const chunkSize = end - start + 1;
    const stream = await openStream(file, { start, end });
    return new Response(stream, {
      status: 206,
      headers: { ...base, 'Content-Range': `bytes ${start}-${end}/${total}`, 'Content-Length': String(chunkSize) },
    });
  } catch (e) {
    return new Response(`read error: ${e.code || e.message}`, { status: 500 });
  }
}
