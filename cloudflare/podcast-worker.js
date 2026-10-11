// Cloudflare Worker that serves the podcast bucket (R2) at a fixed public
// address — the feeds and MP3s written by lib/podcast.js. Read-only: GET/HEAD
// only, nothing can be written or listed through it.
//
// Setup (Cloudflare dashboard, once): Workers & Pages -> Create -> Worker,
// paste this file, Deploy; then Settings -> Bindings -> Add -> R2 bucket,
// variable name BUCKET, bucket yesmalot-podcast.
//
// Range requests matter: podcast apps stream and seek inside the MP3 with
// "Range: bytes=..." and some (Apple) refuse files served without it.
export default {
  async fetch(request, env) {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
    }
    const key = decodeURIComponent(new URL(request.url).pathname.slice(1));
    if (!key || key.endsWith('/')) return new Response('Not found', { status: 404 });

    const object = await env.BUCKET.get(key, { range: request.headers, onlyIf: request.headers });
    if (object === null) return new Response('Not found', { status: 404 });

    const headers = new Headers();
    object.writeHttpMetadata(headers); // Content-Type, Cache-Control as uploaded
    headers.set('ETag', object.httpEtag);
    headers.set('Accept-Ranges', 'bytes');
    headers.set('Access-Control-Allow-Origin', '*');

    // onlyIf matched a conditional request (If-None-Match etc.) -> no body
    if (!('body' in object) || !object.body) return new Response(null, { status: 304, headers });

    let status = 200;
    if (object.range && request.headers.has('range')) {
      const { offset, length } = object.range;
      const end = (offset ?? 0) + (length ?? object.size) - 1;
      headers.set('Content-Range', `bytes ${offset ?? 0}-${end}/${object.size}`);
      headers.set('Content-Length', String(end - (offset ?? 0) + 1));
      status = 206;
    } else {
      headers.set('Content-Length', String(object.size));
    }
    return new Response(request.method === 'HEAD' ? null : object.body, { status, headers });
  },
};
