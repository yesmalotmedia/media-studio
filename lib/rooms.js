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

// Fixed footer appended to every מעלות (maalot) upload's YouTube description
// — per the user (2026-09-15): every מעלות lesson should carry these links
// (WhatsApp group, Spotify, Kolel app, Facebook, website) regardless of
// whatever's in that segment's own `notes` field (which is per-lesson, often
// empty, occasionally a full transcript — see lib/titles.js). Not applied to
// 'zohar' or 'internal' — this is מעלות's own branding/links, not theirs.
const MAALOT_FOOTER = `להצטרפות לקבוצת ווטסאפ שקטה של תורת ישיבת מעלות
https://chat.whatsapp.com/JpRgbvP5uBlGvJYaaFohnO

ישיבת מעלות בספוטיפיי  https://did.li/4rjZH
ישיבת מעלות באפליקציית כולל (לבעלי מכשירים עם סינון) https://www.kolel.org/channel/yeshivat-malot
ישיבת מעלות בפייסבוק  https://did.li/PRU5q
לאתר ישיבת מעלות  https://yesmalot.co.il/`;

// Builds the actual YouTube description for a segment: its own notes (if
// any) plus, for מעלות uploads specifically, the fixed footer above —
// combined with a blank line between them, never just one glued onto the
// other. Shared by both the automatic per-export upload and the manual
// catch-up upload (see app/api/export/route.js, app/api/youtube-upload/route.js)
// so the two paths can't drift apart.
export function buildDescription(seg) {
  const parts = [];
  if (seg.notes) parts.push(seg.notes.trim());
  if (seg.channel === 'maalot') parts.push(MAALOT_FOOTER);
  return parts.join('\n\n');
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
