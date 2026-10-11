// YouTube descriptions. Zohar lessons get a fixed template (wording agreed
// with the user 2026-10-11); everything else keeps buildDescription
// (lib/rooms.js: the sheet's notes + the Maalot footer).
//
// Zohar template, filled per lesson from the titles sheet:
//   title (C) | series type – parsha (from B)
//   fixed one-liner (short vs iyun)
//   📄 source sheets — column E, read LIVE at upload time (a link added to the
//      sheet by hand after the title was picked still makes it in); line
//      omitted when empty
//   notes (D), if any
//   📚 the series playlist (exact column-B name, see lib/youtube.js)
//   🎧 Spotify · 🌐 site · 💬 WhatsApp — fixed links
//   hashtags
// The site link is the home page for now; per-lesson pages
// (/shiur/iyun/<n>) need the number the lesson gets in Wix, which only exists
// once the Wix step runs before the YouTube upload — planned, not built yet.
import { buildDescription } from './rooms.js';
import { findSeriesPlaylistId } from './youtube.js';
import { findLessonRow } from './sheetsSync.js';
import { loadConfig } from './config.js';

const ZOHAR = {
  spotify: 'https://open.spotify.com/show/2hL7TxOFEqHErFOLcDUr0E',
  site: 'https://zoharyomi.vercel.app/',
  whatsapp: 'https://chat.whatsapp.com/Jho0f5IWHZW3rFzWu5s1X9',
};

// YouTube rejects '<' and '>' anywhere in a description.
const clean = (s) => String(s || '').replace(/[<>]/g, '').trim();

export function zoharKind(series) {
  const s = String(series || '');
  if (/^שיעור עיון בזוהר/.test(s)) return 'iyun';
  if (/^העמוד היומי בזוהר/.test(s)) return 'short';
  return null;
}
const parshaOf = (series) => (String(series || '').match(/פרשת\s+([^|]+?)\s*(\||$)/) || [])[1]?.trim() || '';

async function sourcesLink(seg) {
  try {
    const { spreadsheetId, gid } = loadConfig().titles || {};
    const { value } = await findLessonRow({ spreadsheetId, gid, titleRowId: seg.titleRowId, series: seg.series, title: seg.title });
    return value.trim() || seg.sourcesUrl || '';
  } catch {
    return seg.sourcesUrl || ''; // sheet unreachable — don't block the upload over a description line
  }
}

export async function buildYoutubeDescription(seg) {
  const kind = seg.channel === 'zohar' ? zoharKind(seg.series) : null;
  if (!kind) return buildDescription(seg);

  const parsha = parshaOf(seg.series);
  const [sources, playlistId] = await Promise.all([sourcesLink(seg), findSeriesPlaylistId(seg.channel, seg.series)]);
  const lines = [
    kind === 'iyun'
      ? `${clean(seg.title)} | שיעור עיון בזוהר${parsha ? ` – פרשת ${parsha}` : ''}`
      : `${clean(seg.title)} | העמוד היומי בזוהר${parsha ? ` – פרשת ${parsha}` : ''}`,
    kind === 'iyun' ? 'שיעור עיון בזוהר הקדוש' : 'עמוד יומי בזוהר הקדוש – ביאור קצר ותמציתי',
    '',
  ];
  if (sources) lines.push(`📄 דפי המקורות לשיעור: ${sources}`);
  if (clean(seg.notes)) lines.push(clean(seg.notes));
  if (sources || clean(seg.notes)) lines.push('');
  if (playlistId) {
    lines.push(`📚 ${kind === 'iyun' ? 'כל שיעורי העיון בפרשת' : 'כל שיעורי פרשת'} ${parsha}: https://www.youtube.com/playlist?list=${playlistId}`);
  }
  lines.push(
    `🎧 להאזנה בספוטיפיי: ${ZOHAR.spotify}`,
    `🌐 כל השיעורים באתר: ${ZOHAR.site}`,
    `💬 להצטרפות לקבוצת הוואטסאפ של העמוד היומי בזוהר: ${ZOHAR.whatsapp}`,
    '',
    ['#זוהר', kind === 'iyun' ? '#עיון_בזוהר' : '#העמוד_היומי_בזוהר', parsha && `#פרשת_${parsha.replace(/\s+/g, '_')}`].filter(Boolean).join(' '),
  );
  return lines.join('\n');
}
