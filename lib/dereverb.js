import { spawn } from 'node:child_process';
import path from 'node:path';
import { loadConfig } from './config.js';

const isWin = process.platform === 'win32';
const SCRIPT = path.join(process.cwd(), 'scripts', 'dereverb.py');

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

// Runs Supertone Clear (VST3, via pedalboard — see scripts/dereverb.py) on a
// WAV file in place of the room-echo reduction previously done by hand in
// DaVinci Resolve. Parameters default to the ones calibrated by ear on a
// real shiur (config.json -> dereverb).
export async function runDereverb(inWav, outWav) {
  const cfg = loadConfig();
  const python = cfg.python_path || 'python';
  const d = cfg.dereverb || {};
  const args = [
    SCRIPT, inWav, outWav,
    '--ambience-gain', String(d.ambienceGain ?? -29.1),
    '--voice-gain', String(d.voiceGain ?? 0.0),
    '--voice-reverb-gain', String(d.voiceReverbGain ?? -60.0),
  ];
  if (d.program) args.push('--program', d.program);
  await run(python, args);
}
