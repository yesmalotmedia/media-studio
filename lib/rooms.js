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
  if (room && ROOM_DEFAULT_CHANNEL[room]) return ROOM_DEFAULT_CHANNEL[room];
  // a hand-named file (e.g. "זוהר קצר טו א.MP3") says what it is
  return /זוהר/.test(fileName) ? 'zohar' : 'maalot';
}

// The channel follows from the sheet row's series — measured 2026-11-03 on all
// 158 approved lessons: a series naming "זוהר" went to הזוהר, every other one to
// מעלות, no exception. Used when a row is picked (app/page.js).
export const channelForSeries = (series) => (/זוהר/.test(series || '') ? 'zohar' : 'maalot');

// Per-segment default before any row is picked. The room alone was right for only
// 82/158 (פנסיונרים has MORE מעלות lessons than זוהר); the lesson's length was right
// for 151/171 — the daily Zohar amud runs 11–24 minutes, מעלות lessons a median 43
// (misses: short שם משמואל/תהלים, long עיון בזוהר). Past lessons in the same weekly
// slot (room + weekday + ±45 minutes, last 120 days, at least 2 that mostly agree)
// override the length: 152/171. Still only a suggestion — the selector stays.
// `past`: [{ t: start ms, room, channel }] of approved lessons.
export function suggestChannel(fileName, startSec, lengthSec, past = []) {
  const room = roomFromFileName(fileName);
  if (room && ROOM_DEFAULT_CHANNEL[room] === 'internal') return 'internal';
  const t = startTimeOf(fileName, startSec);
  if (t != null) {
    const d = new Date(t), h = d.getHours() + d.getMinutes() / 60;
    const votes = {};
    for (const p of past) {
      const pd = new Date(p.t);
      if (p.room === room && pd.getDay() === d.getDay() && Math.abs(pd.getHours() + pd.getMinutes() / 60 - h) <= 0.75 && t - p.t > 0 && t - p.t < 120 * 864e5) votes[p.channel] = (votes[p.channel] || 0) + 1;
    }
    const [top, second] = Object.entries(votes).sort((a, b) => b[1] - a[1]);
    if (top && top[1] >= 2 && (!second || top[1] >= 3 * second[1])) return top[0];
  }
  if (!room) return defaultChannelForFile(fileName); // hand-named files: the name says it
  return lengthSec / 60 <= 24 ? 'zohar' : 'maalot';
}

// Wall-clock start of a segment, from the auto-ingest filename + offset. null if unnamed.
export function startTimeOf(fileName, startSec = 0) {
  const m = String(fileName).match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2})-(\d{2})-(\d{2}) ?-/);
  return m ? new Date(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime() + startSec * 1000 : null;
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
