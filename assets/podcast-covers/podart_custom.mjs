// A square cover for a series without its own template: given photo (and the rabbi's column
// range in it), chosen colours, same layout as podart_one (narrow panel left, rabbi right).
// arg: a JSON file { photo, cropX0, cropX1, panelTop, panelBottom, divider, text, title:[..], sub, rabbiFirst, rabbiName, logoTemplate, out }
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
const o = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const S = 3000, FONT = 'templates/fonts/Rubik-Bold.ttf';
const ff = (args, input) => execFileSync('ffmpeg', ['-v', 'error', ...args], { maxBuffer: 4e8, input });
const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=width,height', '-of', 'json', o.photo]).toString()).streams[0];
const W = probe.width, H = probe.height;
const raw = ff(['-i', o.photo, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
const px = (x, y) => { const i = (y * W + x) * 3; return [raw[i], raw[i + 1], raw[i + 2]]; };
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const PANEL = Math.round(S * 0.40), buf = Buffer.alloc(S * S * 3);
// photo: the rabbi's columns, height-filling, right-aligned
const k = S / H, x0 = o.cropX0, x1 = o.cropX1, offX = S - (x1 - x0) * k;
for (let Y = 0; Y < S; Y++) for (let X = 0; X < S; X++) {
  const sx = Math.min(x1 - 1, Math.max(0, Math.round(x0 + (X - offX) / k))), sy = Math.min(H - 1, Math.round(Y / k));
  const c = px(sx, sy), p = (Y * S + X) * 3; buf[p] = c[0]; buf[p + 1] = c[1]; buf[p + 2] = c[2];
}
// panel: vertical gradient + curved divider
const top = hex(o.panelTop), bot = hex(o.panelBottom), div = hex(o.divider);
const edgeX = (Y) => PANEL - 120 + 120 * (1 - (2 * Y / S - 1) ** 2);
for (let Y = 0; Y < S; Y++) {
  const t = Y / S, col = top.map((v, i) => Math.round(v + (bot[i] - v) * t)), e = edgeX(Y);
  for (let X = 0; X < Math.min(S, e + 46); X++) { const p = (Y * S + X) * 3; const c = X <= e ? col : div; buf[p] = c[0]; buf[p + 1] = c[1]; buf[p + 2] = c[2]; }
}
fs.writeFileSync(o.out + '.raw', buf);
const RLM = '‏', tf = (n, s) => { const p = `data/cache/sqc_${process.pid}_${n}.txt`; fs.writeFileSync(p, RLM + s + RLM, 'utf8'); return p; };
const inkWidth = (file, size) => {
  const h = Math.round(size * 1.6), r = ff(['-f', 'lavfi', '-i', `color=c=black:s=3000x${h}`, '-frames:v', '1', '-vf', `drawtext=fontfile=${FONT}:textfile=${file}:fontsize=${size}:fontcolor=white:x=20:y=${Math.round(size * 0.2)}`, '-f', 'rawvideo', '-pix_fmt', 'gray', '-']);
  let mn = 3000, mx = -1; for (let y = 0; y < h; y++) for (let x = 0; x < 3000; x++) if (r[y * 3000 + x] > 60) { if (x < mn) mn = x; if (x > mx) mx = x; } return mx - mn + 1;
};
const R = PANEL - 200, MAXW = R - 110, fit = (files, s0) => { let s = s0; while (s > 60 && Math.max(...files.map((f) => inkWidth(f, s))) > MAXW) s -= 10; return s; };
const tl = o.title.map((l, i) => tf('t' + i, l)), TS = fit(tl, 220);
const sub = o.sub ? tf('sub', o.sub) : null, SS = sub ? fit([sub], 120) : 0;
const r1 = tf('r1', o.rabbiFirst), r2 = tf('r2', o.rabbiName), NS = fit([r2], 180);
const ty = 1250 - (tl.length - 1) * TS * 0.58;
const draw = [
  ...tl.map((f, i) => `drawtext=fontfile=${FONT}:textfile=${f}:fontsize=${TS}:fontcolor=${o.text}:x=${R}-text_w:y=${Math.round(ty + i * TS * 1.15)}`),
  ...(sub ? [`drawtext=fontfile=${FONT}:textfile=${sub}:fontsize=${SS}:fontcolor=${o.divider}:x=${R}-text_w:y=${Math.round(ty + tl.length * TS * 1.15 + 40)}`] : []),
  `drawtext=fontfile=${FONT}:textfile=${r1}:fontsize=130:fontcolor=${o.text}@0.85:x=${R}-text_w:y=2080`,
  `drawtext=fontfile=${FONT}:textfile=${r2}:fontsize=${NS}:fontcolor=${o.text}:x=${R}-text_w:y=2240`,
].join(',');
// logo from a template (its fixed top-left spot), background keyed out
const lraw = ff(['-i', o.logoTemplate, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
const lbg = [0, 1, 2].map((c) => lraw[(125 * 1600 + 20) * 3 + c]).map((v) => v.toString(16).padStart(2, '0')).join('');
ff(['-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${S}x${S}`, '-i', o.out + '.raw', '-i', o.logoTemplate,
  '-filter_complex', `[1]crop=250:120:15:15,scale=690:-1,format=rgba,colorkey=0x${lbg}:0.22:0.12[logo];[0][logo]overlay=150:150,${draw}`, '-q:v', '2', o.out]);
for (const f of [o.out + '.raw', ...tl, sub, r1, r2].filter(Boolean)) fs.rmSync(f, { force: true });
console.log('ok', JSON.stringify({ TS, SS, NS }));
