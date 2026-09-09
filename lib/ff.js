import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { loadConfig } from './config.js';
import { runDereverb } from './dereverb.js';

const isWin = process.platform === 'win32';

function bins() {
  const c = loadConfig();
  return { ffmpeg: c.ffmpeg_path || 'ffmpeg', ffprobe: c.ffprobe_path || 'ffprobe' };
}

function run(bin, args, { binary = false } = {}) {
  return new Promise((resolve, reject) => {
    let proc;
    if (isWin) {
      const quoted = [bin, ...args].map((a) => `"${String(a).replace(/"/g, '""')}"`).join(' ');
      proc = spawn('cmd.exe', ['/d', '/s', '/c', `chcp 65001>nul & ${quoted}`], {
        windowsHide: true,
        windowsVerbatimArguments: true,
      });
    } else {
      proc = spawn(bin, args, { windowsHide: true });
    }
    const outChunks = [];
    let err = '';
    proc.stdout.on('data', (d) => outChunks.push(d));
    proc.stderr.on('data', (d) => { err += d.toString(); });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve(binary ? Buffer.concat(outChunks) : Buffer.concat(outChunks).toString('utf8'));
      else reject(new Error(err || `${bin} exited ${code}`));
    });
  });
}

// Copy a (possibly huge, possibly UNC) file to a local folder, used by the
// auto-ingest watcher (lib/ingest.js) to pull raws off \\Servermedia locally
// before scanning/editing — never touches/deletes the source.
//
// HISTORY (2026-09-06): this used to shell out to robocopy (built-in retry
// on a flaky network share). CONFIRMED FOR REAL: it failed 100% of the time
// on every Hebrew-named file, but only when invoked from inside the running
// Next.js dev server — the exact same call from a standalone Node script
// worked fine every time. The stack trace pointed at Next's dev-mode
// instrumentation layer (enabled the moment this project added
// instrumentation.js for the ingest watcher) wrapping child_process.spawn —
// something in that wrapping was corrupting the windowsVerbatimArguments
// quoting robocopy needs for a Hebrew filename, misparsing it as command-line
// switches ("Invalid Parameter"). Switching to a plain Node fs copy sidesteps
// the problem entirely: no shell, no argument quoting, nothing for that
// instrumentation layer to corrupt — and Node's fs APIs already pass paths
// straight through as UTF-16 to Windows regardless.
//
// HISTORY (2026-09-08): the first version of this used fs.promises.copyFile,
// which has NO timeout. CONFIRMED FOR REAL: caught a real ~20GB ingest live
// in the act of stalling — the local copy sat frozen at an exact byte count
// for over an hour (verified with two size samples 15s apart: zero growth)
// while the real source file on \\Servermedia had already grown past it, so
// this wasn't "just a slow network", it was a dead/hung read that copyFile
// never surfaces as an error — it just waits forever, so the retry loop
// below never even got a chance to run. Rewritten as a manual stream pipe
// with an inactivity watchdog: any stretch of `stallMs` with zero bytes
// received destroys the streams and rejects, which the existing retry loop
// then catches and retries (a fresh attempt reopens the connection, which is
// usually enough to recover from a one-off network hiccup on this share).
async function copyWithStallTimeout(srcFile, destPath, stallMs) {
  return new Promise((resolve, reject) => {
    const readStream = fs.createReadStream(srcFile);
    const writeStream = fs.createWriteStream(destPath); // truncates any leftover partial file from a prior failed attempt
    let timer;
    const armWatchdog = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        readStream.destroy(new Error(`copy stalled: no data received for ${stallMs}ms (network share likely hung)`));
      }, stallMs);
    };
    armWatchdog();
    readStream.on('data', armWatchdog);
    readStream.on('error', (e) => { clearTimeout(timer); writeStream.destroy(); reject(e); });
    writeStream.on('error', (e) => { clearTimeout(timer); readStream.destroy(); reject(e); });
    writeStream.on('finish', () => { clearTimeout(timer); resolve(); });
    readStream.pipe(writeStream);
  });
}

export async function robustCopy(srcFile, destDir, { retries = 5, delayMs = 15000, stallMs = 90000 } = {}) {
  fs.mkdirSync(destDir, { recursive: true });
  const destPath = path.join(destDir, path.basename(srcFile));
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      await copyWithStallTimeout(srcFile, destPath, stallMs);
      return destPath;
    } catch (e) {
      lastErr = e;
      if (attempt < retries) await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw lastErr;
}

export async function probe(file) {
  const { ffprobe } = bins();
  const stdout = await run(ffprobe, [
    '-v', 'error',
    '-show_entries', 'format=duration:stream=width,height,codec_type,r_frame_rate',
    '-of', 'json', file,
  ]);
  const j = JSON.parse(stdout || '{}');
  const v = (j.streams || []).find((s) => s.codec_type === 'video') || {};
  const dur = parseFloat(j.format?.duration || '0');
  let fps = 30;
  if (v.r_frame_rate && v.r_frame_rate.includes('/')) {
    const [a, b] = v.r_frame_rate.split('/').map(Number);
    if (b) fps = a / b;
  }
  return { duration: dur, width: v.width || 0, height: v.height || 0, fps };
}

export async function thumbnail(file, atSec, outPath) {
  const { ffmpeg } = bins();
  await run(ffmpeg, ['-y', '-ss', String(atSec), '-i', file, '-frames:v', '1', '-vf', 'scale=320:-1', outPath]);
  return outPath;
}

// buckets: how many peak values to return. startSec/durSec (optional): only
// decode this window of the file (fast seek) instead of the whole thing —
// crucial for multi-hour UNC raws, and gives far higher time-resolution per
// pixel when the window is scoped to a single segment instead of the file.
export async function waveformPeaks(file, buckets = 1000, { startSec, durSec } = {}) {
  const { ffmpeg } = bins();
  const tmp = path.join(os.tmpdir(), `wf-${Date.now()}-${Math.random().toString(36).slice(2)}.pcm`);
  const args = ['-y'];
  if (startSec != null) args.push('-ss', String(Math.max(0, startSec)));
  if (durSec != null) args.push('-t', String(Math.max(0.1, durSec)));
  args.push('-i', file, '-ac', '1', '-ar', '8000', '-f', 's16le', '-acodec', 'pcm_s16le', tmp);
  await run(ffmpeg, args);
  const buf = fs.readFileSync(tmp);
  fs.rmSync(tmp, { force: true });
  const samples = buf.length / 2;
  const per = Math.max(1, Math.floor(samples / buckets));
  const peaks = [];
  for (let i = 0; i < buckets; i++) {
    let max = 0;
    const start = i * per;
    for (let j = 0; j < per && start + j < samples; j++) {
      const v = Math.abs(buf.readInt16LE((start + j) * 2));
      if (v > max) max = v;
    }
    peaks.push(+(max / 32768).toFixed(3));
  }
  return peaks;
}

// crop (optional): {x,y,w,h} in source pixels, from lib/vision.js
// computeHeadCrop — applied before scaling/fade so the fixed "zoom" is
// baked in first, then the picture is normalized to a standard 16:9 delivery
// size regardless of the source/crop resolution.
//
// dereverb (optional, boolean): runs Supertone Clear (see lib/dereverb.js)
// on the audio to reduce room echo, replacing what was previously done by
// hand in DaVinci Resolve. This is NOT an ffmpeg filter, so it can't live in
// the single -af/-vf chain below — it forces a multi-stage pipeline: render
// video (crop+fade) silently, extract+clean the audio separately, then mux
// the two back together with normalize/afade applied to the cleaned audio.
export async function cutSegment(file, start, end, outPath, { normalize = false, fade = false, crop = null, dereverb = false } = {}) {
  const { ffmpeg } = bins();
  const dur = Math.max(0.1, end - start);

  if (!dereverb) {
    const af = [];
    const vf = [];
    if (normalize) af.push('loudnorm=I=-16:TP=-1.5:LRA=11');
    if (crop) vf.push(`crop=${crop.w}:${crop.h}:${crop.x}:${crop.y}`, 'scale=1920:1080');
    if (fade) {
      af.push('afade=t=in:st=0:d=0.5', `afade=t=out:st=${(dur - 0.5).toFixed(2)}:d=0.5`);
      // same 0.5s duration on video so picture and sound fade together, not just audio.
      vf.push('fade=t=in:st=0:d=0.5', `fade=t=out:st=${(dur - 0.5).toFixed(2)}:d=0.5`);
    }
    const args = ['-y', '-ss', String(start), '-i', file, '-t', String(dur)];
    if (af.length) args.push('-af', af.join(','));
    if (vf.length) args.push('-vf', vf.join(','));
    args.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-c:a', 'aac', '-b:a', '192k', outPath);
    await run(ffmpeg, args);
    return outPath;
  }

  const tag = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const videoOnly = path.join(os.tmpdir(), `cut-v-${tag}.mp4`);
  const audioRaw = path.join(os.tmpdir(), `cut-a-raw-${tag}.wav`);
  const audioClean = path.join(os.tmpdir(), `cut-a-clean-${tag}.wav`);
  try {
    // 1. video only: crop + video-fade baked in, no audio track at all.
    const vf = [];
    if (crop) vf.push(`crop=${crop.w}:${crop.h}:${crop.x}:${crop.y}`, 'scale=1920:1080');
    if (fade) vf.push('fade=t=in:st=0:d=0.5', `fade=t=out:st=${(dur - 0.5).toFixed(2)}:d=0.5`);
    const vArgs = ['-y', '-ss', String(start), '-i', file, '-t', String(dur), '-an'];
    if (vf.length) vArgs.push('-vf', vf.join(','));
    vArgs.push('-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', videoOnly);
    await run(ffmpeg, vArgs);

    // 2. raw audio, unprocessed, for the VST plugin to work from.
    await run(ffmpeg, ['-y', '-ss', String(start), '-i', file, '-t', String(dur), '-vn', '-ac', '1', '-ar', '48000', '-acodec', 'pcm_s16le', audioRaw]);

    // 3. Supertone Clear (echo reduction) — see lib/dereverb.js / scripts/dereverb.py.
    await runDereverb(audioRaw, audioClean);

    // 4. mux video + cleaned audio; normalize/fade apply to the cleaned
    // audio now (after de-reverb, not before — its levels change the mix).
    const af = [];
    if (normalize) af.push('loudnorm=I=-16:TP=-1.5:LRA=11');
    if (fade) af.push('afade=t=in:st=0:d=0.5', `afade=t=out:st=${(dur - 0.5).toFixed(2)}:d=0.5`);
    const mArgs = ['-y', '-i', videoOnly, '-i', audioClean];
    if (af.length) mArgs.push('-af', af.join(','));
    mArgs.push('-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', outPath);
    await run(ffmpeg, mArgs);
  } finally {
    for (const f of [videoOnly, audioRaw, audioClean]) {
      try { fs.rmSync(f, { force: true }); } catch { /* best-effort cleanup */ }
    }
  }
  return outPath;
}
