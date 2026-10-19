import fs from 'node:fs';
import path from 'node:path';

const CONFIG_PATH = path.join(process.cwd(), 'config.json');

export function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch {
    return { source_folder: '', output_folder: '', ffmpeg_path: 'ffmpeg', ffprobe_path: 'ffprobe' };
  }
}

export function saveConfig(patch) {
  const cur = loadConfig();
  const next = { ...cur, ...patch };
  // atomic write (temp + rename) — see lib/store.js writeStore for why: a
  // plain writeFileSync that fails partway (disk full, crash) leaves this
  // file empty/corrupt instead of failing safely, and this file is on the hot
  // path of every single request (loadConfig() falls back to near-nothing on
  // a parse failure).
  const tmp = `${CONFIG_PATH}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2));
  fs.renameSync(tmp, CONFIG_PATH);
  return next;
}

const VIDEO_RE = /\.(mp4|mov|m4v|mkv|avi)$/i;
// Audio-only recordings (e.g. a backup recorder used when the camera failed)
// go through the same detect → review → export flow; at export the picture
// is the lesson's cover image for the whole video (see lib/ff.js cutSegment
// stillImage, user 2026-10-15).
const AUDIO_RE = /\.(mp3|m4a|wav|aac|ogg|flac|wma)$/i;
export const isAudioFile = (name) => AUDIO_RE.test(String(name));
export const isMediaFile = (name) => VIDEO_RE.test(String(name)) || AUDIO_RE.test(String(name));

const MIME = { mp3: 'audio/mpeg', m4a: 'audio/mp4', wav: 'audio/wav', aac: 'audio/aac', ogg: 'audio/ogg', flac: 'audio/flac', wma: 'audio/x-ms-wma', mov: 'video/quicktime', mkv: 'video/x-matroska', avi: 'video/x-msvideo' };
export const mimeOf = (name) => MIME[String(name).split('.').pop().toLowerCase()] || 'video/mp4';

export function listVideos(folder) {
  if (!folder || !fs.existsSync(folder)) return [];
  return fs.readdirSync(folder, { withFileTypes: true })
    .filter((e) => e.isFile() && isMediaFile(e.name))
    .map((e) => {
      const full = path.join(folder, e.name);
      const st = fs.statSync(full);
      return { name: e.name, path: full, size: st.size, mtime: st.mtimeMs };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

// Encode a file path to a URL-safe id (base64url) and back.
export function encodePath(p) {
  return Buffer.from(p, 'utf8').toString('base64url');
}
export function decodePath(id) {
  return Buffer.from(id, 'base64url').toString('utf8');
}
