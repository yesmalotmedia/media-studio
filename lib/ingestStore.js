// Tracks the lifecycle of raw camera files as the auto-ingest watcher
// (lib/ingest.js) discovers them on \\Servermedia\הקלטות, waits for them to
// finish recording, copies them locally, and eventually cleans up the local
// copy once every segment sourced from it is done being reviewed/exported.
//
// Kept as its own JSON file (separate from data/segments.json / lib/store.js)
// because this is a different concern — file lifecycle, not human review
// state — and keeping it separate means a bug here can't corrupt the
// segments/approvals data.
import fs from 'node:fs';
import path from 'node:path';

const DATA = path.join(process.cwd(), 'data');
const STORE = path.join(DATA, 'ingest.json');

function ensure() {
  fs.mkdirSync(DATA, { recursive: true });
  if (!fs.existsSync(STORE)) fs.writeFileSync(STORE, JSON.stringify({ files: {} }, null, 2));
}

function read() {
  ensure();
  try {
    const s = JSON.parse(fs.readFileSync(STORE, 'utf8'));
    if (!s.files) s.files = {};
    return s;
  } catch {
    return { files: {} };
  }
}

function write(d) {
  ensure();
  fs.writeFileSync(STORE, JSON.stringify(d, null, 2));
}

// status: watching | copying | scanning | copied | error | deleted
export function getIngestFile(sourcePath) {
  return read().files[sourcePath] || null;
}

export function listIngestFiles() {
  return read().files;
}

export function upsertIngestFile(sourcePath, patch) {
  const d = read();
  d.files[sourcePath] = { ...(d.files[sourcePath] || {}), ...patch, sourcePath };
  write(d);
  return d.files[sourcePath];
}
