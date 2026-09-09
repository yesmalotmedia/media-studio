// Loads the "שיעורים מצולמים" Google Forms responses sheet and lists rows the
// user hasn't matched to a video yet, for the picker in app/page.js.
//
// HISTORY (2026-09-06 -> 2026-09-08): first version matched by date-proximity
// to the segment's recording date, since the form has no field tying a row
// to an exact recording. CONFIRMED FOR REAL that was too narrow — most
// recent dates had 0-1 candidates, partly because our copy of the sheet was a
// point-in-time CSV snapshot (data/titles.csv, needed re-uploading by hand to
// refresh), partly because the submission timestamp often lags the actual
// recording by days. The user pointed out the sheet ALREADY has exactly the
// right column for this: column G ("ערוך", under the YouTube group) — a
// checkbox they tick once a row has been matched/edited. So candidates are
// now simply "every row not yet marked ערוך", independent of any date — and
// instead of picking a bare title, the user picks a whole ROW (it carries
// separate titles for YouTube/Facebook/Spotify/website too, for when those
// integrations exist — see lib/store.js addSegments' `title` vs the fields
// captured here). A row already assigned to some segment (seg.titleRowId,
// tracked in our own store) is also excluded, so the same row isn't offered
// twice before the sheet's own ערוך checkbox is manually ticked to match.
//
// LIVE SYNC (2026-09-08): reads the real Google Sheet directly via the
// Sheets API (lib/sheetsSync.js) whenever config.titles.spreadsheetId is
// set, so a fresh form submission shows up within ~20s (the sync's cache
// TTL) with no manual re-export step. Falls back to the static
// data/titles.csv snapshot if that's not configured (or the API call fails)
// so the picker still works during initial OAuth setup.
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from './config.js';
import { readStore } from './store.js';
import { fetchSheetValues } from './sheetsSync.js';

// Minimal RFC4180 CSV parser — handles quoted fields with embedded commas,
// newlines, and "" escaped quotes (Google Sheets exports need this; the
// שם/כותרת/הערות columns routinely contain all three).
function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\r') { /* skip */ }
      else if (c === '\n') { row.push(field); field = ''; rows.push(row); row = []; }
      else field += c;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

// The sheet has a 3-row header — row2 has the real per-column headers, row3
// (under the יוטיוב/פייסבוק/ספוטיפיי/... groups) has כותרת/ערוך/הופץ.
// Columns (0-indexed), CONFIRMED against the real sheet (2026-09-08):
//   0 timestamp (submission time — NOT recording time)
//   1 שם השיעור (series/rabbi identifier)      5 יוטיוב: כותרת   6: ערוך   7: הופץ
//   2 כותרת השיעור (generic lesson title)      8 פייסבוק: כותרת  9: הופץ
//   3 הערות (notes — sometimes a full transcript) 10 ספוטיפיי: כותרת 11: הופץ
//   4 דפי מקורות (source-sheet link)           12 ואטסאפ: כותרת 13: הופץ
//                                               14 אתר: כותרת    15: הופץ
//   16 קישורים לדפי מקורות
const COL = {
  timestamp: 0, series: 1, title: 2, notes: 3, sources: 4,
  youtubeTitle: 5, youtubeEdited: 6, youtubeDistributed: 7,
  facebookTitle: 8, facebookDistributed: 9,
  spotifyTitle: 10, spotifyDistributed: 11,
  whatsappTitle: 12, whatsappDistributed: 13,
  websiteTitle: 14, websiteDistributed: 15,
  sourceLinksExtra: 16,
};
const DATA_START_ROW = 3;

function truthy(v) {
  if (typeof v === 'boolean') return v; // UNFORMATTED_VALUE from the Sheets API gives real booleans for checkboxes
  return String(v || '').trim().toUpperCase() === 'TRUE'; // CSV fallback gives "TRUE"/"FALSE" strings
}

function csvPath() {
  const cfg = loadConfig().titles || {};
  const p = cfg.csvPath || 'data/titles.csv';
  return path.isAbsolute(p) ? p : path.join(process.cwd(), p);
}

// Turns a raw 2D array of cell values (from either source) into row objects.
// Shared so the CSV path and the live-sheet path produce identical shapes.
function rowsFromValues(parsed) {
  const rows = [];
  for (let i = DATA_START_ROW; i < parsed.length; i++) {
    const r = parsed[i] || [];
    const title = String(r[COL.title] || '').trim();
    if (!title) continue; // skip blank/template rows
    const get = (k) => String(r[COL[k]] || '').trim();
    rows.push({
      id: i, // stable within one load — good enough for a UI key
      series: get('series'),
      title,
      notes: get('notes'),
      sources: get('sources'),
      youtubeEdited: truthy(r[COL.youtubeEdited]),
      youtubeTitle: get('youtubeTitle'),
      facebookTitle: get('facebookTitle'),
      spotifyTitle: get('spotifyTitle'),
      whatsappTitle: get('whatsappTitle'),
      websiteTitle: get('websiteTitle'),
    });
  }
  return rows;
}

let csvCache = null; // { mtimeMs, rows }
function loadRowsFromCsv() {
  const file = csvPath();
  if (!fs.existsSync(file)) return [];
  const stat = fs.statSync(file);
  if (csvCache && csvCache.mtimeMs === stat.mtimeMs) return csvCache.rows;
  const rows = rowsFromValues(parseCSV(fs.readFileSync(file, 'utf8')));
  csvCache = { mtimeMs: stat.mtimeMs, rows };
  return rows;
}

// Live sheet when configured (see lib/sheetsSync.js), else the static CSV
// snapshot. A live-fetch failure (token not set up yet, network hiccup, sheet
// briefly unavailable) falls back to the CSV rather than breaking the picker.
async function loadRows() {
  const cfg = loadConfig().titles || {};
  if (cfg.spreadsheetId && cfg.gid != null) {
    try {
      const values = await fetchSheetValues({ spreadsheetId: cfg.spreadsheetId, gid: cfg.gid });
      return rowsFromValues(values);
    } catch (e) {
      console.error('live Sheets fetch failed, falling back to CSV snapshot:', e.message);
    }
  }
  return loadRowsFromCsv();
}

// Every titleRowId already claimed by some segment (any scan/folder) —
// excluded from candidates so the same row isn't offered to two segments.
function usedRowIds() {
  const s = readStore();
  const used = new Set();
  for (const scan of Object.values(s.scans)) {
    for (const seg of scan.segments) {
      if (seg.titleRowId != null) used.add(seg.titleRowId);
    }
  }
  return used;
}

// Rows not yet marked ערוך in the sheet, and not already claimed locally.
export async function listUnmatchedRows() {
  const used = usedRowIds();
  const rows = await loadRows();
  return rows.filter((r) => !r.youtubeEdited && !used.has(r.id));
}

export async function allTitlesLoaded() {
  return (await loadRows()).length;
}
