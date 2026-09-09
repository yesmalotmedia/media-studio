// One-time OAuth authorization helper for a single YouTube channel.
//
// media@yesmalot.co.il has edit access to BOTH channels (מעלות + הזוהר), so
// this must be run TWICE — once per channel — even though it's the same
// login. Google's account/channel picker during consent is what actually
// decides which channel the resulting token acts as, so run this, watch for
// the channel-switcher screen in the browser, and pick the right one each
// time. The script verifies which channel it actually got afterward (by
// calling channels.list) instead of just assuming — don't skip reading that
// line.
//
// Usage:
//   node scripts/youtube_auth.mjs maalot
//   node scripts/youtube_auth.mjs zohar
//
// Saves the resulting token to credentials/youtube_token_<label>.json.

import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { google } from 'googleapis';
import { exec } from 'node:child_process';

const label = process.argv[2];
if (!label) {
  console.error('Usage: node scripts/youtube_auth.mjs <label>   (e.g. maalot / zohar)');
  process.exit(1);
}

const CRED_DIR = path.join(process.cwd(), 'credentials');
const clientFile = path.join(CRED_DIR, 'youtube_oauth_client.json');
if (!fs.existsSync(clientFile)) {
  console.error('Missing', clientFile);
  process.exit(1);
}
const { installed } = JSON.parse(fs.readFileSync(clientFile, 'utf8'));

const PORT = 51789; // arbitrary fixed local port — "Desktop app" credentials accept any localhost port
const redirectUri = `http://localhost:${PORT}`;
const oAuth2Client = new google.auth.OAuth2(installed.client_id, installed.client_secret, redirectUri);

const authUrl = oAuth2Client.generateAuthUrl({
  access_type: 'offline', // request a refresh_token, not just a short-lived access token
  prompt: 'consent', // force the account/channel picker every time, even if previously authorized
  scope: [
    'https://www.googleapis.com/auth/youtube.upload',
    'https://www.googleapis.com/auth/youtube.readonly',
  ],
});

console.log('\nOpen this URL, log in as media@yesmalot.co.il, and — important — when it shows a');
console.log('channel picker, choose the channel for "' + label + '":\n');
console.log(authUrl, '\n');
console.log('Waiting for you to complete the browser flow...\n');

// best-effort: try to open it automatically too
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
    oAuth2Client.setCredentials(tokens);

    const outFile = path.join(CRED_DIR, `youtube_token_${label}.json`);
    fs.writeFileSync(outFile, JSON.stringify(tokens, null, 2));
    console.log('Saved token to', outFile);

    // verify which channel this token actually grants access to — don't
    // just assume the picker did what we expected.
    const youtube = google.youtube({ version: 'v3', auth: oAuth2Client });
    const chRes = await youtube.channels.list({ mine: true, part: ['snippet'] });
    const ch = chRes.data.items?.[0];
    if (ch) {
      console.log(`\n✓ This token acts as channel: "${ch.snippet.title}" (id: ${ch.id})`);
      console.log(`  Make sure that matches "${label}" — if not, delete ${outFile} and re-run, picking the right channel.`);
    } else {
      console.log('\n⚠ Could not read back a channel for this token — something may be off.');
    }
  } catch (e) {
    console.error('Token exchange failed:', e.message);
  }
});

server.listen(PORT, () => {});
