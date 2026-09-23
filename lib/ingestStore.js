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

// CONFIRMED FOR REAL (2026-09-12): the disk filled up completely (ENOSPC) and
// this file was left at 0 BYTES afterward — writeFileSync truncates the
// target before writing, so a write that fails partway through (out of space,
// or any crash mid-write) leaves the file empty/corrupt instead of failing
// safely. That wiped every file's lifecycle status (copied/error/gone/etc.),
// which on the next restart would have made the watcher treat already-copied,
// partially-reviewed files as brand new and re-copy + re-scan them — silently
// DUPLICATING their segments (see conversation for the manual recovery this
// took). Write to a temp file + atomic rename instead: a failed write leaves
// the temp file broken but the real store untouched, and rename() is atomic
// so readers never see a half-written file either.
function write(d) {
  ensure();
  const tmp = `${STORE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(d, null, 2));
  fs.renameSync(tmp, STORE);
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
