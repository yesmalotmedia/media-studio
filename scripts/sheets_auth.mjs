// One-time OAuth authorization for read-only access to the real titles
// Google Sheet (see lib/sheetsSync.js for why this is needed instead of
// reading the Drive-mapped file directly or a publish-to-web CSV link).
//
// Usage:
//   node scripts/sheets_auth.mjs
//
// Saves the resulting token to credentials/sheets_token.json.

import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { google } from 'googleapis';
import { exec } from 'node:child_process';

const CRED_DIR = path.join(process.cwd(), 'credentials');
const clientFile = path.join(CRED_DIR, 'youtube_oauth_client.json'); // reuse the same Google Cloud project/OAuth app as YouTube
if (!fs.existsSync(clientFile)) {
  console.error('Missing', clientFile);
  process.exit(1);
}
const { installed } = JSON.parse(fs.readFileSync(clientFile, 'utf8'));

const PORT = 51790; // different fixed port than youtube_auth.mjs's 51789, so both could theoretically run without clashing
const redirectUri = `http://localhost:${PORT}`;
const oAuth2Client = new google.auth.OAuth2(installed.client_id, installed.client_secret, redirectUri);

const authUrl = oAuth2Client.generateAuthUrl({
  access_type: 'offline', // request a refresh_token, not just a short-lived access token
  prompt: 'consent',
  scope: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
});

console.log('\nOpen this URL and log in as media@yesmalot.co.il (the account that can see the sheet):\n');
console.log(authUrl, '\n');
console.log('Waiting for you to complete the browser flow...\n');

exec(`start "" "${authUrl}"`, () => {});

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, redirectUri);
  const code = url.searchParams.get('code');
  if (!code) {
    res.end('No code received — check the terminal for errors.');
    return;
  }
  res.end('Done — you can close this tab and go back to the terminal.');
  server.close();

  try {
    const { tokens } = await oAuth2Client.getToken(code);
    const outFile = path.join(CRED_DIR, 'sheets_token.json');
    fs.writeFileSync(outFile, JSON.stringify(tokens, null, 2));
    console.log('Saved token to', outFile, '\n✓ Live Sheets sync is now active.');
  } catch (e) {
    console.error('Token exchange failed:', e.message);
  }
});

server.listen(PORT, () => {});
