import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { loadConfig } from './config.js';

const isWin = process.platform === 'win32';
function bins() {
  const c = loadConfig();
  return { ffmpeg: c.ffmpeg_path || 'ffmpeg', ffprobe: c.ffprobe_path || 'ffprobe' };
}
function run(bin, args) {
  return new Promise((resolve, reject) => {
    let proc;
    if (isWin) {
      const quoted = [bin, ...args].map((a) => `"${String(a).replace(/"/g, '""')}"`).join(' ');
      proc = spawn('cmd.exe', ['/d', '/s', '/c', `chcp 65001>nul & ${quoted}`], { windowsHide: true, windowsVerbatimArguments: true });
    } else proc = spawn(bin, args, { windowsHide: true });
    const out = []; let err = '';
    proc.stdout.on('data', (d) => out.push(d));
    proc.stderr.on('data', (d) => { err += d.toString(); });
    proc.on('error', reject);
    proc.on('close', (code) => code === 0 ? resolve(Buffer.concat(out).toString('utf8')) : reject(new Error(err || `exit ${code}`)));
  });
}

// Per-window RMS energy of the audio.
export async function rmsProfile(file, step = 1.0) {
  const { ffmpeg } = bins();
  const sr = 8000;
  const tmp = path.join(os.tmpdir(), `rp-${Date.now()}-${Math.random().toString(36).slice(2)}.pcm`);
  await run(ffmpeg, ['-y', '-i', file, '-ac', '1', '-ar', String(sr), '-f', 's16le', '-acodec', 'pcm_s16le', tmp]);
  const buf = fs.readFileSync(tmp); fs.rmSync(tmp, { force: true });
  const samples = buf.length / 2;
  const per = Math.floor(sr * step);
  const n = Math.floor(samples / per);
  const rms = [];
  for (let w = 0; w < n; w++) {
    let sum = 0;
    for (let j = 0; j < per; j++) { const v = buf.readInt16LE((w * per + j) * 2) / 32768; sum += v * v; }
    rms.push(Math.sqrt(sum / per));
  }
  return rms;
}

// Speech levels for a file: the raw RMS trace plus two thresholds derived
// from it, both relative to the "strong speech" level (90th percentile,
// robust to loud peaks) so they adapt to each room's absolute loudness.
//
// Measured on a real multi-hour raw (\\Servermedia test3/עתים 31-8.mp4):
//   background/true silence   : rms ~0-10  (x1000)
//   rabbi speaking softer/off-mic (still mid-lesson): rms ~15-40 (x1000)
//   rabbi at-mic, strong      : rms ~45-200 (x1000)
// A single threshold around 50% of strong (~25-50 here) sits *inside* the
// "softer speech" band, so natural volume dips there get misread as silence
// and split one lesson into pieces whenever a dip lasts > bridgeSec.
export async function speechLevels(file, step = 1.0, { openFraction = 0.5, continueFraction = 0.15 } = {}) {
  const rms = await rmsProfile(file, step);
  const sorted = [...rms].sort((a, b) => a - b);
  const strong = sorted[Math.floor(sorted.length * 0.90)] || 0.001;
  // openThr: only strong, at-mic speech may START a lesson (keeps out pre/post chatter).
  const openThr = Math.max(0.012, strong * openFraction);
  // continueThr: much lower — once a lesson is open, any above-ambient speech
  // (including softer/off-mic) keeps it open; only real silence closes it.
  const continueThr = Math.max(0.010, strong * continueFraction);
  return { step, rms, strong, openThr, continueThr };
}

// Hysteresis run-builder: a run can only be *opened* by crossing openThr,
// but once open it stays open as long as the signal stays above continueThr.
// This is the fix for the "split mid-lesson" bug: a soft-spoken stretch that
// would dip below a single mid-level threshold no longer breaks the run,
// while genuine silence (below continueThr) still does.
//
// minSpeechRunSec debounces continueThr: a run is only "confirmed" active
// again (resetting the silence gap) after `minSpeechRunSec` CONSECUTIVE
// seconds above continueThr — a single isolated noise blip (chair creak,
// cough, room echo) no longer keeps a lesson artificially open.
// Measured on a real file: an empty room between lessons still throws off
// isolated 1s spikes every ~10-20s (well above true silence ~0-10) that,
// without debouncing, kept resetting the gap and dragged a lesson's end
// out by 6+ minutes of dead air. Genuine continuing (if soft) speech is
// dense — sub-threshold streaks there topped out at 3-7s in the same
// recording — so minSpeechRunSec=3 tells the two apart cleanly.
export function runsFromLevels(rms, step, { openThr, continueThr, bridgeSec = 30, minRunSec = 90, minSpeechRunSec = 3 } = {}) {
  const bridge = Math.round(bridgeSec / step);
  const minSpeechRun = Math.max(1, Math.round(minSpeechRunSec / step));
  const runs = [];
  let start = null, gap = 0, activeStreak = 0;
  for (let i = 0; i < rms.length; i++) {
    const v = rms[i];
    if (start === null) {
      if (v > openThr) { start = i; gap = 0; activeStreak = 0; }
    } else if (v > continueThr) {
      activeStreak++;
      if (activeStreak >= minSpeechRun) gap = 0;
    } else {
      activeStreak = 0;
      gap++;
      if (gap > bridge) { runs.push([start, i - gap + 1]); start = null; gap = 0; }
    }
  }
  if (start !== null) runs.push([start, rms.length]);
  return runs.map(([a, b]) => ({ start: a * step, end: b * step })).filter((r) => r.end - r.start >= minRunSec);
}

export async function detectSegments(file, {
  step = 1.0, bridgeSec = 30, minRunSec = 90, pad = 1.0, openFraction = 0.5, continueFraction = 0.15, minSpeechRunSec = 3,
  // learned correction (see lib/store.js recordCorrection/getBias): the
  // median start/end offset between what past scans detected and what the
  // human actually approved, applied on top of pad so the detector keeps
  // converging on the boundaries this user actually wants.
  startBiasSec = 0, endBiasSec = 0,
} = {}) {
  const sl = await speechLevels(file, step, { openFraction, continueFraction });
  const runs = runsFromLevels(sl.rms, step, { openThr: sl.openThr, continueThr: sl.continueThr, bridgeSec, minRunSec, minSpeechRunSec });
  const totalSec = sl.rms.length * step;
  return runs.map((r, i) => {
    const start = Math.max(0, r.start - pad + startBiasSec);
    const end = Math.min(totalSec, r.end + pad + endBiasSec);
    const len = end - start;
    let confidence = 'green';
    if (len < 300 || len > 4200) confidence = 'yellow';
    return { index: i, start: +start.toFixed(2), end: +end.toFixed(2), length: +len.toFixed(2), confidence };
  });
}
