// Uploads an exported video to the correct YouTube channel, based on the
// segment's own `channel` field (lib/rooms.js default, editable per-segment
// in the review UI — see app/page.js). Each channel has its own OAuth token
// file, obtained once via scripts/youtube_auth.mjs (see credentials/).
import fs from 'node:fs';
import path from 'node:path';
import { google } from 'googleapis';

const CRED_DIR = path.join(process.cwd(), 'credentials');

function loadClientCreds() {
  const file = path.join(CRED_DIR, 'youtube_oauth_client.json');
  const { installed } = JSON.parse(fs.readFileSync(file, 'utf8'));
  return installed;
}

// One client per channel per process, cached by the token FILE'S mtime —
// googleapis' OAuth2Client refreshes its own access_token from the stored
// refresh_token automatically on every call, so no manual access-token
// refresh code is needed. CONFIRMED FOR REAL (2026-09-22): the cache used to
// be unconditional (once built, kept forever for the process's lifetime) —
// after re-running scripts/youtube_auth.mjs to fix an expired/revoked
// refresh_token (invalid_grant), uploads kept failing with the exact same
// invalid_grant for hours, because the live dev server was still holding the
// OLD OAuth2Client object in memory and never looked at the token file
// again. A standalone one-off script (fresh process, no stale cache) picked
// up the new file immediately and worked, which is what made this visible.
// Keying the cache on the file's mtime means a re-auth is picked up on the
// very next call, no server restart needed, while still avoiding a disk read
// on every single upload in the normal case (mtime unchanged).
const clients = {}; // channel -> { mtimeMs, client }
function getClient(channel) {
  const tokenFile = path.join(CRED_DIR, `youtube_token_${channel}.json`);
  if (!fs.existsSync(tokenFile)) {
    throw new Error(`no YouTube token for channel "${channel}" — run: node scripts/youtube_auth.mjs ${channel}`);
  }
  const mtimeMs = fs.statSync(tokenFile).mtimeMs;
  const cached = clients[channel];
  if (cached && cached.mtimeMs === mtimeMs) return cached.client;

  const { client_id, client_secret } = loadClientCreds();
  const tokens = JSON.parse(fs.readFileSync(tokenFile, 'utf8'));
  const oAuth2Client = new google.auth.OAuth2(client_id, client_secret);
  oAuth2Client.setCredentials(tokens);
  clients[channel] = { mtimeMs, client: oAuth2Client };
  return oAuth2Client;
}

// channel: 'maalot' | 'zohar' — never call this for 'internal' (not meant
// for public distribution at all, see lib/rooms.js).
export async function uploadVideo(channel, filePath, { title, description = '', privacyStatus = 'private' } = {}) {
  if (channel === 'internal') throw new Error('channel "internal" is not for distribution — should never reach uploadVideo');
  // CONFIRMED FOR REAL (2026-09-08): fs.createReadStream() on a missing file
  // emits its 'error' EVENT asynchronously, after this call has already
  // returned — that's outside the promise googleapis awaits internally, so
  // it surfaced as an uncaughtException that hung the whole upload job
  // forever instead of failing just this one segment. Check up front so a
  // missing file is a normal, catchable rejection like any other failure.
  if (!fs.existsSync(filePath)) {
    throw new Error(`export file not found on disk: ${filePath}`);
  }
  const auth = getClient(channel);
  const youtube = google.youtube({ version: 'v3', auth });

  const res = await youtube.videos.insert({
    part: ['snippet', 'status'],
    requestBody: {
      snippet: {
        title: title.slice(0, 100), // YouTube's hard title length limit
        description,
        categoryId: '22', // People & Blogs — reasonable default, editable per-video on YouTube later
      },
      status: { privacyStatus, selfDeclaredMadeForKids: false },
    },
    media: { body: fs.createReadStream(filePath) },
  });

  const videoId = res.data.id;
  return { videoId, url: `https://youtu.be/${videoId}` };
}
