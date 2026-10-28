// Lesson cover images (YouTube thumbnails): a per-series template made in
// Canva with the variable title left out (templates/<series>.jpg), plus the
// lesson's own title — column C of the titles sheet — drawn into the
// template's text slot (templates/layouts.json). Rendered with ffmpeg's
// drawtext (libfribidi + libharfbuzz, so Hebrew/RTL shapes correctly) through
// lib/ff.js, so no extra image dependency.
//
// Template lookup: the file name is the series name from column B, with
// characters Windows can't put in a file name ("|", '"') dropped — so both
// sides are compared with everything but letters/digits stripped (niqqud too).
import fs from 'node:fs';
import path from 'node:path';
import { runFfmpeg } from './ff.js';
import { setThumbnail } from './youtube.js';

const TEMPLATE_DIR = path.join(process.cwd(), 'templates');
const FONT = 'templates/fonts/Rubik-Bold.ttf'; // relative to cwd — keeps the drive-letter colon out of the filter string
const TMP_DIR = path.join(process.cwd(), 'data', 'cache');

// Ink height of a Hebrew line in Rubik, as a fraction of the font size —
// MEASURED (2026-09-30) on the Yitro template: 54px text spans ~39px of ink
// above the baseline. Used to center the block on the ink, not the font box,
// so it lines up visually with the template's bar/band.
const CAP_RATIO = 0.72;
const LINE_STEP = 1.1; // baseline-to-baseline, as a fraction of the font size

const norm = (s) => String(s || '').normalize('NFD').replace(/[֑-ׇ]/g, '').replace(/[^א-תa-z0-9]/gi, '');

function loadLayouts() {
  return JSON.parse(fs.readFileSync(path.join(TEMPLATE_DIR, 'layouts.json'), 'utf8'));
}

// { file, layout } for a column-B series name, or null if there's no
// template. layout is null for a template image that has no layouts.json
// entry yet — its text slot hasn't been measured, and guessing would put the
// title somewhere wrong on a public video.
export function findTemplate(series) {
  const key = norm(series);
  if (!key) return null;
  const file = fs.readdirSync(TEMPLATE_DIR).find((f) => /\.(jpe?g|png)$/i.test(f) && norm(f.replace(/\.[^.]+$/, '')) === key);
  if (!file) return null;
  const layouts = loadLayouts();
  return { file: path.join(TEMPLATE_DIR, file), layout: layouts[file] ? { ...layouts._default, ...layouts[file] } : null };
}

// drawtext runs fribidi with a left-to-right base direction, so punctuation at
// the edge of a Hebrew line lands on the wrong side — CONFIRMED FOR REAL
// (2026-09-30): "האם אני צדיק תמים ושלם?" rendered with the "?" on the right,
// at the start of the sentence. An invisible RIGHT-TO-LEFT MARK at both ends
// makes those edge characters resolve as RTL.
const RLM = '‏';

let tmpSeq = 0;
function tmpText(text) {
  fs.mkdirSync(TMP_DIR, { recursive: true });
  const p = path.join(TMP_DIR, `cover-${process.pid}-${tmpSeq++}.txt`);
  fs.writeFileSync(p, `${RLM}${text}${RLM}`, 'utf8');
  return { abs: p, rel: path.relative(process.cwd(), p).replace(/\\/g, '/') };
}

const REF_SIZE = 100;
const widthCache = new Map();
// Rendered ink width of one line at REF_SIZE — drawn once on a black strip
// and measured from the pixels, so it's exactly what the real render
// produces (bidi, shaping and all). Width scales linearly with font size, so
// every other size is derived from this one measurement (+2% slack for
// hinting) instead of re-rendering per size.
async function refWidth(text) {
  if (widthCache.has(text)) return widthCache.get(text);
  const W = 4000, H = REF_SIZE * 2;
  const t = tmpText(text);
  try {
    const raw = await runFfmpeg([
      '-v', 'error', '-f', 'lavfi', '-i', `color=c=black:s=${W}x${H}`, '-frames:v', '1',
      '-vf', `drawtext=fontfile=${FONT}:textfile=${t.rel}:fontsize=${REF_SIZE}:fontcolor=white:x=20:y=30`,
      '-f', 'rawvideo', '-pix_fmt', 'gray', '-',
    ], { binary: true });
    let min = W, max = -1;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (raw[y * W + x] > 60) { if (x < min) min = x; if (x > max) max = x; }
    const w = max < 0 ? 0 : max - min + 1;
    widthCache.set(text, w);
    return w;
  } finally { fs.rmSync(t.abs, { force: true }); }
}
const widthAt = (ref, fontSize) => Math.ceil((ref * fontSize * 1.02) / REF_SIZE);

// Every way to group the " - "-separated parts into consecutive lines, the
// natural one-part-per-line split first. E.g. "שופטים - תחילת פרק ב - נחלה
// ובכייה" can go on 3 lines, 2 (either split point) or 1.
function groupings(segments) {
  const out = [];
  const n = segments.length;
  for (let mask = 0; mask < 1 << (n - 1); mask++) {
    const lines = [];
    let cur = segments[0];
    for (let i = 1; i < n; i++) {
      if (mask & (1 << (i - 1))) cur += ` - ${segments[i]}`;
      else { lines.push(cur); cur = segments[i]; }
    }
    lines.push(cur);
    out.push(lines);
  }
  return out; // mask 0 = every part on its own line
}

// Greedy word-wrap of one line to maxWidth at fontSize (last resort only).
async function wrap(line, fontSize, maxWidth) {
  const words = line.split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (!cur || widthAt(await refWidth(next), fontSize) <= maxWidth) cur = next;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  return lines;
}

const blockHeight = (lines, fontSize) => fontSize * CAP_RATIO + (lines - 1) * fontSize * LINE_STEP;

// Picks the line grouping + font size that shows the title largest while
// fitting the slot (maxWidth per line, maxHeight for the block). The title is
// split only at its own " - " separators; word-wrapping inside a part is a
// last resort for a part too long to fit on one line even at minFontSize.
export async function layoutTitle(title, layout) {
  const segments = String(title).split(/\s+[-–]\s+/).map((s) => s.trim()).filter(Boolean);
  if (!segments.length) return { lines: [], fontSize: layout.fontSize };
  const refs = new Map();
  const measure = async (cands) => { for (const lines of cands) for (const l of lines) if (!refs.has(l)) refs.set(l, await refWidth(l)); };
  const largest = (cands) => {
    for (let size = layout.fontSize; size >= layout.minFontSize; size -= 2) {
      for (const lines of cands) {
        if (blockHeight(lines.length, size) > layout.maxHeight) continue;
        if (lines.every((l) => widthAt(refs.get(l), size) <= layout.maxWidth)) return { lines, fontSize: size };
      }
    }
    return null;
  };

  const natural = groupings(segments);
  await measure(natural);
  const best = largest(natural);

  // A long title with no " - " to break at would otherwise be stuck on one
  // tiny line (CONFIRMED 2026-10-04: "אשריכם ישראל, לפני מי אתם מיטהרין"
  // came out 30px in a slot that fits two 44px lines). Also try the most
  // balanced two-line split by words — used only when it buys clearly
  // bigger text, so the title's own separators stay preferred: only when the
  // natural layout came out under 80% of the slot's size, and never breaking
  // so a line starts with punctuation or the " - " is cut in half (both
  // CONFIRMED ugly on 2026-10-04: ", גאולה ויום כיפור" as a second line).
  const words = String(title).split(/\s+/).filter(Boolean);
  if (words.length > 1 && (!best || best.fontSize < layout.fontSize * 0.8)) {
    const splits = [];
    for (let i = 1; i < words.length; i++) {
      const a = words.slice(0, i).join(' '), b = words.slice(i).join(' ');
      if (/^[\p{P}]/u.test(b) || /[-–]$/.test(a)) continue;
      splits.push([a, b]);
    }
    if (!splits.length) return best || { lines: segments, fontSize: layout.minFontSize };
    await measure(splits);
    splits.sort((a, b) => Math.max(refs.get(a[0]), refs.get(a[1])) - Math.max(refs.get(b[0]), refs.get(b[1])));
    const balanced = largest([splits[0]]);
    if (balanced && (!best || balanced.fontSize >= best.fontSize + 6)) return balanced;
  }
  if (best) return best;

  // Nothing fits — word-wrap each part at the smallest size.
  const lines = [];
  for (const seg of segments) lines.push(...(await wrap(seg, layout.minFontSize, layout.maxWidth)));
  return { lines, fontSize: layout.minFontSize };
}

// Renders the cover for { series, title } to outPath (.jpg). Returns
// { outPath, template, lines, fontSize }, or throws if the series has no
// template yet.
export async function makeCover({ series, title }, outPath) {
  const tpl = findTemplate(series);
  if (!tpl) throw new Error(`no cover template for series "${series}" — add templates/<series name>.jpg`);
  if (!tpl.layout) throw new Error(`template "${path.basename(tpl.file)}" has no text slot in templates/layouts.json yet`);
  const { layout } = tpl;
  const { lines, fontSize } = await layoutTitle(title, layout);
  const step = fontSize * LINE_STEP;
  const firstBaseline = layout.centerY + (fontSize * CAP_RATIO) / 2 - ((lines.length - 1) * step) / 2;
  const color = String(layout.color).replace(/^#/, '0x');
  // Default: lines right-aligned at layout.right. align "center": each line
  // centered on layout.centerX (e.g. "לחיות עם פרשת השבוע", where the parsha
  // name sits centered above its description).
  const x = layout.align === 'center' ? `${layout.centerX}-text_w/2` : `${layout.right}-text_w`;
  const tmps = lines.map(tmpText);
  try {
    const filters = tmps.map((t, i) =>
      `drawtext=fontfile=${FONT}:textfile=${t.rel}:fontsize=${fontSize}:fontcolor=${color}:y_align=baseline:x=${x}:y=${Math.round(firstBaseline + i * step)}`);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    await runFfmpeg(['-v', 'error', '-y', '-i', tpl.file, '-vf', filters.join(','), '-frames:v', '1', '-q:v', '2', outPath]);
  } finally { for (const t of tmps) fs.rmSync(t.abs, { force: true }); }
  return { outPath, template: path.basename(tpl.file), lines, fontSize };
}

// Called right after a segment's video is uploaded (app/api/export,
// app/api/youtube-upload): renders its cover and sets it as the thumbnail.
// Never throws — a cover problem must not turn a successful upload into a
// failed one. Returns the fields to store on the segment: coverStatus is
// 'done', 'no-template' (series has no template image, or no measured
// layout yet), or 'error' (+ coverError).
export async function applyCover(seg, videoId) {
  const tpl = findTemplate(seg.series);
  if (!tpl || !tpl.layout || !seg.title) return { coverStatus: 'no-template' };
  try {
    const outPath = path.join(process.cwd(), 'data', 'covers', `${seg.id}.jpg`);
    await makeCover({ series: seg.series, title: seg.title }, outPath);
    // CONFIRMED FOR REAL (2026-10-16): right after an upload YouTube sometimes
    // refuses the thumbnail ("can't be set for the specified video ... not
    // properly authorized") — the same call succeeded later by hand for all 3
    // such videos. The video is still processing; wait and try again.
    // Also "The video ... cannot be found" (2026-10-27, שם משמואל; fine an hour later).
    for (let attempt = 1; ; attempt++) {
      try { await setThumbnail(seg.channel, videoId, outPath); break; } catch (e) {
        if (attempt >= 4 || !/can't be set|cannot be set|not properly authorized|cannot be found/i.test(String(e.message || e))) throw e;
        await new Promise((r) => setTimeout(r, attempt * 60000));
      }
    }
    return { coverStatus: 'done', coverPath: outPath };
  } catch (e) {
    return { coverStatus: 'error', coverError: String(e.message || e) };
  }
}
