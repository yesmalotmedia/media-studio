// Renames YouTube playlists per a plan file, or puts the old names back.
//
//   node scripts/rename_playlists.cjs data/playlist-renames/2026-10-05.json
//   node scripts/rename_playlists.cjs data/playlist-renames/2026-10-05.json --revert
//
// Plan file: { renames: [{ ch: 'maalot'|'zohar', id, from, to, items }] }.
// Renaming needs youtube.force-ssl, which the app itself does NOT hold (it only
// has upload/readonly) — so this asks for it once per channel in the browser
// and keeps it in memory only: nothing is written to credentials/.
//
// Safety: refuses a token for the wrong channel; touches only the playlist ids
// in the plan; skips any playlist whose current title isn't the expected one
// (someone renamed it meanwhile); changes only snippet.title (description,
// privacy and the videos themselves are untouched); checks the video count is
// unchanged afterwards. Results go to <plan>.result.json.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { google } = require('googleapis');

const EXPECTED = { maalot: 'UCXGUXEMhk3PaZxep7NVTM5A', zohar: 'UCrWDhDGWajXJ3YX2pMWj1mw' };
const PORT = 53683;
const planFile = process.argv[2];
const revert = process.argv.includes('--revert');
if (!planFile) { console.log('usage: node scripts/rename_playlists.cjs <plan.json> [--revert]'); process.exit(1); }
const { renames } = JSON.parse(fs.readFileSync(planFile, 'utf8'));
const { installed } = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'credentials', 'youtube_oauth_client.json'), 'utf8'));

function authorize(ch) {
  return new Promise((resolve, reject) => {
    const auth = new google.auth.OAuth2(installed.client_id, installed.client_secret, `http://localhost:${PORT}/cb`);
    const url = auth.generateAuthUrl({ scope: ['https://www.googleapis.com/auth/youtube.force-ssl'], prompt: 'consent select_account' });
    const server = http.createServer(async (req, res) => {
      const u = new URL(req.url, `http://localhost:${PORT}`);
      if (u.pathname !== '/cb') { res.end(); return; }
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
      const code = u.searchParams.get('code');
      if (!code) { res.end('cancelled'); server.close(); reject(new Error('cancelled')); return; }
      try {
        const { tokens } = await auth.getToken(code);
        auth.setCredentials(tokens);
        const me = (await google.youtube({ version: 'v3', auth }).channels.list({ part: ['snippet'], mine: true })).data.items?.[0];
        if (me?.id !== EXPECTED[ch]) {
          res.end(`Wrong channel ("${me?.snippet?.title}") - nothing changed. Close this tab.`);
          server.close(); reject(new Error(`wrong channel for ${ch}: ${me?.snippet?.title}`)); return;
        }
        res.end(`OK: ${me.snippet.title}. You can close this tab.`);
        server.close(); resolve(auth);
      } catch (e) { res.end('error: ' + e.message); server.close(); reject(e); }
    });
    server.listen(PORT, () => {
      console.log(`[${ch}] browser opened — choose the channel "${ch === 'zohar' ? 'העמוד היומי בזוהר' : 'ישיבת מעלות'}"`);
      execSync(`start "" "${url}"`, { shell: 'cmd.exe' });
    });
  });
}

(async () => {
  const results = [];
  for (const ch of ['zohar', 'maalot']) {
    const items = renames.filter((r) => r.ch === ch);
    if (!items.length) continue;
    const yt = google.youtube({ version: 'v3', auth: await authorize(ch) });
    for (const r of items) {
      const [expectNow, newTitle] = revert ? [r.to, r.from] : [r.from, r.to];
      const cur = (await yt.playlists.list({ part: ['snippet', 'contentDetails'], id: [r.id] })).data.items?.[0];
      if (!cur) { results.push({ ...r, result: 'missing' }); console.log('  MISSING', r.id); continue; }
      if (cur.snippet.title.trim() === newTitle.trim()) { results.push({ ...r, result: 'already' }); console.log('  already', newTitle); continue; }
      if (cur.snippet.title.trim() !== expectNow.trim()) { results.push({ ...r, result: 'skipped', actualTitle: cur.snippet.title }); console.log('  SKIP (title is now)', cur.snippet.title); continue; }
      const before = cur.contentDetails.itemCount;
      await yt.playlists.update({ part: ['snippet'], requestBody: { id: r.id, snippet: { ...cur.snippet, title: newTitle } } });
      const after = (await yt.playlists.list({ part: ['contentDetails'], id: [r.id] })).data.items?.[0]?.contentDetails.itemCount;
      results.push({ ...r, result: 'renamed', itemsBefore: before, itemsAfter: after });
      console.log(`  renamed (${before}->${after} videos)`, newTitle);
    }
  }
  const out = planFile.replace(/\.json$/, revert ? '.revert-result.json' : '.result.json');
  fs.writeFileSync(out, JSON.stringify({ ranAt: new Date().toISOString(), revert, results }, null, 1), 'utf8');
  const c = results.reduce((a, r) => ((a[r.result] = (a[r.result] || 0) + 1), a), {});
  console.log('DONE', JSON.stringify(c), '->', out);
})().catch((e) => { console.log('ERR', e.message); process.exit(1); });
