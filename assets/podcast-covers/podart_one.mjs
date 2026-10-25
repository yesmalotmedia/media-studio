// One square Spotify cover in the direction of the user's own squares (option ב, 2026-10-20):
// the rabbi (cut from the series' YouTube template) large on the right, a narrow panel on the
// left with logo, series name and rabbi, a curved divider in the template's colour.
// Handles both template layouts: panel left + photo right (most), or photo left + panel right.
// args: template out titleLines("a|b") rabbiPrefix rabbiName bubble(0/1)
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
const [tplPath, out, titleArg, rabbiFirst, rabbiName, bubbleArg] = process.argv.slice(2);
const titleLines = titleArg.split('|'), withBubble = bubbleArg === '1';
const W = 1600, H = 900, S = 3000, FONT = 'templates/fonts/Rubik-Bold.ttf';
const ff = (args, input) => execFileSync('ffmpeg', ['-v', 'error', ...args], { maxBuffer: 3e8, input });
const raw = ff(['-i', tplPath, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
const px = (x, y) => { const i = (y * W + x) * 3; return [raw[i], raw[i + 1], raw[i + 2]]; };
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const sat = ([r, g, b]) => Math.max(r, g, b) - Math.min(r, g, b);
const ITIM_ORANGE = [248,159,25]; // the עתים לתורה bubble colour (from the אגדתות template) — same on every עתים cover
const lum = ([r, g, b]) => 0.299 * r + 0.587 * g + 0.114 * b;

// no bubble wanted: erase the template's own עתים bubble (top-right corner) by filling it from the
// wall just below its edge, column by column
if (!withBubble) {
  const isOrange = ([r, g, b]) => r > 200 && g > 110 && g < 200 && b < 90;
  if (isOrange(px(W - 10, 6))) {
    let left = W - 10; while (left > W - 700 && isOrange(px(left - 1, 6))) left--;
    let bottom = 6; while (bottom < 300 && isOrange(px(W - 10, bottom + 1))) bottom++;
    const a = (W - left) * 1.06, b = bottom * 1.12;
    for (let x = Math.floor(W - a); x < W; x++) {
      const t = (W - x) / a; if (t > 1) continue;
      const yEdge = Math.min(H - 1, Math.ceil(b * Math.sqrt(1 - t * t)) + 10);
      const c = px(x, yEdge);
      for (let y = 0; y < yEdge; y++) { const i = (y * W + x) * 3; raw[i] = c[0]; raw[i + 1] = c[1]; raw[i + 2] = c[2]; }
    }
  }
}
// which side is the panel on? the Maalot logo (dark navy) sits in the panel's top corner
const navyAt = (x0, x1) => { let n = 0; for (let y = 20; y < 160; y += 2) for (let x = x0; x < x1; x += 2) { const [r, g, b] = px(x, y); if (b > 80 && r < 70 && g < 70) n++; } return n; };
const panelRight = navyAt(W - 420, W - 20) > navyAt(20, 420);
// divider: a thick saturated band on the top row, scanning from the panel side
let divColor = [35, 31, 111], photoX0 = 0, photoX1 = W;
const scan = panelRight ? (f) => { for (let x = W - 250; x > 500; x--) if (f(x)) return; } : (f) => { for (let x = 250; x < 1100; x++) if (f(x)) return; };
scan((x) => { const c = px(x, 20); if (sat(c) < 90) return false; let n = 0; while (n < 40 && dist(px(x + (panelRight ? -n : n), 20), c) < 45) n++; if (n >= 12) { divColor = c; return true; } return false; });
for (let y = 0; y < H; y += 10) {
  let last = -1;
  if (!panelRight) { for (let x = 250; x < 1150; x++) if (dist(px(x, y), divColor) < 60) last = x; else if (last > 0 && x - last > 25) break; photoX0 = Math.max(photoX0, last + 4); }
  else { for (let x = W - 250; x > 450; x--) if (dist(px(x, y), divColor) < 60) last = x; else if (last > 0 && last - x > 25) break; if (last > 0) photoX1 = Math.min(photoX1, last - 4); }
}
const pxFrom = panelRight ? 0 : photoX0, pxTo = panelRight ? photoX1 : W; // the photo's columns in the template
// panel wash: the template's panel above the title bar, heavily blurred
const PANEL = Math.round(S * 0.40);
const panelSrcX = panelRight ? photoX1 + 20 : 0, panelSrcW = panelRight ? W - photoX1 - 40 : Math.round(photoX0 * 0.7);
ff(['-y', '-i', tplPath, '-vf', `crop=${panelSrcW}:420:${panelSrcX}:0,scale=${PANEL}:${S},gblur=sigma=90`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', out + '.panel.raw']);
const panel = fs.readFileSync(out + '.panel.raw');
let lsum = 0; for (let i = 0; i < panel.length; i += 3 * 997) lsum += lum([panel[i], panel[i + 1], panel[i + 2]]);
const panelLight = lsum / (panel.length / (3 * 997)) > 150;
const TEXT = panelLight ? '0x231F6F' : 'white';

const buf = Buffer.alloc(S * S * 3);
// 1. photo, height-filling; its right part (where the rabbi usually is) toward the square's right side
const k = S / H, photoW = (pxTo - pxFrom) * k;
const offX = S - photoW + Math.round(photoW * 0.0); // right-aligned
const SHIFT = panelRight ? 0 : Math.round(S * 0.15);
for (let Y = 0; Y < S; Y++) for (let X = 0; X < S; X++) {
  const sx = Math.min(pxTo - 1, Math.max(pxFrom, Math.round(pxFrom + (X - offX - (panelRight ? 0 : 0)) / k - SHIFT / k))), sy = Math.min(H - 1, Math.round(Y / k));
  const c = px(sx, sy), o = (Y * S + X) * 3; buf[o] = c[0]; buf[o + 1] = c[1]; buf[o + 2] = c[2];
}
// 2. panel + curved divider on the left
const edgeX = (Y) => PANEL - 120 + 120 * (1 - (2 * Y / S - 1) ** 2);
for (let Y = 0; Y < S; Y++) {
  const e = edgeX(Y);
  for (let X = 0; X < Math.min(S, e + 46); X++) {
    const o = (Y * S + X) * 3;
    if (X <= e) { const p = (Y * PANEL + Math.min(PANEL - 1, X)) * 3; buf[o] = panel[p]; buf[o + 1] = panel[p + 1]; buf[o + 2] = panel[p + 2]; }
    else { buf[o] = divColor[0]; buf[o + 1] = divColor[1]; buf[o + 2] = divColor[2]; }
  }
}
// 3. corner bubble for עתים לתורה, in the template's bubble colour
const bubble = ITIM_ORANGE, BA = 980, BB = 390;
if (withBubble) for (let Y = 0; Y < BB; Y++) for (let X = S - BA; X < S; X++) {
  if (((S - X) / BA) ** 2 + (Y / BB) ** 2 > 1) continue;
  const o = (Y * S + X) * 3; buf[o] = bubble[0]; buf[o + 1] = bubble[1]; buf[o + 2] = bubble[2];
}
fs.writeFileSync(out + '.raw', buf);

// 4. texts, each sized to fit the panel (measured, not guessed)
const RLM = '‏';
const tf = (n, s) => { const p = `data/cache/sq_${process.pid}_${n}.txt`; fs.writeFileSync(p, RLM + s + RLM, 'utf8'); return p; };
const inkWidth = (file, size) => {
  const h = Math.round(size * 1.6), r = ff(['-f', 'lavfi', '-i', `color=c=black:s=3000x${h}`, '-frames:v', '1', '-vf', `drawtext=fontfile=${FONT}:textfile=${file}:fontsize=${size}:fontcolor=white:x=20:y=${Math.round(size * 0.2)}`, '-f', 'rawvideo', '-pix_fmt', 'gray', '-']);
  let mn = 3000, mx = -1; for (let y = 0; y < h; y++) for (let x = 0; x < 3000; x++) if (r[y * 3000 + x] > 60) { if (x < mn) mn = x; if (x > mx) mx = x; } return mx - mn + 1;
};
const R = PANEL - 200, MAXW = R - 110;
const fit = (files, start) => { let s = start; while (s > 60 && Math.max(...files.map((f) => inkWidth(f, s))) > MAXW) s -= 10; return s; };
const tl = titleLines.map((l, i) => tf('t' + i, l));
const TS = fit(tl, 220);
const t3 = tf('r1', rabbiFirst), t4 = tf('r2', rabbiName);
const NS = fit([t4], 180);
const b = [tf('b1', 'עתים לתורה'), tf('b2', 'שיעורים לציבור הרחב'), tf('b3', 'בישיבת מעלות')];
const ty = 1250 - (tl.length - 1) * TS * 0.58;
const draw = [
  ...tl.map((f, i) => `drawtext=fontfile=${FONT}:textfile=${f}:fontsize=${TS}:fontcolor=${TEXT}:x=${R}-text_w:y=${Math.round(ty + i * TS * 1.15)}`),
  `drawtext=fontfile=${FONT}:textfile=${t3}:fontsize=130:fontcolor=${TEXT}@0.85:x=${R}-text_w:y=2080`,
  `drawtext=fontfile=${FONT}:textfile=${t4}:fontsize=${NS}:fontcolor=${TEXT}:x=${R}-text_w:y=2240`,
  ...(withBubble ? [`drawtext=fontfile=${FONT}:textfile=${b[0]}:fontsize=118:fontcolor=white:x=${S - 80}-text_w:y=40`,
    `drawtext=fontfile=${FONT}:textfile=${b[1]}:fontsize=74:fontcolor=white:x=${S - 80}-text_w:y=180`,
    `drawtext=fontfile=${FONT}:textfile=${b[2]}:fontsize=74:fontcolor=white:x=${S - 80}-text_w:y=265`] : []),
].join(',');
// logo: the template's own, from the panel's top corner, background keyed out
// find the logo by its navy pixels in the panel's top corner (its position differs per template)
let lx0 = W, lx1 = 0, ly0 = H, ly1 = 0;
const cx0 = W - 380, cx1 = W; // only used for panel-right templates
for (let y = 0; y < 240; y++) for (let x = cx0; x < cx1; x++) { const [r, g, b2] = px(x, y); if (b2 > 80 && r < 75 && g < 75) { lx0 = Math.min(lx0, x); lx1 = Math.max(lx1, x); ly0 = Math.min(ly0, y); ly1 = Math.max(ly1, y); } }
const LM = 12;
// panel-left templates: the logo's fixed spot (works on all of them); panel-right: the detected box
const lx = panelRight ? Math.max(0, lx0 - LM) : 15, ly = panelRight ? Math.max(0, ly0 - LM) : 15;
const lw = panelRight ? Math.min(W - lx, lx1 - lx0 + 2 * LM) : 250, lh = panelRight ? Math.min(H - ly, ly1 - ly0 + 2 * LM) : 120;
const bg = panelRight ? px(Math.max(0, lx - 4), Math.min(H - 1, ly + lh + 4)) : px(20, 125), bgHex = bg.map((v) => v.toString(16).padStart(2, '0')).join('');
ff(['-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${S}x${S}`, '-i', out + '.raw', '-i', tplPath,
  '-filter_complex', `[1]crop=${lw}:${lh}:${lx}:${ly},scale=${Math.round(lw * 2.76)}:-1,format=rgba,colorkey=0x${bgHex}:0.22:0.12[logo];[0][logo]overlay=150:150,${draw}`, '-q:v', '2', out]);
for (const f of [out + '.raw', out + '.panel.raw', ...tl, t3, t4, ...b]) fs.rmSync(f, { force: true });
console.log(JSON.stringify({ panelRight, divColor, photo: [pxFrom, pxTo], panelLight, TS, NS }));
