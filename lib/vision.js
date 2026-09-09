import { spawn } from 'node:child_process';
import path from 'node:path';
import { loadConfig } from './config.js';

const isWin = process.platform === 'win32';
const SCRIPT = path.join(process.cwd(), 'scripts', 'head_crop.py');

function run(bin, args) {
  return new Promise((resolve, reject) => {
    let proc;
    if (isWin) {
      const quoted = [bin, ...args].map((a) => `"${String(a).replace(/"/g, '""')}"`).join(' ');
      proc = spawn('cmd.exe', ['/d', '/s', '/c', `chcp 65001>nul & ${quoted}`], { windowsHide: true, windowsVerbatimArguments: true });
    } else proc = spawn(bin, args, { windowsHide: true });
    let out = ''; let err = '';
    proc.stdout.on('data', (d) => { out += d.toString(); });
    proc.stderr.on('data', (d) => { err += d.toString(); });
    proc.on('error', reject);
    proc.on('close', (code) => code === 0 ? resolve(out) : reject(new Error(err || `exit ${code}`)));
  });
}

// Computes the fixed 16:9 head-crop for one segment (see scripts/head_crop.py
// and CLAUDE.md "זום אוטומטי" / config.json -> crop for the calibration).
// Returns {ok:true, x,y,w,h, sourceW, sourceH} or {ok:false, reason} — never
// throws for "couldn't find a good crop", only for the python/model itself
// being broken, so callers can treat ok:false as "export uncropped".
export async function computeHeadCrop(file, start, end) {
  const cfg = loadConfig();
  const python = cfg.python_path || 'python';
  const c = cfg.crop || {};
  const args = [
    SCRIPT, file, String(start), String(end),
    '--step', String(c.stepSec ?? 3),
    '--conf', String(c.confThreshold ?? 0.6),
    '--anchor-pct', String(c.anchorPercentile ?? 0.05),
    '--head-margin', String(c.headMargin ?? 0.03),
    '--crop-h-frac', String(c.cropHeightFraction ?? 0.85),
  ];
  const out = await run(python, args);
  // OpenCV can print warnings to stdout on some builds — the result is
  // always the last non-empty line.
  const lines = out.split('\n').map((l) => l.trim()).filter(Boolean);
  const last = lines[lines.length - 1];
  try {
    return JSON.parse(last);
  } catch {
    throw new Error(`head_crop.py produced no parseable JSON: ${out.slice(-500)}`);
  }
}
