// Maalot lessons → yesmalot.co.il (WordPress). Agreed with the user 2026-10-18:
//   - only full lessons that come through the studio (the 1–3 minute vertical
//     shorts keep being posted by hand, by someone else);
//   - a post is created only once the lesson's YouTube video is PUBLIC
//     (uploads go up unlisted — a post would expose the video early), see
//     lib/publishWatch.js;
//   - post = title (sheet column O) + the video in the ACF "youtube" oEmbed
//     field (renders the same iframe the existing posts have) + categories
//     (data/wordpress/series-categories.json, learned from the site's own
//     posts) + "אורך השיעור" by duration; no featured image (the site takes it
//     from the embed); author = the user who posts the full lessons today (47);
//   - then column P ("אתר – הופץ") is ticked in the sheet.
// Never posts twice: a post already holding the same video (e.g. posted by
// hand) is reused, not duplicated.
// Credentials: credentials/wordpress.json (user "shiur-studio", Editor role,
// application password — git-ignored).
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const CATS_FILE = path.join(ROOT, 'data', 'wordpress', 'series-categories.json');
const AUTHOR_ID = 47; // the account the full lessons are posted under today
const LENGTH = { short: 1425, medium: 1426, long: 1427 }; // taxonomy media_length: קצר / בינוני / ארוך
// thresholds measured 2026-10-18 on ~750 existing posts vs. their videos' real durations
const lengthTerm = (minutes) => (minutes < 15 ? LENGTH.short : minutes <= 40 ? LENGTH.medium : LENGTH.long);
const BOOKS = { בראשית: 60, שמות: 69, ויקרא: 109, במדבר: 87, דברים: 98 };
const PARSHA_ROOT = 68; // פרשת שבוע
const TANAKH_BOOKS_ROOT = 26; // נביאים וכתובים

function creds() {
  return JSON.parse(fs.readFileSync(path.join(ROOT, 'credentials', 'wordpress.json'), 'utf8'));
}
async function wp(p, { method = 'GET', body } = {}) {
  const c = creds();
  const r = await fetch(c.site.replace(/\/$/, '') + p, {
    method,
    headers: { Authorization: 'Basic ' + Buffer.from(`${c.username}:${c.applicationPassword}`).toString('base64'), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body && JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`WordPress ${r.status}: ${j.message || JSON.stringify(j).slice(0, 200)}`);
  return j;
}

let catCache = null;
async function allCategories() {
  if (catCache && Date.now() - catCache.at < 3600_000) return catCache.list;
  const list = [];
  for (let page = 1; ; page++) {
    const items = await wp(`/wp-json/wp/v2/categories?per_page=100&page=${page}&_fields=id,name,parent`);
    list.push(...items);
    if (items.length < 100) break;
  }
  catCache = { at: Date.now(), list };
  return list;
}
const decode = (s) => String(s || '').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&amp;/g, '&').replace(/&#8211;/g, '–');
const bare = (s) => decode(s).replace(/[֑-ׇ]/g, '').replace(/["״'׳]/g, '').replace(/\s+/g, ' ').trim();

export function seriesRule(series) {
  const { series: map } = JSON.parse(fs.readFileSync(CATS_FILE, 'utf8'));
  const key = Object.keys(map).find((k) => bare(k) === bare(series));
  return key ? map[key] : null;
}

// Categories for a lesson: the series' own set, plus פרשת שבוע/book/parsha when the
// title names a parsha ("פרשת נח - ..."), plus the Tanakh book for נ"ך-type series.
export async function categoriesFor(seg) {
  const rule = seriesRule(seg.series);
  if (!rule) return null;
  const ids = new Set(rule.categories);
  const cats = await allCategories();
  const title = bare(seg.websiteTitle || seg.title);
  if (rule.parsha) {
    const m = title.match(/פרשת\s+([א-ת]+(?:\s+[א-ת]+)?)/);
    if (m) {
      for (const [, bookId] of Object.entries(BOOKS)) {
        // two-word parshiot first ("לך לך", "כי תצא"), then one word
        const hit = cats.find((c) => c.parent === bookId && bare(c.name) === m[1]) || cats.find((c) => c.parent === bookId && bare(c.name) === m[1].split(' ')[0]);
        if (hit) { ids.add(PARSHA_ROOT); ids.add(bookId); ids.add(hit.id); break; }
      }
    }
  }
  if (rule.bookFromTitle) {
    const book = cats.filter((c) => c.parent === TANAKH_BOOKS_ROOT).sort((a, b) => b.name.length - a.name.length)
      .find((c) => title.startsWith(bare(c.name).replace(/'$/, '')));
    if (book) ids.add(book.id);
  }
  return [...ids];
}

// The ACF "youtube" field is an oEmbed field: it STORES the video URL and renders
// the iframe itself (1080x608 + title, identical to the hand-made posts).
// CONFIRMED FOR REAL 2026-10-18: sending iframe HTML got mangled into a broken
// URL; and wp/v2 ignores `acf` on this site — only the "ACF to REST API"
// plugin's own endpoint (acf/v3) writes it.
const youtubeUrl = (videoId) => `https://www.youtube.com/watch?v=${videoId}`;

// An existing post that already embeds this video (posted by hand, or by us earlier).
export async function findPostByVideo(videoId, { title, pages = 2 } = {}) {
  // a hand-made post for the same lesson almost always has the same title — search that first (fast)
  if (title) {
    const items = await wp(`/wp-json/wp/v2/posts?search=${encodeURIComponent(decode(title).slice(0, 60))}&per_page=20&status=publish,future,draft,pending&_fields=id,link,status,acf`);
    const hit = items.find((p) => String(p.acf?.youtube || '').includes(videoId));
    if (hit) return hit;
  }
  for (let page = 1; page <= pages; page++) {
    const items = await wp(`/wp-json/wp/v2/posts?per_page=100&page=${page}&status=publish,future,draft,pending&_fields=id,link,status,acf`);
    const hit = items.find((p) => String(p.acf?.youtube || '').includes(videoId));
    if (hit) return hit;
    if (items.length < 100) break;
  }
  return null;
}

// Builds the post (also used for a dry run).
export async function buildLessonPost(seg, { durationMin }) {
  const categories = await categoriesFor(seg);
  if (!categories) throw new Error(`no WordPress categories for series "${seg.series}" in data/wordpress/series-categories.json`);
  const rule = seriesRule(seg.series);
  if (!rule.lecturers?.length) throw new Error(`no lecturer (רב) for series "${seg.series}" in data/wordpress/series-categories.json`);
  return {
    title: seg.websiteTitle || seg.title,
    categories,
    // רבנים + סוגי מדיה: exposed to the REST API by the "Shiur Studio – רבנים ב-REST"
    // Code Snippets snippet on the site (added 2026-10-18 — the Simple Taxonomy
    // plugin that registers them has no REST option)
    lecturers: rule.lecturers,
    'media-type': rule.mediaType?.length ? rule.mediaType : [230], // וידאו
    media_length: durationMin ? [lengthTerm(durationMin)] : [],
    author: AUTHOR_ID,
    youtube: youtubeUrl(seg.youtubeVideoId),
  };
}

// Creates (or finds) the post. status: 'publish' normally, 'draft' for a test.
export async function postLesson(seg, { durationMin, status = 'publish' } = {}) {
  const existing = await findPostByVideo(seg.youtubeVideoId, { title: seg.websiteTitle || seg.title });
  if (existing && existing.status === 'draft' && status === 'publish') {
    // a draft waiting for this video (e.g. our own test post) — publish it rather than add a second post
    const pub = await wp(`/wp-json/wp/v2/posts/${existing.id}`, { method: 'POST', body: { status: 'publish' } });
    return { wpStatus: 'done', wpPostId: existing.id, wpUrl: pub.link, wpAt: Date.now(), wpFromDraft: true };
  }
  if (existing) return { wpStatus: 'exists', wpPostId: existing.id, wpUrl: existing.link };
  const { youtube, ...fields } = await buildLessonPost(seg, { durationMin });
  // created as a draft first: the video field is a second request, and a published post
  // must never be live without its video even for a moment
  const post = await wp('/wp-json/wp/v2/posts', { method: 'POST', body: { ...fields, status: 'draft' } });
  const saved = await wp(`/wp-json/acf/v3/posts/${post.id}`, { method: 'POST', body: { fields: { youtube } } });
  if (!String(saved.acf?.youtube || '').includes(seg.youtubeVideoId)) throw new Error(`post ${post.id} created (draft) but the youtube field did not save`);
  const final = status === 'draft' ? post : await wp(`/wp-json/wp/v2/posts/${post.id}`, { method: 'POST', body: { status } });
  return { wpStatus: status === 'publish' ? 'done' : status, wpPostId: post.id, wpUrl: final.link, wpAt: Date.now() };
}
