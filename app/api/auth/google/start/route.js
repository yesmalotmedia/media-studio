// Starts a real, browser-driven OAuth flow — added specifically because
// Google's verification reviewer (2026-09-24) rejected a demo video recorded
// by running scripts/youtube_auth.mjs from a terminal: "Initiating the
// application from a backend environment like Visual Studio Code does not
// satisfy the verification requirements." The CLI scripts still work fine
// for our own day-to-day re-auth needs, but the verification demo video
// specifically needs to show a real click, in a browser, on this app's own
// UI, leading to Google's real consent screen. This route is that click's
// target: it builds the right scope+redirect for whichever connection was
// asked for and 302s the browser straight to Google.
import fs from 'node:fs';
import path from 'node:path';
import { google } from 'googleapis';

const CRED_DIR = path.join(process.cwd(), 'credentials');

const TARGETS = {
  youtube_maalot: { scopes: ['https://www.googleapis.com/auth/youtube.upload', 'https://www.googleapis.com/auth/youtube.readonly'] },
  youtube_zohar: { scopes: ['https://www.googleapis.com/auth/youtube.upload', 'https://www.googleapis.com/auth/youtube.readonly'] },
  sheets: { scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] },
};

export async function GET(req) {
  const url = new URL(req.url);
  const target = url.searchParams.get('target');
  if (!TARGETS[target]) {
    return new Response(`unknown target "${target}" — expected one of: ${Object.keys(TARGETS).join(', ')}`, { status: 400 });
  }

  const clientFile = path.join(CRED_DIR, 'youtube_oauth_client.json');
  if (!fs.existsSync(clientFile)) {
    return new Response('missing credentials/youtube_oauth_client.json on the server', { status: 500 });
  }
  const { installed } = JSON.parse(fs.readFileSync(clientFile, 'utf8'));

  // redirect_uri computed from the actual incoming request's own origin,
  // not hardcoded — Next picks whichever port is free (3000 or 3001) on
  // each restart, so this adapts automatically instead of breaking every
  // time that changes. Google's "installed"/Desktop client type accepts any
  // http://localhost:<port> loopback redirect without pre-registration.
  const redirectUri = `${url.origin}/api/auth/google/callback`;
  const oAuth2Client = new google.auth.OAuth2(installed.client_id, installed.client_secret, redirectUri);

  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: 'offline', // request a refresh_token, not just a short-lived access token
    prompt: 'consent', // always show the real consent screen, even if previously authorized — this IS the demo
    scope: TARGETS[target].scopes,
    state: target, // read back in the callback to know which token file to write and which scope was intended
  });

  return Response.redirect(authUrl, 302);
}
