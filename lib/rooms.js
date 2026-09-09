// Maps a camera/room name (embedded in the auto-ingest filename pattern, see
// lib/ingest.js FILENAME_RE) to its DEFAULT distribution channel.
//
// IMPORTANT — confirmed by the user (2026-09-06), rooms are NOT a clean 1:1
// mapping to a channel, just a majority tendency:
//   - "בית מדרש ישן": mostly ישיבת מעלות lessons, occasionally הזוהר.
//   - "פנסיונרים": mostly הזוהר lessons, occasionally ישיבת מעלות.
//   - "מבקשי פניך": never distributed publicly — goes to a specific Drive
//     folder instead. Not a real channel; treated as 'internal'.
// So this is only a SUGGESTED DEFAULT, pre-filled to save clicks in the
// common case — the actual channel is a real per-segment field the user can
// always change (see the selector in app/page.js), never applied blindly.

export const CHANNELS = {
  maalot: 'ישיבת מעלות',
  zohar: 'הזוהר',
  internal: 'לא להפצה (פנימי)',
};

const ROOM_DEFAULT_CHANNEL = {
  'בית מדרש ישן': 'maalot',
  'פנסיונרים': 'zohar',
  'מבקשי פניך': 'internal',
};

// Matches the room-name group out of the auto-ingest filename pattern
// ("YYYY-MM-DD HH-MM-SS - <room>.mp4"). Returns null for anything else
// (manually-named legacy files) — callers should fall back to some other
// default (currently 'maalot', arbitrarily, since it can't be inferred).
const ROOM_RE = /^\d{4}-\d{2}-\d{2} \d{2}-\d{2}-\d{2} ?-\s?(.+)\.mp4$/i;

export function roomFromFileName(fileName) {
  const m = fileName.match(ROOM_RE);
  return m ? m[1].trim() : null;
}

export function defaultChannelForFile(fileName) {
  const room = roomFromFileName(fileName);
  return (room && ROOM_DEFAULT_CHANNEL[room]) || 'maalot';
}

// Best-effort recording date (YYYY-MM-DD) for a source file — used to narrow
// the title-picker (lib/titles.js) to same-day candidates. Auto-ingested
// files carry the real date in their name; older/manually-scanned files
// don't, so callers should fall back to file mtime for those (this function
// only handles the filename case — it doesn't touch the filesystem).
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2}) \d{2}-\d{2}-\d{2} ?-\s?.+\.mp4$/i;
export function dateFromFileName(fileName) {
  const m = fileName.match(DATE_RE);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}
