// Receives Google's redirect after the user approves (or denies) consent —
// see app/api/auth/google/start/route.js for why this exists at all (the
// verification demo needs a real in-browser OAuth flow, not a CLI script).
// Exchanges the code for tokens and saves them to the exact same
// credentials/*.json files scripts/youtube_auth.mjs and scripts/sheets_auth.mjs
// already use, so nothing downstream (lib/youtube.js, lib/sheetsSync.js)
// needs to know or care which path was used to obtain the token.
import fs from 'node:fs';
import path from 'node:path';
import { google } from 'googleapis';
import { EXPECTED_CHANNELS } from '../../../../../lib/youtube.js';

const CRED_DIR = path.join(process.cwd(), 'credentials');

function page(title, bodyHtml) {
  return new Response(
    `<!doctype html><html dir="rtl" lang="he"><head><meta charset="utf-8"><title>${title}</title>
    <style>body{font-family:system-ui,sans-serif;background:#161616;color:#d4d4d4;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
    .card{background:#232323;border:1px solid #3a3a3a;border-radius:10px;padding:24px 32px;max-width:480px;text-align:center}
    a{color:#58a6ff}</style></head>
    <body><div class="card">${bodyHtml}<p><a href="/">חזרה לאפליקציה</a></p></div></body></html>`,
    { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
  );
}

export async function GET(req) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const target = url.searchParams.get('state');
  const error = url.searchParams.get('error');

  if (error) return page('ההתחברות בוטלה', `<h2>ההתחברות בוטלה</h2><p>${error}</p>`);
  if (!code || !target) return page('שגיאה', `<h2>שגיאה</h2><p>חסר code או state בתשובה מגוגל.</p>`);

  const clientFile = path.join(CRED_DIR, 'youtube_oauth_client.json');
  const { installed } = JSON.parse(fs.readFileSync(clientFile, 'utf8'));
  const redirectUri = `${url.origin}/api/auth/google/callback`; // must exactly match what /start used
  const oAuth2Client = new google.auth.OAuth2(installed.client_id, installed.client_secret, redirectUri);

  let tokens;
  try {
    ({ tokens } = await oAuth2Client.getToken(code));
  } catch (e) {
    return page('שגיאה בהחלפת הקוד', `<h2>שגיאה</h2><p>${String(e.message || e)}</p>`);
  }
  oAuth2Client.setCredentials(tokens);

  if (target === 'sheets') {
    fs.writeFileSync(path.join(CRED_DIR, 'sheets_token.json'), JSON.stringify(tokens, null, 2));
    return page('התחברות הצליחה', `<h2>✓ התחברות ל-Google Sheets הצליחה</h2><p>הטוקן נשמר.</p>`);
  }

  // youtube_maalot / youtube_zohar — verify which channel this token actually
  // grants access to before saving, same check scripts/youtube_auth.mjs does
  // (the account has edit access to both channels; only the picker screen
  // during consent decides which one you actually get).
  // A wrong pick is refused, not saved — see EXPECTED_CHANNELS in lib/youtube.js.
  const channel = target.replace('youtube_', '');
  const expected = EXPECTED_CHANNELS[channel];
  let ch;
  try {
    const youtube = google.youtube({ version: 'v3', auth: oAuth2Client });
    const chRes = await youtube.channels.list({ mine: true, part: ['snippet'] });
    ch = chRes.data.items?.[0];
  } catch (e) {
    return page('שגיאה', `<h2>שגיאה בבדיקת הערוץ</h2><p>${String(e.message || e)}</p><p>הטוקן לא נשמר.</p>`);
  }
  if (!expected || ch?.id !== expected.id) {
    return page('ערוץ שגוי', `<h2 style="color:#ff8080">✗ נבחר ערוץ שגוי — הטוקן לא נשמר</h2>
      <p>נבחר: <b>"${ch?.snippet?.title ?? 'לא ידוע'}"</b> (${ch?.id ?? '—'})</p>
      <p>צריך: <b>"${expected?.title}"</b> (${expected?.id})</p>
      <p><a href="/api/auth/google/start?target=${target}">התחבר שוב</a> ובחר את הערוץ הנכון במסך הבחירה.</p>`);
  }

  fs.writeFileSync(path.join(CRED_DIR, `youtube_token_${channel}.json`), JSON.stringify(tokens, null, 2));
  return page('התחברות הצליחה', `<h2>✓ התחברות ליוטיוב (${channel}) הצליחה</h2><p>מחובר לערוץ הנכון: <b>"${ch.snippet.title}"</b></p>`);
}
