// Ticks a lesson's checkboxes in the titles sheet (user, 2026-10-19):
//   G — יוטיוב ערוך:   when the lesson goes into export (app/api/export)
//   H — יוטיוב הופץ:   when the video turns public (lib/publishWatch.js)
//   L — ספוטיפיי הופץ: when the episode is in our podcast feed (lib/podcast.js)
//   P — אתר הופץ:      when the website post is up (lib/publishWatch.js)
// Each one is switched on/off in config.json -> sheetMarks. The user asked
// (2026-10-19) to keep the "הופץ" ticks manual during a trial period — built
// and tested, but off — and only "ערוך" automatic.
// The row is found by series+title (findLessonRow), never by position alone.
import { loadConfig } from './config.js';
import { findLessonRow, writeCell } from './sheetsSync.js';

export const SHEET_COLS = { edited: 'G', youtube: 'H', spotify: 'L', website: 'P' };
const DEFAULTS = { edited: true, youtube: false, spotify: false, website: false };

export const sheetMarkEnabled = (key) => ({ ...DEFAULTS, ...(loadConfig().sheetMarks || {}) })[key] === true;

export async function markSheet(seg, col) {
  const { spreadsheetId, gid } = loadConfig().titles || {};
  const { row } = await findLessonRow({ spreadsheetId, gid, titleRowId: seg.titleRowId, series: seg.series, title: seg.title });
  await writeCell({ spreadsheetId, gid, row, col, value: true });
  return row;
}

// Ticks `key` if that mark is switched on. Never throws: returns the fields to
// store on the segment ({} when off).
export async function markSheetIf(key, seg) {
  if (!sheetMarkEnabled(key)) return {};
  try {
    await markSheet(seg, SHEET_COLS[key]);
    return { [`sheet_${key}`]: true };
  } catch (e) {
    return { [`sheet_${key}_error`]: String(e.message || e) };
  }
}
