// Live read-only access to the real "שיעורים מצולמים" Google Sheet, replacing
// the point-in-time CSV snapshot (data/titles.csv) that needed re-uploading
// by hand every time the user wanted fresh candidates — see lib/titles.js.
//
// CONFIRMED FOR REAL (2026-09-08) before choosing this approach:
//   - No direct filesystem access through the Drive-mapped G:\ folder: a
//     .gsheet file there is a cloud-placeholder reparse point, not real file
//     content — fs.readFileSync on one throws EISDIR even from plain Node,
//     bypassing every wrapper tool.
//   - The sheet is not shared "anyone with the link", so the plain
//     .../export?format=csv endpoint 401s — no publish-to-web needed/possible
//     without changing sharing settings.
// So this uses the Sheets API v4 with OAuth, mirroring lib/youtube.js's
// pattern exactly: same Google Cloud project + OAuth client
// (credentials/youtube_oauth_client.json), a separate token file scoped
// read-only to Sheets (credentials/sheets_token.json, see
// scripts/sheets_auth.mjs) — one extra ~1-minute one-time authorization,
// after which this is fully automatic (refresh_token auto-renews).
import fs from 'node:fs';
import path from 'node:path';
import { google } from 'googleapis';

const CRED_DIR = path.join(process.cwd(), 'credentials');
const TOKEN_FILE = path.join(CRED_DIR, 'sheets_token.json');

function getClient() {
  const clientFile = path.join(CRED_DIR, 'youtube_oauth_client.json'); // same OAuth app as YouTube — separate token/scope below
  if (!fs.existsSync(clientFile)) throw new Error('missing credentials/youtube_oauth_client.json');
  if (!fs.existsSync(TOKEN_FILE)) {
    throw new Error('no Google Sheets token yet — run: node scripts/sheets_auth.mjs');
  }
  const { installed } = JSON.parse(fs.readFileSync(clientFile, 'utf8'));
  const tokens = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
  const oAuth2Client = new google.auth.OAuth2(installed.client_id, installed.client_secret);
  oAuth2Client.setCredentials(tokens);
  return oAuth2Client;
}

// The URL the user gave us has a gid (numeric tab id), but values.get needs
// the tab's *name* in its range — resolve it once and cache it (a tab is
// never going to change its id, only maybe get renamed, which cache-busting
// on process restart is good enough for).
let sheetTitleCache = null; // { spreadsheetId, gid, title }
async function resolveSheetTitle(sheets, spreadsheetId, gid) {
  if (sheetTitleCache && sheetTitleCache.spreadsheetId === spreadsheetId && sheetTitleCache.gid === gid) {
    return sheetTitleCache.title;
  }
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const sheet = meta.data.sheets.find((s) => String(s.properties.sheetId) === String(gid));
  if (!sheet) throw new Error(`no tab with gid=${gid} in spreadsheet ${spreadsheetId}`);
  sheetTitleCache = { spreadsheetId, gid, title: sheet.properties.title };
  return sheet.properties.title;
}

let valuesCache = null; // { at, key, rows } — short TTL: "live" for a human clicking the picker, not a request-per-keystroke hammering
const TTL_MS = 20_000;

// Returns the raw 2D array of cell values — same shape the old CSV parser
// produced — so lib/titles.js's row-building logic (COL indices) works
// unchanged regardless of the source.
export async function fetchSheetValues({ spreadsheetId, gid }) {
  const key = `${spreadsheetId}:${gid}`;
  if (valuesCache && valuesCache.key === key && Date.now() - valuesCache.at < TTL_MS) {
    return valuesCache.rows;
  }
  const auth = getClient();
  const sheets = google.sheets({ version: 'v4', auth });
  const title = await resolveSheetTitle(sheets, spreadsheetId, gid);
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${title}'!A:Q`, // A..Q = columns 0..16, matches lib/titles.js's COL map
    valueRenderOption: 'UNFORMATTED_VALUE', // checkboxes come back as real booleans, not "TRUE"/"FALSE" strings
  });
  const rows = res.data.values || [];
  valuesCache = { at: Date.now(), key, rows };
  return rows;
}
