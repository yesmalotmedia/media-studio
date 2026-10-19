// Zohar site (zoharyomi.vercel.app) — its lessons live in the Wix CMS of the
// old zohar-yomi.org Wix site and the new site reads them from there. Iyun
// lessons: collection "Import1"; a lesson's page is /shiur/iyun/<pageid>,
// pageid being a running number (max + 1). CONFIRMED 2026-10-11 by reading the
// collection (913 items then).
//
// Order agreed with the user 2026-10-11: YouTube upload first (the Wix row
// embeds the video), then the Wix row, then the YouTube description is updated
// with the lesson's direct site link (lib/description.js).
//
// Filled automatically: daf/page/par (parsed from the column-C title, e.g.
// "דף פז עמוד א #1 - ..."), parasha (column B), youtube (video embed), sources
// (column E), pageid. NOT filled: aramit/hebrew (the Zohar text) — still added
// by hand in Wix for now, as decided.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const SITE = 'https://zoharyomi.vercel.app';

function creds() {
  return JSON.parse(fs.readFileSync(path.join(process.cwd(), 'credentials', 'wix.json'), 'utf8'));
}

async function api(method, url, body) {
  const c = creds();
  const r = await fetch(`https://www.wixapis.com${url}`, {
    method,
    headers: { Authorization: c.apiKey, 'wix-site-id': c.siteId, 'Content-Type': 'application/json' },
    body: body && JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Wix ${r.status}: ${JSON.stringify(j).slice(0, 300)}`);
  return j;
}

// "דף פז עמוד א #1 - מעמדו של ישמעאל" -> { daf: 'פז', page: 'א', par: 1 }
export function parseDafPagePar(title) {
  const m = String(title || '').match(/דף\s+([^\s#]+)\s+עמוד\s+([אב])(?:\s*#\s*(\d+))?/);
  return m ? { daf: m[1], page: m[2], par: m[3] ? Number(m[3]) : null } : null;
}
const parshaOf = (series) => (String(series || '').match(/פרשת\s+([^|]+?)\s*(\||$)/) || [])[1]?.trim() || '';

// Same rich-content shape the existing rows have (video node + empty paragraph).
function videoEmbed(videoId, title) {
  const rid = () => crypto.randomBytes(4).toString('hex');
  return {
    documentStyle: {},
    nodes: [
      {
        id: rid(), type: 'VIDEO', nodes: [],
        videoData: {
          containerData: { alignment: 'CENTER', textWrap: true, width: { size: 'CONTENT' } },
          video: { src: { url: `https://youtu.be/${videoId}` } },
          thumbnail: { src: { url: `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg` }, width: 1280, height: 720 },
          title,
        },
      },
      { id: rid(), type: 'PARAGRAPH', nodes: [], paragraphData: {} },
    ],
  };
}

async function maxPageId(collection) {
  const q = await api('POST', '/wix-data/v2/items/query', {
    dataCollectionId: collection,
    query: { sort: [{ fieldName: 'pageid', order: 'DESC' }], paging: { limit: 1 } },
  });
  return Number(q.dataItems?.[0]?.data?.pageid) || 0;
}

// An existing row for this video (so a retry never adds the lesson twice).
async function findByVideo(collection, videoId) {
  const q = await api('POST', '/wix-data/v2/items/query', {
    dataCollectionId: collection,
    query: { sort: [{ fieldName: '_createdDate', order: 'DESC' }], paging: { limit: 50 } },
  });
  return q.dataItems?.find((it) => JSON.stringify(it.data?.youtube || '').includes(videoId)) || null;
}

// Two collections, same fields: "iyun" (Import1) and "pshat" (the short lessons,
// lib/description.js zoharKind 'short'). Page paths /shiur/iyun/<n>, /shiur/pshat/<n>.
// CONFIRMED 2026-10-11: pshat has no "sources" field and its titles carry no "#".
const KINDS = { iyun: { collection: () => creds().collections.iyun, path: 'iyun' }, short: { collection: () => creds().collections.pshat, path: 'pshat' } };
export const sitePageUrl = (kind, pageid) => `${SITE}/shiur/${KINDS[kind].path}/${pageid}`;
export const iyunPageUrl = (pageid) => sitePageUrl('iyun', pageid);

// The row that would be inserted — also used for a dry run.
export async function buildSiteItem(kind, seg, { videoId, youtubeTitle, sourcesUrl, texts }) {
  const loc = parseDafPagePar(seg.title);
  if (!loc) throw new Error(`can't read daf/page from title "${seg.title}"`);
  const data = {
    daf: loc.daf, page: loc.page, parasha: parshaOf(seg.series),
    youtube: videoEmbed(videoId, youtubeTitle || seg.youtubeTitle || seg.title),
    pageid: (await maxPageId(KINDS[kind].collection())) + 1,
  };
  if (loc.par != null) data.par = loc.par;
  if (sourcesUrl && kind === 'iyun') data.sources = sourcesUrl;
  if (texts?.aramit) { data.aramit = texts.aramit; data.hebrew = texts.hebrew; }
  return data;
}

// Fills aramit/hebrew of an existing row, every other field kept as is.
export async function setSiteTexts(kind, wixItemId, { aramit, hebrew }) {
  const collection = KINDS[kind].collection();
  const cur = await api('GET', `/wix-data/v2/items/${wixItemId}?dataCollectionId=${collection}`);
  await api('PUT', `/wix-data/v2/items/${wixItemId}`, { dataCollectionId: collection, dataItem: { id: wixItemId, data: { ...cur.dataItem.data, aramit, hebrew } } });
}

export const setIyunTexts = (id, t) => setSiteTexts('iyun', id, t);

// ---- keeping the site in order (user, 2026-10-19) ---------------------------
// The site lists lessons by pageid, i.e. in the order they were added. A lesson
// that arrives before the one meant to precede it (CONFIRMED 2026-10-15: ויקרא
// טז א/ב went up before טו א/ב, which came later from backup audio) is a fault —
// it is HELD (not added) until the missing lesson is on the site, then they go
// up in order (releaseHeldSiteLessons, run by lib/publishWatch.js).
const GEM = { א: 1, ב: 2, ג: 3, ד: 4, ה: 5, ו: 6, ז: 7, ח: 8, ט: 9, י: 10, כ: 20, ך: 20, ל: 30, מ: 40, ם: 40, נ: 50, ן: 50, ס: 60, ע: 70, פ: 80, ף: 80, צ: 90, ץ: 90, ק: 100, ר: 200, ש: 300, ת: 400 };
const amudNo = (daf, page) => [...String(daf || '').replace(/[^א-ת]/g, '')].reduce((s, ch) => s + (GEM[ch] || 0), 0) * 2 + (page === 'ב' ? 1 : 0);

async function lastSiteRow(collection) {
  const q = await api('POST', '/wix-data/v2/items/query', {
    dataCollectionId: collection,
    query: { sort: [{ fieldName: 'pageid', order: 'DESC' }], paging: { limit: 1 } },
  });
  return q.dataItems?.[0]?.data || null;
}

// Is this lesson the one that comes right after the last lesson on the site?
// short: the next amud. iyun: the next # on the same amud, or #1 of the next amud.
// A new parsha can't be checked (no order across parshiot here) — let through.
export function followsOrder(kind, last, loc, parasha) {
  if (!last || !loc) return { ok: true };
  if (String(last.parasha || '').trim() !== String(parasha || '').trim()) return { ok: true };
  const prev = amudNo(last.daf, last.page), cur = amudNo(loc.daf, loc.page);
  const after = `דף ${last.daf} עמוד ${last.page}${last.par ? ` #${last.par}` : ''}`;
  if (kind === 'short') return cur === prev + 1 ? { ok: true } : { ok: false, after };
  const prevPar = Number(last.par) || 0, curPar = loc.par ?? 0;
  const ok = (cur === prev && curPar === prevPar + 1) || (cur === prev + 1 && curPar <= 1);
  return ok ? { ok: true } : { ok: false, after };
}

// Adds a lesson to its Wix collection. Returns { wixItemId, pageid, siteUrl }.
export async function addSiteLesson(kind, seg, opts) {
  const collection = KINDS[kind].collection();
  const existing = await findByVideo(collection, opts.videoId);
  if (existing) return { wixItemId: existing.id, pageid: existing.data.pageid, siteUrl: sitePageUrl(kind, existing.data.pageid), existed: true };
  const data = await buildSiteItem(kind, seg, opts);
  const res = await api('POST', '/wix-data/v2/items', { dataCollectionId: collection, dataItem: { data } });
  return { wixItemId: res.dataItem.id, pageid: data.pageid, siteUrl: sitePageUrl(kind, data.pageid) };
}

// Called right after a lesson's YouTube upload (app/api/export,
// app/api/youtube-upload). Zohar lessons: iyun -> Import1, short -> pshat.
// Adds the Wix row, then rewrites the video's description with the lesson's
// own site link. Never throws — returns the fields to store on the segment
// (wixStatus 'done' | 'skipped' | 'error').
export async function publishToSite(seg, videoId) {
  const { zoharKind, buildYoutubeDescription } = await import('./description.js');
  const { findLessonRow } = await import('./sheetsSync.js');
  const { lessonText } = await import('./zoharText.js');
  const { loadConfig } = await import('./config.js');
  const { updateVideoDescription } = await import('./youtube.js');
  const kind = seg.channel === 'zohar' ? zoharKind(seg.series) : null;
  if (!KINDS[kind]) return { wixStatus: 'skipped' };
  try {
    // out of order -> wait for the lesson that should come before it
    const existing = await findByVideo(KINDS[kind].collection(), videoId);
    if (!existing) {
      const order = followsOrder(kind, await lastSiteRow(KINDS[kind].collection()), parseDafPagePar(seg.title), parshaOf(seg.series));
      if (!order.ok) return { wixStatus: 'held', wixHeldSince: seg.wixHeldSince || Date.now(), wixHeldReason: `האחרון באתר: ${order.after} — השיעור הזה לא הבא בתור, ממתין לשיעור שלפניו` };
    }
    // column D (start/end words) and E (sources link), read fresh from the sheet
    let row = { value: '', notes: '' };
    try { const { spreadsheetId, gid } = loadConfig().titles || {}; row = await findLessonRow({ spreadsheetId, gid, titleRowId: seg.titleRowId, series: seg.series, title: seg.title }); } catch {}
    const sourcesUrl = row.value.trim() || seg.sourcesUrl || '';
    const notes = row.notes || seg.notes || '';
    // the Zohar passage — a miss leaves the texts empty (filled by hand), never blocks the lesson
    const loc = parseDafPagePar(seg.title);
    let texts = null, textError = null;
    try {
      const t = await lessonText({ parsha: parshaOf(seg.series), daf: loc?.daf, amud: loc?.page, notes });
      if (t.error) textError = t.error; else texts = t;
    } catch (e) { textError = String(e.message || e); }
    const r = await addSiteLesson(kind, seg, { videoId, youtubeTitle: seg.youtubeTitle || seg.title, sourcesUrl, texts });
    const out = { wixStatus: 'done', wixHeldReason: null, wixItemId: r.wixItemId, sitePageId: r.pageid, siteUrl: r.siteUrl,
      textStatus: texts ? 'done' : 'missing', ...(texts ? { textParagraphs: texts.paragraphs } : { textError }) };
    try {
      await updateVideoDescription(seg.channel, videoId, await buildYoutubeDescription(seg, { siteUrl: r.siteUrl }));
      out.descriptionSiteLink = true;
    } catch (e) {
      out.descriptionError = String(e.message || e); // the Wix row is in; only the description link is missing
    }
    return out;
  } catch (e) {
    return { wixStatus: 'error', wixError: String(e.message || e) };
  }
}
