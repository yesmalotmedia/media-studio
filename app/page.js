'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import { CHANNELS } from '../lib/rooms.js';

// palette pulled from an actual DaVinci Resolve screenshot (2026-09-03):
// near-black warm-gray chrome, vivid red playhead/accent, green audio clips.
const c = {
  card: { background: '#232323', border: '1px solid #3a3a3a', borderRadius: 10, marginBottom: 10 },
  input: { padding: '8px 10px', borderRadius: 6, border: '1px solid #3a3a3a', background: '#161616', color: '#d4d4d4', boxSizing: 'border-box' },
  btn: { padding: '7px 14px', borderRadius: 6, border: '1px solid #3a3a3a', background: '#2a2a2a', color: '#d4d4d4', cursor: 'pointer', fontSize: 13 },
  btnP: { padding: '7px 14px', borderRadius: 6, border: 'none', background: '#238636', color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 600 },
  btnDanger: { padding: '7px 14px', borderRadius: 6, border: '1px solid #6e2c2c', background: '#2a1416', color: '#ff8080', cursor: 'pointer', fontSize: 13, fontWeight: 600 },
};
const RESOLVE_RED = '#e8442d'; // Resolve's accent/playhead red
const CONF = { green: '#3fb950', yellow: '#d29922' };
const STAT = { detected: 'זוהה', approved: 'אושר', rejected: 'נדחה' };

// how much context to show around a segment in the editor's waveform/timeline
const MARGIN = 90;

function fmt(t) {
  if (!isFinite(t)) t = 0;
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = Math.floor(t % 60);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(h)}:${p(m)}:${p(s)}`;
}
// matches app/api/export/route.js's fmtHMS exactly — used only to recognize
// exportState.job.current (built from that same format) for a given
// segment, to show a per-row "exporting now" badge instead of one global line.
function fmtHMS(t) {
  t = Math.max(0, Math.round(t));
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), sec = t % 60;
  return [h, m, sec].map((n) => String(n).padStart(2, '0')).join('-');
}
// parse "HH:MM:SS" (or "MM:SS") back to seconds; null if not parseable
function parseT(str) {
  const parts = String(str).trim().split(':').map(Number);
  if (parts.some((n) => !isFinite(n))) return null;
  let sec = 0;
  for (const p of parts) sec = sec * 60 + p;
  return sec;
}
// a "nice" tick spacing (1/2/5/10/15/30s, 1/2/5/10/15/30min, 1h…) for a ruler
// showing roughly `targetCount` labels across a span of `spanSec` seconds.
const TICK_STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200];
function niceTickStep(spanSec, targetCount = 6) {
  const raw = spanSec / targetCount;
  return TICK_STEPS.find((s) => s >= raw) || TICK_STEPS[TICK_STEPS.length - 1];
}

export default function Home() {
  const [folder, setFolder] = useState('');
  const [scan, setScan] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [polling, setPolling] = useState(false);
  const [calib, setCalib] = useState(null);
  const [exportState, setExportState] = useState(null); // { job, pending }
  const [youtubeState, setYoutubeState] = useState(null); // { job, pendingToday }
  // auto-ingest: segments that arrived automatically (watcher copied a new
  // camera file off \\Servermedia and scanned it) live in a SEPARATE scan
  // folder from whatever's typed in the box above (which stays available for
  // manual/ad-hoc scans, e.g. the `test` folder) — fetched independently and
  // merged into one list below so nothing needs to be typed to see them.
  const [ingestInfo, setIngestInfo] = useState(null); // { folder, enabled, files }
  const [ingestScan, setIngestScan] = useState(null);

  const refresh = useCallback(async (f) => {
    const r = await fetch(`/api/scan?folder=${encodeURIComponent(f || folder)}`);
    const d = await r.json();
    if (d.folder && !folder) setFolder(d.folder);
    setScan(d.scan);
    return d.scan;
  }, [folder]);

  const refreshIngest = useCallback(async () => {
    const info = await fetch('/api/ingest').then((r) => r.json()).catch(() => null);
    if (!info) return null;
    setIngestInfo(info);
    const r = await fetch(`/api/scan?folder=${encodeURIComponent(info.folder)}`);
    const d = await r.json();
    setIngestScan(d.scan);
    return d.scan;
  }, []);

  const refreshCalib = useCallback(() => {
    fetch('/api/calibration').then((r) => r.json()).then(setCalib).catch(() => {});
  }, []);

  const [deletingRaw, setDeletingRaw] = useState(null); // sourcePath currently being deleted, for a per-row "מוחק…" state
  async function deleteRawCopy(sourcePath) {
    // confirm — this can't be undone automatically (see DELETE /api/ingest):
    // the original on \\Servermedia is never touched, but OUR local copy is
    // gone for good and won't re-download on its own once marked 'deleted'.
    if (!window.confirm(`למחוק את ההעתק המקומי של "${sourcePath.split(/[\\/]/).pop()}"?\n\nהקובץ המקורי בשרת לא נפגע. אבל אם תתחרט, ההעתק המקומי לא יחזור אוטומטית — תצטרך לבקש שחזור ידני.`)) return;
    setDeletingRaw(sourcePath);
    await fetch('/api/ingest', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sourcePath }) });
    setDeletingRaw(null);
    refreshIngest();
  }

  const refreshExport = useCallback(async () => {
    const d = await fetch('/api/export').then((r) => r.json()).catch(() => null);
    if (d) setExportState(d);
    return d;
  }, []);

  const refreshYoutube = useCallback(async () => {
    const d = await fetch('/api/youtube-upload').then((r) => r.json()).catch(() => null);
    if (d) setYoutubeState(d);
    return d;
  }, []);

  useEffect(() => { refresh(); refreshCalib(); refreshExport(); refreshIngest(); refreshYoutube(); }, []); // initial

  // the auto-ingest watcher runs on its own schedule in the background (not
  // triggered by anything the user clicks) — poll its status/segments
  // periodically so newly-arrived lessons show up without a manual refresh.
  useEffect(() => {
    const iv = setInterval(refreshIngest, 15000);
    return () => clearInterval(iv);
  }, [refreshIngest]);

  // poll while scanning
  useEffect(() => {
    if (!polling) return;
    const iv = setInterval(async () => {
      const s = await refresh();
      if (s && s.files && s.files.every((f) => f.status === 'done' || f.status === 'error')) {
        setPolling(false);
      }
    }, 2000);
    return () => clearInterval(iv);
  }, [polling, refresh]);

  // poll while exporting
  useEffect(() => {
    if (!exportState?.job?.running) return;
    const iv = setInterval(async () => {
      const d = await refreshExport();
      if (!d?.job?.running) { refresh(); refreshYoutube(); }
    }, 2000);
    return () => clearInterval(iv);
  }, [exportState?.job?.running, refreshExport, refresh, refreshYoutube]);

  // poll while catching-up on YouTube uploads
  useEffect(() => {
    if (!youtubeState?.job?.running) return;
    const iv = setInterval(async () => {
      const d = await refreshYoutube();
      if (!d?.job?.running) { refresh(); }
    }, 2000);
    return () => clearInterval(iv);
  }, [youtubeState?.job?.running, refreshYoutube, refresh]);

  async function startYoutubeUpload() {
    await fetch('/api/youtube-upload', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
    refreshYoutube();
  }

  async function startScan() {
    setScan(null);
    await fetch('/api/scan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ folder }) });
    setPolling(true);
    refresh();
  }

  async function startExport() {
    await fetch('/api/export', { method: 'POST' });
    refreshExport();
  }

  async function setStatus(id, status, folderOverride) {
    await fetch('/api/segment', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ folder: folderOverride || folder, id, patch: { status } }) });
    await Promise.all([refresh(), refreshIngest()]);
  }

  // unified list: manually-scanned segments (whatever's in the folder box)
  // plus auto-ingested ones (from the background watcher) — each tagged with
  // which folder it actually lives under, since that's what /api/segment
  // needs to find the right scan record.
  const segs = [
    ...(ingestScan?.segments || []).map((s) => ({ ...s, _folder: ingestScan.folder })),
    ...(scan?.segments || []).map((s) => ({ ...s, _folder: scan.folder || folder })),
  ];
  const files = scan?.files || [];
  const scanning = files.some((f) => f.status === 'scanning' || f.status === 'pending');
  const counts = segs.reduce((a, s) => { a[s.status] = (a[s.status] || 0) + 1; return a; }, {});
  // What's actually shown in the review list: rejected disappears the moment
  // you reject it (not just faded), and an approved segment drops out once
  // its export is fully done — nothing left to act on. An approved segment
  // still mid-export (or queued for one) stays visible so its per-row
  // progress badge (see below) is meaningful. counts/summary line above still
  // reflect the full history, only the list itself is filtered.
  const visibleSegs = segs.filter((s) =>
    s.status === 'detected' || (s.status === 'approved' && s.exportStatus !== 'done')
  );

  // after approve/reject in the editor: jump straight to the next pending
  // segment so a full review pass needs no extra clicks between items.
  // refreshes first — the editor's own save() talks to the API directly
  // (not through setStatus below), so our local `segs` can be stale here.
  async function goNext(currentId) {
    const [freshScan, freshIngestScan] = await Promise.all([refresh(), refreshIngest()]);
    const freshSegs = [
      ...(freshIngestScan?.segments || []).map((s) => ({ ...s, _folder: freshIngestScan.folder })),
      ...(freshScan?.segments || []).map((s) => ({ ...s, _folder: freshScan.folder || folder })),
    ];
    const i = freshSegs.findIndex((s) => s.id === currentId);
    const next = freshSegs.slice(i + 1).find((s) => s.status === 'detected');
    setOpenId(next ? next.id : null);
    refreshCalib();
    refreshExport();
  }

  async function quickReject(e, s) {
    e.stopPropagation();
    await setStatus(s.id, s.status === 'rejected' ? 'detected' : 'rejected', s._folder);
  }

  // destination channel (יוטיוב/ספוטיפיי/אתר בהמשך) — pre-filled with a
  // room-based guess (lib/rooms.js) but always a real per-segment choice the
  // user can correct here, since rooms mix content from both orgs.
  async function setChannel(e, s, channel) {
    e.stopPropagation();
    await fetch('/api/segment', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ folder: s._folder, id: s.id, patch: { channel } }) });
    await Promise.all([refresh(), refreshIngest()]);
  }

  // title picker (lib/titles.js) — the titles form has no field tying a row
  // to an exact recording, so — per the user (2026-09-08) — candidates are
  // instead every row not yet marked ערוך (the checkbox they already use in
  // the sheet for "already matched/edited"), independent of any date. The
  // user picks a whole ROW, not a bare title string, since a row also
  // carries separate titles for Facebook/Spotify/website (see lib/titles.js)
  // for when those integrations exist.
  const [titlePickerFor, setTitlePickerFor] = useState(null);
  const [titleCandidates, setTitleCandidates] = useState(null); // null=loading, []=none found
  async function openTitlePicker(e, s) {
    e.stopPropagation();
    if (titlePickerFor === s.id) { setTitlePickerFor(null); return; }
    setTitlePickerFor(s.id);
    setTitleCandidates(null);
    const d = await fetch('/api/titles').then((r) => r.json()).catch(() => null);
    setTitleCandidates(d?.candidates || []);
  }
  async function pickTitle(e, s, cand) {
    e.stopPropagation();
    await fetch('/api/segment', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
      folder: s._folder, id: s.id, patch: {
        title: cand.title, notes: cand.notes, series: cand.series, titleRowId: cand.id,
        youtubeTitle: cand.youtubeTitle, facebookTitle: cand.facebookTitle,
        spotifyTitle: cand.spotifyTitle, whatsappTitle: cand.whatsappTitle, websiteTitle: cand.websiteTitle,
      },
    }) });
    setTitlePickerFor(null);
    await Promise.all([refresh(), refreshIngest()]);
  }

  return (
    <main style={{ maxWidth: 1000, margin: '0 auto', padding: 20 }}>
      <h1 style={{ fontSize: 22, marginBottom: 4 }}>סטודיו שיעורים — זיהוי וחיתוך</h1>
      <p style={{ color: '#8b949e', marginTop: 0, fontSize: 14 }}>הזן תיקייה, סרוק, ועבור על החיתוכים שזוהו. לחיצה על שיעור פותחת אותו לעריכה.</p>
      {calib && calib.total > 0 && (
        <p style={{ color: '#6e7681', marginTop: -6, fontSize: 12 }}>
          {calib.n >= 15
            ? <>🧠 המערכת למדה מ-{calib.total} אישורים: התחלה מוזזת ב-{calib.startBiasSec >= 0 ? '+' : ''}{calib.startBiasSec} שנ׳, סוף ב-{calib.endBiasSec >= 0 ? '+' : ''}{calib.endBiasSec} שנ׳ (חציון {calib.n} אחרונים) — פעיל בסריקה הבאה.</>
            : <>📊 נאספו {calib.total} תיקונים ({calib.n} רלוונטיים) — עדיין לא מספיק כדי להחיל הזזה גלובלית בבטחה (דרושים 15+). לא משפיע על סריקות עדיין.</>}
        </p>
      )}

      <div style={{ ...c.card, padding: 12, display: 'flex', gap: 8 }}>
        <input style={{ ...c.input, flex: 1 }} dir="ltr" placeholder="\\\\Servermedia\\הקלטות\\test" value={folder}
          onChange={(e) => setFolder(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && startScan()} />
        <button style={c.btnP} onClick={startScan}>סרוק תיקייה</button>
      </div>

      {ingestInfo && ingestInfo.enabled && (() => {
        // Only show what's still actionable/in-progress — a 'copied' file
        // that actually found segments is already visible in the list below,
        // and an 'error' that's exhausted all retries (see lib/ingest.js) is
        // a dead end. Without this filter the box grows forever with
        // hours-old resolved entries mixed in with what's actually happening
        // right now. A 'copied'-with-zero-segments file is handled in its
        // OWN box below instead (see comment there) — it's not "resolved",
        // it's a case cleanupExported() will never touch on its own.
        const relevant = Object.entries(ingestInfo.files || {}).filter(([, f]) =>
          !['copied', 'gone', 'deleted'].includes(f.status) && !(f.status === 'error' && (f.errorCount || 0) >= 5)
        );
        if (relevant.length === 0) return null;
        return (
          <div style={{ ...c.card, padding: 12, fontSize: 13, color: '#8b949e' }}>
            <div style={{ marginBottom: 4 }}>קליטה אוטומטית מ-\\Servermedia\הקלטות:</div>
            {relevant.map(([p, f]) => (
              <span key={p} style={{ marginLeft: 10, display: 'inline-block', marginBottom: 2 }}
                title={f.error || ''}>
                {f.status === 'error' ? '✗' : f.status === 'copying' ? '📥' : f.status === 'scanning' ? '⏳' : '👁'} {p.split(/[\\/]/).pop()}
                {f.status === 'watching' && <span style={{ color: '#6e7681' }}> (ממתין לסיום הקלטה)</span>}
                {f.status === 'error' && <span style={{ color: '#ff8080' }}> (מנסה שוב… {f.errorCount || 1}/5)</span>}
              </span>
            ))}
          </div>
        );
      })()}

      {ingestInfo && ingestInfo.enabled && (() => {
        // Files fully scanned with ZERO segments detected (e.g. "מבקשי
        // פניך" — an internal room whose audio often never crosses the VAD
        // threshold at all) — CONFIRMED FOR REAL (2026-09-08): these sat
        // invisible forever, since the box above hides 'copied' entirely and
        // cleanupExported() deliberately never auto-deletes a 0-segment file
        // (nothing was ever detected to judge "done" from). Per the user:
        // don't auto-delete — surface it and let them explicitly mark it for
        // deletion instead (see DELETE /api/ingest).
        const empty = Object.entries(ingestInfo.files || {}).filter(([, f]) => f.status === 'copied' && !f.segmentCount);
        if (empty.length === 0) return null;
        return (
          <div style={{ ...c.card, padding: 12, fontSize: 13 }}>
            <div style={{ marginBottom: 6, color: '#8b949e' }}>נסרקו במלואן ולא נמצא בהן אף שיעור — ההעתק המקומי עדיין תופס מקום בדיסק:</div>
            {empty.map(([p, f]) => (
              <div key={p} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <span style={{ flex: 1 }}>👁 {p.split(/[\\/]/).pop()}</span>
                <button style={{ ...c.btn, padding: '2px 10px', fontSize: 12 }} disabled={deletingRaw === p} onClick={() => deleteRawCopy(p)}>
                  {deletingRaw === p ? 'מוחק…' : 'מחק העתק מקומי'}
                </button>
              </div>
            ))}
          </div>
        );
      })()}

      {files.length > 0 && (
        <div style={{ ...c.card, padding: 12, fontSize: 13, color: '#8b949e' }}>
          קבצים: {files.map((f) => (
            <span key={f.path} style={{ marginLeft: 10 }}>
              {f.status === 'done' ? '✓' : f.status === 'scanning' ? '⏳' : f.status === 'error' ? '✗' : '·'} {f.path.split(/[\\/]/).pop()}
            </span>
          ))}
          {scanning && <div style={{ marginTop: 6, color: '#58a6ff' }}>סורק… ({files.filter(f => f.status === 'done').length}/{files.length})</div>}
        </div>
      )}

      {segs.length > 0 && (
        <div style={{ display: 'flex', gap: 14, margin: '8px 2px 14px', fontSize: 13 }}>
          <span style={{ color: '#8b949e' }}>סה״כ: <b>{segs.length}</b></span>
          <span style={{ color: CONF.green }}>אושרו: <b>{counts.approved || 0}</b></span>
          <span style={{ color: RESOLVE_RED }}>נדחו: <b>{counts.rejected || 0}</b></span>
          <span style={{ color: '#8b949e' }}>ממתינים: <b>{counts.detected || 0}</b></span>
        </div>
      )}

      {(exportState?.pending > 0 || exportState?.job?.running) && (
        <div style={{ ...c.card, padding: 12 }}>
          {exportState?.job?.running ? (
            <div style={{ color: '#58a6ff', fontSize: 13 }}>
              מייצא ({exportState.job.done}/{exportState.job.total})… {exportState.job.current}
              <div style={{ fontSize: 11, color: '#6e7681', marginTop: 4 }}>חיתוך + קרופ אוטומטי + ביטול הד (Clear) + נורמליזציה + פייד.</div>
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 13 }}>{exportState.pending} שיעורים מאושרים ממתינים לייצוא</span>
              <button style={c.btnP} onClick={startExport}>ייצא את כל המאושרים</button>
            </div>
          )}
          {exportState?.job && !exportState.job.running && exportState.job.errors?.length > 0 && (
            <div style={{ marginTop: 8, fontSize: 12, color: '#ff8080' }}>
              {exportState.job.errors.length} שגיאות ייצוא: {exportState.job.errors.map((e) => e.source).join(', ')}
            </div>
          )}
        </div>
      )}

      {(youtubeState?.pendingToday > 0 || youtubeState?.job?.running) && (
        <div style={{ ...c.card, padding: 12 }}>
          {youtubeState?.job?.running ? (
            <div style={{ color: '#58a6ff', fontSize: 13 }}>
              מעלה ליוטיוב ({youtubeState.job.done}/{youtubeState.job.total})… {youtubeState.job.current}
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 13 }}>{youtubeState.pendingToday} שיעורים שיוצאו היום וממתינים להעלאה ליוטיוב</span>
              <button style={c.btnP} onClick={startYoutubeUpload}>העלה ליוטיוב</button>
            </div>
          )}
          {youtubeState?.job && !youtubeState.job.running && youtubeState.job.errors?.length > 0 && (
            <div style={{ marginTop: 8, fontSize: 12, color: '#ff8080' }}>
              {youtubeState.job.errors.length} שגיאות העלאה: {youtubeState.job.errors.map((e) => e.source).join(', ')}
            </div>
          )}
        </div>
      )}

      {visibleSegs.map((s) => (
        <div key={s.id} style={{ ...c.card, opacity: s.status === 'rejected' ? 0.5 : 1 }}>
          <div style={{ display: 'flex', gap: 12, padding: 12, alignItems: 'center', cursor: 'pointer' }}
            onClick={() => setOpenId(openId === s.id ? null : s.id)}>
            <div style={{ position: 'relative', flexShrink: 0 }}>
              <img src={`/api/thumb/${s.sourceId}?t=${Math.round(s.start + 3)}`} alt=""
                style={{ width: 130, height: 73, objectFit: 'cover', borderRadius: 6, background: '#161616', display: 'block' }} />
              {s.status === 'approved' && (
                <span style={{ position: 'absolute', top: 4, insetInlineStart: 4, background: 'rgba(35,134,54,0.9)', color: '#fff', borderRadius: 4, fontSize: 11, padding: '1px 5px' }}>✓ אושר</span>
              )}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                <span style={{ fontSize: 14, fontWeight: 500 }}>{s.sourceName}</span>
                <span style={{ fontSize: 12, color: CONF[s.confidence] || '#8b949e' }}>●</span>
                <span style={{ fontSize: 12, color: '#8b949e' }}>{STAT[s.status]}</span>
                <select value={s.channel || 'maalot'} onClick={(e) => e.stopPropagation()}
                  onChange={(e) => setChannel(e, s, e.target.value)}
                  style={{ ...c.input, padding: '2px 6px', fontSize: 12 }}>
                  {Object.entries(CHANNELS).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                </select>
              </div>
              <div style={{ fontSize: 13, color: '#8b949e' }}>{fmt(s.start)} → {fmt(s.end)} · אורך {fmt(s.length)}
                {s.exportStatus === 'done' && <span style={{ color: CONF.green, marginRight: 8 }}>· יוצא ✓</span>}
                {s.exportStatus === 'error' && <span style={{ color: '#ff8080', marginRight: 8 }} title={s.exportError}>· שגיאת ייצוא</span>}
                {s.status === 'approved' && !s.exportStatus && (
                  exportState?.job?.current === `${s.sourceName} ${fmtHMS(s.start)}`
                    ? <span style={{ color: '#58a6ff', marginRight: 8 }}>· ⏳ מייצא כרגע…</span>
                    : exportState?.job?.running
                      ? <span style={{ color: '#6e7681', marginRight: 8 }}>· בתור לייצוא</span>
                      : <span style={{ color: '#6e7681', marginRight: 8 }}>· ממתין לייצוא</span>
                )}
                {s.uploadStatus === 'done' && (
                  <a href={s.youtubeUrl} target="_blank" rel="noreferrer" style={{ color: CONF.green, marginRight: 8 }} onClick={(e) => e.stopPropagation()}>· עלה ליוטיוב ✓</a>
                )}
                {s.uploadStatus === 'error' && <span style={{ color: '#ff8080', marginRight: 8 }} title={s.uploadError}>· שגיאת העלאה</span>}
              </div>
              <div style={{ marginTop: 4 }}>
                {s.title ? (
                  <span style={{ fontSize: 13, color: '#d4d4d4' }}>
                    📝 {s.title}
                    <button style={{ ...c.btn, padding: '1px 8px', fontSize: 11, marginRight: 6 }} onClick={(e) => openTitlePicker(e, s)}>שנה</button>
                  </span>
                ) : (
                  <button style={{ ...c.btn, padding: '2px 10px', fontSize: 12 }} onClick={(e) => openTitlePicker(e, s)}>בחר כותרת מהטופס</button>
                )}
              </div>
              {titlePickerFor === s.id && (
                <div onClick={(e) => e.stopPropagation()} style={{ marginTop: 8, background: '#161616', border: '1px solid #3a3a3a', borderRadius: 6, padding: 8, maxHeight: 220, overflowY: 'auto' }}>
                  {titleCandidates === null && <div style={{ fontSize: 12, color: '#8b949e' }}>טוען מועמדים…</div>}
                  {titleCandidates?.length === 0 && (
                    <div style={{ fontSize: 12, color: '#8b949e' }}>
                      אין שורות בטבלה שעדיין לא סומנו "ערוך" (עמודה G) — או שכל השורות הפנויות כבר שויכו לשיעורים אחרים.
                    </div>
                  )}
                  {titleCandidates?.map((cand) => (
                    <div key={cand.id} onClick={(e) => pickTitle(e, s, cand)}
                      style={{ padding: '6px 8px', borderRadius: 4, cursor: 'pointer', marginBottom: 4, border: '1px solid transparent' }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = '#232323'; e.currentTarget.style.borderColor = '#3a3a3a'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.borderColor = 'transparent'; }}>
                      <div style={{ fontSize: 13, fontWeight: 500 }}>{cand.title}</div>
                      <div style={{ fontSize: 11, color: '#8b949e' }}>{cand.series}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <button style={{ ...c.btn, flexShrink: 0, color: s.status === 'rejected' ? '#8b949e' : '#ff8080', borderColor: s.status === 'rejected' ? '#3a3a3a' : '#6e2c2c' }}
              onClick={(e) => quickReject(e, s)}>
              {s.status === 'rejected' ? 'בטל דחייה' : 'מחק'}
            </button>
          </div>
          {openId === s.id && <Editor folder={s._folder} seg={s} siblings={segs} onStatus={setStatus} onDone={() => goNext(s.id)} />}
        </div>
      ))}

      {!scanning && segs.length === 0 && scan && <p style={{ color: '#8b949e' }}>לא זוהו חיתוכים. אם זה שגוי, נכייל את הספים.</p>}
    </main>
  );
}

function Editor({ folder, seg, siblings = [], onStatus, onDone }) {
  const vidRef = useRef(null);
  const [wf, setWf] = useState(null);
  const [cur, setCur] = useState(seg.start);
  const [inP, setInP] = useState(seg.start);
  const [outP, setOutP] = useState(seg.end);
  const [inText, setInText] = useState(fmt(seg.start));
  const [outText, setOutText] = useState(fmt(seg.end));
  const [status, setStatusMsg] = useState('');
  const [loop, setLoop] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false); // true while a background refine fetch is in flight

  // Two different ranges, deliberately kept separate:
  //  - winStart/winEnd: the PANNABLE universe — the whole source file, known
  //    immediately (the fast ±MARGIN fetch's response already carries the
  //    file's total duration), so you can pan/zoom out past this segment's
  //    own boundaries right away, no separate "expand" step needed.
  //  - loadedStart/loadedEnd: what wf.peaks *actually* covers right now —
  //    starts as just ±MARGIN for a fast first paint; the refine effect
  //    below fetches more (wider or higher-res) on demand as you pan/zoom.
  const fileDuration = wf?.duration ?? (seg.end + MARGIN);
  const winStart = 0;
  const winEnd = fileDuration;

  const loadedStart = wf?.rangeStart ?? Math.max(0, seg.start - MARGIN);
  const loadedEnd = wf?.rangeEnd ?? (seg.end + MARGIN);
  const loadedDur = Math.max(1, loadedEnd - loadedStart);

  // the currently DISPLAYED slice — lets you zoom the timeline in for
  // frame-level precision instead of always seeing the whole ±MARGIN
  // window. null until wf loads, meaning "show the ±MARGIN default".
  const [view, setView] = useState(null);
  const viewStart = view?.start ?? loadedStart;
  const viewEnd = view?.end ?? loadedEnd;
  const viewDur = Math.max(0.5, viewEnd - viewStart);

  useEffect(() => {
    const reqStart = Math.max(0, seg.start - MARGIN);
    const reqEnd = seg.end + MARGIN;
    fetch(`/api/analyze/${seg.sourceId}?start=${reqStart}&end=${reqEnd}`).then((r) => r.json()).then((d) => {
      setWf(d);
      setView({ start: d.rangeStart ?? reqStart, end: d.rangeEnd ?? reqEnd });
    });
  }, [seg.sourceId, seg.start, seg.end]);

  // jump the view out to the whole file in one step — for when detection
  // split one lesson into pieces: zoom out past this segment's own
  // boundaries, drag the trim across into what used to be a separate
  // (wrongly split-off) segment, and fix it by hand in seconds. The refine
  // effect below fetches the actual waveform detail for wherever you land.
  function expandToFile() {
    setView({ start: 0, end: fileDuration });
  }

  // whenever the view needs data the current wf.peaks doesn't actually
  // cover — either it's not loaded at this resolution (e.g. still just the
  // narrow initial ±MARGIN fetch, or a stale wide-but-blocky load from
  // before a zoom-in — 1000 points over a whole multi-hour file is
  // ~20s/peak, so a zoomed-in waveform would just be the same blocky data
  // stretched wide, not really reflecting the audio), or the view has
  // panned/zoomed outside what's loaded at all — silently re-fetch a
  // properly scoped window around the current view in the background.
  const refineTimer = useRef(null);
  useEffect(() => {
    if (!wf) return;
    const loadedResolution = loadedDur / wf.peaks.length; // seconds per peak, currently loaded
    const neededResolution = viewDur / 1000; // want ~1000 peaks across what's on screen
    const outOfCoverage = viewStart < loadedStart - 0.5 || viewEnd > loadedEnd + 0.5;
    const tooCoarse = loadedResolution > neededResolution * 3;
    if (!outOfCoverage && !tooCoarse) return; // already good enough
    if (refineTimer.current) clearTimeout(refineTimer.current);
    refineTimer.current = setTimeout(() => {
      const margin = viewDur; // fetch a bit wider than the current view so a little more panning/zooming doesn't immediately refetch again
      const reqStart = Math.max(0, viewStart - margin);
      const reqEnd = Math.min(fileDuration, viewEnd + margin);
      setLoadingMore(true);
      fetch(`/api/analyze/${seg.sourceId}?start=${reqStart}&end=${reqEnd}`).then((r) => r.json())
        .then((d) => setWf((prev) => ({ ...d, duration: prev?.duration ?? d.duration })))
        .finally(() => setLoadingMore(false));
    }, 250); // debounce — don't refetch on every single wheel tick while zooming
    return () => { if (refineTimer.current) clearTimeout(refineTimer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewStart, viewEnd]);

  // zoom the timeline in/out around a given time (mouse-wheel or +/- buttons),
  // like a professional NLE timeline — factor <1 narrows (zoom in), >1 widens.
  const zoomAt = useCallback((centerT, factor) => {
    setView((v) => {
      const s = v?.start ?? loadedStart, e = v?.end ?? loadedEnd;
      const dur = e - s;
      const newDur = Math.max(1, Math.min(winEnd - winStart, dur * factor));
      let ns = centerT - (centerT - s) * (newDur / dur);
      let ne = ns + newDur;
      if (ns < winStart) { ns = winStart; ne = ns + newDur; }
      if (ne > winEnd) { ne = winEnd; ns = ne - newDur; }
      return { start: ns, end: ne };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [winStart, winEnd]);

  // keep the playhead in view while zoomed in and scrubbing/playing past
  // the visible edge — auto-pans the timeline like a real NLE.
  //
  // isDragging guards against a real race with the timeline drag-scrub
  // below: dragging updates `view` synchronously on every mousemove, but
  // `cur` only catches up later (asynchronously, via the video element's
  // own timeupdate event after currentTime is written on the next animation
  // frame). In that gap, this effect would see a stale `cur` that looks
  // "outside" the already-moved `view` and yank the view again — fighting
  // the drag and producing exactly the jumpy/unstable feel reported.
  const isDragging = useRef(false);
  useEffect(() => {
    if (!view || isDragging.current) return;
    if (cur < view.start || cur > view.end) {
      const span = view.end - view.start;
      let s = cur - span / 2, e = cur + span / 2;
      if (s < winStart) { s = winStart; e = s + span; }
      if (e > winEnd) { e = winEnd; s = e - span; }
      setView({ start: s, end: e });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cur]);

  useEffect(() => { setInText(fmt(inP)); }, [inP]);
  useEffect(() => { setOutText(fmt(outP)); }, [outP]);

  // --- J/K/L shuttle, like DaVinci Resolve/Premiere/Avid ---
  // L = play forward, tap again to speed up (1x→2x→4x…). J = same in
  // reverse (native <video> can't play backward, so reverse is driven by
  // a rAF loop stepping currentTime back manually). K = stop.
  const [shuttle, setShuttleState] = useState(0);
  const shuttleRef = useRef(0);
  const reverseRaf = useRef(null);
  const reverseLast = useRef(0);

  const stepReverse = useCallback((now) => {
    if (shuttleRef.current >= 0) { reverseRaf.current = null; return; }
    const dt = Math.min(0.1, (now - reverseLast.current) / 1000); // clamp: same stall-guard as arrow scrubbing
    reverseLast.current = now;
    const v = vidRef.current;
    if (v) v.currentTime = Math.max(0, v.currentTime + shuttleRef.current * dt);
    reverseRaf.current = requestAnimationFrame(stepReverse);
  }, []);

  const setShuttle = useCallback((next) => {
    next = Math.max(-16, Math.min(16, next));
    shuttleRef.current = next;
    setShuttleState(next);
    const v = vidRef.current; if (!v) return;
    if (next === 0) {
      v.pause();
      v.playbackRate = 1;
      if (reverseRaf.current != null) { cancelAnimationFrame(reverseRaf.current); reverseRaf.current = null; }
    } else if (next > 0) {
      if (reverseRaf.current != null) { cancelAnimationFrame(reverseRaf.current); reverseRaf.current = null; }
      v.playbackRate = next;
      v.play().catch(() => {});
    } else {
      v.pause();
      reverseLast.current = performance.now();
      if (reverseRaf.current == null) reverseRaf.current = requestAnimationFrame(stepReverse);
    }
  }, [stepReverse]);

  // no upper clamp needed: the browser itself clamps currentTime to the
  // media's real seekable range, so this can't get stuck on a stale/0 dur.
  const seek = useCallback((t) => {
    setShuttle(0); // any direct seek (click, Home/End…) hands control back from shuttle/scrub
    const v = vidRef.current; if (!v) return;
    v.currentTime = Math.max(0, t);
  }, [setShuttle]);

  // --- arrow-key scrubbing: tap = 1 second, hold = accelerates ---
  // a single press moves exactly 1 second. keep holding and the speed
  // doubles every second held (smooth, not steppy — the formula is
  // continuous so it doesn't visibly "jump" between levels). releasing
  // the key stops the scrub immediately.
  const heldKey = useRef(null);
  const holdStart = useRef(0);
  const lastTick = useRef(0);
  const rafId = useRef(null);

  const scrubTick = useCallback((now) => {
    const key = heldKey.current;
    if (!key) { rafId.current = null; return; }
    const rawDt = (now - lastTick.current) / 1000;
    // guard against a stalled tab (backgrounded, devtools, GC pause, a slow
    // network seek...): rAF can skip seconds, and applying that whole gap
    // at an already-ramped-up rate is exactly what turns "one tap" into a
    // multi-minute jump. Treat any abnormal gap as a fresh restart instead
    // of a catch-up.
    if (rawDt > 0.25 || lastTick.current === 0) {
      holdStart.current = now;
      lastTick.current = now;
      rafId.current = requestAnimationFrame(scrubTick);
      return;
    }
    const held = (now - holdStart.current) / 1000; // seconds key has been down
    lastTick.current = now;
    const rate = Math.min(Math.pow(2, held), 60); // doubles every 1s held, capped
    const dir = key === 'ArrowRight' ? 1 : -1;
    const v = vidRef.current;
    if (v) v.currentTime = Math.max(0, v.currentTime + dir * rawDt * rate);
    rafId.current = requestAnimationFrame(scrubTick);
  }, []);

  useEffect(() => {
    const onKeyDown = (e) => {
      if (['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) return;
      const vid = vidRef.current; if (!vid) return;
      if (e.key === ' ') {
        e.preventDefault();
        if (shuttleRef.current !== 0) setShuttle(0); // space always stops a shuttle first, like K
        else vid.paused ? vid.play() : vid.pause();
      }
      else if (e.key === 'i' || e.key === 'I') setInP(vid.currentTime);
      else if (e.key === 'o' || e.key === 'O') setOutP(vid.currentTime);
      else if (e.key === 'j' || e.key === 'J') { e.preventDefault(); setShuttle(shuttleRef.current >= 0 ? -1 : shuttleRef.current * 2); }
      else if (e.key === 'k' || e.key === 'K') { e.preventDefault(); setShuttle(0); }
      else if (e.key === 'l' || e.key === 'L') { e.preventDefault(); setShuttle(shuttleRef.current <= 0 ? 1 : shuttleRef.current * 2); }
      else if (e.key === 'Home') { e.preventDefault(); seek(inP); }
      else if (e.key === 'End') { e.preventDefault(); seek(outP); }
      else if (e.key === 'Enter') { e.preventDefault(); save(); }
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        if (e.repeat) return; // ignore OS auto-repeat, we drive our own loop
        if (shuttleRef.current !== 0) setShuttle(0); // hand off from J/K/L cleanly
        vid.currentTime = Math.max(0, vid.currentTime + (e.key === 'ArrowRight' ? 1 : -1));
        heldKey.current = e.key;
        holdStart.current = performance.now();
        lastTick.current = holdStart.current;
        if (rafId.current == null) rafId.current = requestAnimationFrame(scrubTick);
      }
    };
    const onKeyUp = (e) => {
      if (e.key === heldKey.current) heldKey.current = null;
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      if (rafId.current != null) { cancelAnimationFrame(rafId.current); rafId.current = null; }
      if (reverseRaf.current != null) { cancelAnimationFrame(reverseRaf.current); reverseRaf.current = null; }
      heldKey.current = null; // no orphaned loop should survive a re-render
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inP, outP, scrubTick, seek, setShuttle]);

  // loop preview of the trimmed [inP,outP] range
  useEffect(() => {
    const v = vidRef.current;
    if (!v || !loop) return;
    seek(inP);
    v.play().catch(() => {});
  }, [loop]); // eslint-disable-line react-hooks/exhaustive-deps

  const pct = (t) => `${((t - viewStart) / viewDur) * 100}%`;
  const timeFromClientX = (clientX, rect) => viewStart + ((clientX - rect.left) / rect.width) * viewDur;

  // Alt+wheel zoom, wired as a *native* (non-passive) listener instead of
  // React's onWheel: browsers/React default wheel listeners to passive,
  // which silently no-ops preventDefault and can eat the whole gesture —
  // this is almost certainly why the JSX version never actually fired.
  const trackWrapRef = useRef(null);
  useEffect(() => {
    const el = trackWrapRef.current;
    if (!el) return;
    const handler = (e) => {
      if (!e.altKey) return;
      e.preventDefault();
      // browsers commonly reinterpret Alt+wheel as a horizontal-scroll
      // request and report the motion on deltaX instead of deltaY — read
      // whichever is actually nonzero.
      const delta = e.deltaY !== 0 ? e.deltaY : e.deltaX;
      if (delta === 0) return;
      const r = el.getBoundingClientRect();
      const t = viewStart + ((e.clientX - r.left) / r.width) * viewDur;
      zoomAt(t, delta < 0 ? 0.7 : 1 / 0.7);
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, [viewStart, viewDur, zoomAt]);

  // clicking the ruler/waveform background seeks; dragging it scrubs, like
  // grabbing a real tape/timeline — the playhead stays visually fixed and
  // the content moves under it, which means the actual play position moves
  // by the same amount the view pans (not just a silent camera-pan that
  // leaves the playhead drifting across the screen). Uses per-move deltas
  // against the *live* view (functional setView) rather than one absolute
  // offset computed from the drag's start — robust even if winStart/winEnd
  // change mid-drag (e.g. the background resolution-refinement resolving).
  const suppressClick = useRef(false);
  // the video seek is throttled to once per animation frame instead of once
  // per raw mousemove — mousemove can fire 60-120+ times/sec, and firing
  // that many currentTime writes at a network-streamed source races
  // multiple in-flight range requests against each other, which is exactly
  // what caused the "snaps back after ~2s" bug (an earlier, stale seek
  // winning the race after the drag had already moved on).
  const pendingSeekDelta = useRef(0);
  const seekRafId = useRef(null);
  const flushSeek = useCallback(() => {
    seekRafId.current = null;
    const vid = vidRef.current;
    if (vid && pendingSeekDelta.current !== 0) {
      vid.currentTime = Math.max(0, vid.currentTime + pendingSeekDelta.current);
      pendingSeekDelta.current = 0;
    }
  }, []);

  function panOrSeek(e) {
    // Pointer Capture instead of window-level mouse listeners: guarantees
    // this element keeps getting move/up events (and a reliable end-of-drag
    // signal via pointercancel) even if the cursor leaves the window or the
    // gesture gets interrupted some other way — a plain
    // window.addEventListener('mouseup') can simply never fire in that case,
    // leaking the listeners forever and leaving them to fight the next
    // drag, which is exactly what "works once or twice then gets stuck" is.
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const downX = e.clientX;
    let lastX = e.clientX;
    let moved = false;
    const onMove = (ev) => {
      if (Math.abs(ev.clientX - downX) > 3) { if (!moved) { setShuttle(0); isDragging.current = true; } moved = true; }
      const dx = ev.clientX - lastX;
      if (!moved || dx === 0 || !trackWrapRef.current) return;
      lastX = ev.clientX;
      const r = trackWrapRef.current.getBoundingClientRect();
      setView((v) => {
        const s = v?.start ?? winStart, en = v?.end ?? winEnd;
        const span = Math.min(en - s, winEnd - winStart);
        const deltaT = -(dx / r.width) * span; // drag right → pull earlier time into view, like grabbing tape
        let ns = s + deltaT, ne = ns + span;
        if (ns < winStart) { ns = winStart; ne = ns + span; }
        if (ne > winEnd) { ne = winEnd; ns = ne - span; }
        // move the actual play position by whatever delta the view ended up
        // moving (post-clamp) — this is what keeps the red playhead line
        // visually anchored while the waveform slides under it.
        const applied = ns - s;
        // the VISUAL playhead is driven straight from this optimistic delta,
        // not from the video's own timeupdate event — this file is a huge
        // remote UNC stream, so each real seek can take real network time to
        // resolve, and waiting for it is exactly what made the marker feel
        // "stuck" and only catch up seconds later. The actual currentTime
        // write below still happens (throttled to one per frame) so the
        // video eventually seeks there too, but the drawn position no
        // longer waits on it.
        setCur((c) => c + applied);
        pendingSeekDelta.current += applied;
        if (seekRafId.current == null) seekRafId.current = requestAnimationFrame(flushSeek);
        return { start: ns, end: ne };
      });
    };
    const onUp = (ev) => {
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
      isDragging.current = false; // always clear, even on a cancel/no-op release
      if (moved) {
        if (seekRafId.current != null) { cancelAnimationFrame(seekRafId.current); seekRafId.current = null; }
        flushSeek(); // apply the last bit immediately instead of waiting for a trailing frame
        suppressClick.current = true;
        setTimeout(() => { suppressClick.current = false; }, 0);
      } else if (trackWrapRef.current && ev.type !== 'pointercancel') {
        const r = trackWrapRef.current.getBoundingClientRect();
        seek(timeFromClientX(ev.clientX, r));
      }
    };
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
  }

  // drag the in/out handles directly on the waveform
  function startDrag(which, e) {
    e.stopPropagation();
    // same Pointer Capture reasoning as panOrSeek above — guarantees this
    // handle keeps getting move/up events (and a reliable end signal via
    // pointercancel) even if the gesture gets interrupted, instead of
    // window-level listeners that can leak if mouseup never fires.
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const track = el.closest('[data-track]');
    const onMove = (ev) => {
      const r = track.getBoundingClientRect();
      const t = Math.max(winStart, Math.min(winEnd, timeFromClientX(ev.clientX, r)));
      if (which === 'in') setInP(Math.min(t, outP - 0.2));
      else setOutP(Math.max(t, inP + 0.2));
    };
    const onUp = () => {
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
      suppressClick.current = true;
      setTimeout(() => { suppressClick.current = false; }, 0);
    };
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
  }

  async function save() {
    setStatusMsg('שומר…');
    await fetch('/api/segment', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folder, id: seg.id, patch: { start: +inP.toFixed(2), end: +outP.toFixed(2), status: 'approved' } }) });

    // if the trim was widened past this segment's original bounds (fixing a
    // bad split), any other still-pending segment from the same source that
    // the new range now mostly covers was probably the other half of the
    // same lesson — reject it automatically instead of leaving a duplicate.
    const covered = siblings.filter((sib) => {
      if (sib.id === seg.id || sib.source !== seg.source || sib.status !== 'detected') return false;
      const overlap = Math.min(outP, sib.end) - Math.max(inP, sib.start);
      return overlap > 0 && overlap >= 0.5 * (sib.end - sib.start);
    });
    for (const sib of covered) {
      await fetch('/api/segment', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folder, id: sib.id, patch: { status: 'rejected' } }) });
    }

    setStatusMsg(covered.length ? `נשמר ואושר ✓ (ומוזג עם ${covered.length} מקטע/ים שהיו חופפים)` : 'נשמר ואושר ✓');
    onDone && onDone();
  }
  async function reject() {
    // pass this Editor's own `folder` prop explicitly — for an auto-ingested
    // segment it differs from whatever's typed in Home's folder box, and
    // onStatus (Home's setStatus) would otherwise fall back to that instead.
    await onStatus(seg.id, 'rejected', folder);
    onDone && onDone();
  }

  return (
    <div style={{ borderTop: '1px solid #3a3a3a', padding: 14 }}>
      <video ref={vidRef} src={`/api/media/${seg.sourceId}`} controls tabIndex={-1}
        onFocus={(e) => e.target.blur()}
        style={{ width: '100%', maxHeight: 360, background: '#000', borderRadius: 6 }}
        onLoadedMetadata={(e) => { e.target.currentTime = seg.start; }}
        onTimeUpdate={(e) => {
          setCur(e.target.currentTime);
          if (loop && e.target.currentTime >= outP) e.target.currentTime = inP;
        }} />

      {/* transport bar: timecode readout + J/K/L shuttle, like a real NLE */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10 }}>
        <div style={{ fontFamily: 'ui-monospace, Consolas, monospace', fontSize: 22, fontWeight: 700, color: '#e8e8e8', letterSpacing: 1, direction: 'ltr' }}>
          {fmt(cur)}
        </div>
        <div style={{ display: 'flex', gap: 2 }}>
          <button style={c.btn} onClick={() => seek(inP)} title="קפוץ להתחלה המסומנת (Home)">⏮</button>
          <button style={{ ...c.btn, ...(shuttle < 0 ? { borderColor: '#58a6ff', color: '#58a6ff' } : {}) }}
            onClick={() => setShuttle(shuttleRef.current >= 0 ? -1 : shuttleRef.current * 2)} title="נגן אחורה, לחיצות נוספות מאיצות (J)">
            ⏪{shuttle < 0 ? ` ${-shuttle}x` : ''}
          </button>
          <button style={c.btn} onClick={() => setShuttle(0)} title="עצור (K / רווח)">⏹</button>
          <button style={{ ...c.btn, ...(shuttle > 0 ? { borderColor: '#58a6ff', color: '#58a6ff' } : {}) }}
            onClick={() => setShuttle(shuttleRef.current <= 0 ? 1 : shuttleRef.current * 2)} title="נגן קדימה, לחיצות נוספות מאיצות (L)">
            ⏩{shuttle > 0 ? ` ${shuttle}x` : ''}
          </button>
          <button style={c.btn} onClick={() => seek(outP)} title="קפוץ לסוף המסומן (End)">⏭</button>
        </div>
        <div style={{ flex: 1 }} />
        <button style={{ ...c.btn, padding: '2px 8px', fontSize: 12 }} onClick={() => zoomAt(cur, 0.5)} title="זום פנימה">🔍+</button>
        <button style={{ ...c.btn, padding: '2px 8px', fontSize: 12 }} onClick={() => zoomAt(cur, 2)} title="זום החוצה">🔍−</button>
        <button style={{ ...c.btn, padding: '2px 8px', fontSize: 12, opacity: wf ? 1 : 0.5 }} onClick={expandToFile} disabled={!wf}
          title="הצג את כל הקובץ — שימושי אם הזיהוי פיצל שיעור בטעות: גרור את החיתוך על פני שני החלקים ואשר">
          📂 כל הקובץ
        </button>
        <button style={{ ...c.btn, padding: '2px 8px', fontSize: 12 }} onClick={() => setView({ start: loadedStart, end: loadedEnd })} title="חזור לתצוגת ברירת המחדל סביב השיעור">↺ איפוס</button>
        {loadingMore && <span style={{ fontSize: 12, color: '#8b949e' }}>טוען פרטים…</span>}
      </div>

      {/* ruler + waveform share one clickable wrapper, so clicking or
          Alt+wheel-zooming works the same whether you're over the numbers
          or the waveform — and the playhead is a single line spanning both,
          with a flag poking up above the ruler, like Resolve's. */}
      <div ref={trackWrapRef} style={{ position: 'relative', marginTop: 18, cursor: 'grab', userSelect: 'none' }}
        onPointerDown={(e) => { e.preventDefault(); panOrSeek(e); }}>
        {/* time ruler, tick-marked like a real NLE timeline */}
        <div style={{ position: 'relative', height: 14, direction: 'ltr' }}>
          {(() => {
            const step = niceTickStep(viewDur);
            const ticks = [];
            for (let t = Math.ceil(viewStart / step) * step; t <= viewEnd; t += step) ticks.push(t);
            return ticks.map((t) => (
              <span key={t} style={{ position: 'absolute', insetInlineStart: `${((t - viewStart) / viewDur) * 100}%`, top: 0, fontSize: 10, color: '#6e7681', transform: 'translateX(-50%)', whiteSpace: 'nowrap' }}>
                {fmt(t)}
              </span>
            ));
          })()}
        </div>

        <div data-track style={{ position: 'relative', height: 64, background: '#1e6b45', borderRadius: 6, marginTop: 2, overflow: 'hidden', direction: 'ltr' }}>
          {wf?.peaks && (() => {
            const total = wf.peaks.length;
            const i0 = Math.max(0, Math.floor((viewStart - loadedStart) / loadedDur * total));
            const i1 = Math.min(total, Math.ceil((viewEnd - loadedStart) / loadedDur * total));
            const slice = wf.peaks.slice(i0, Math.max(i0 + 1, i1));
            return (
              <svg width="100%" height="64" preserveAspectRatio="none" viewBox={`0 0 ${slice.length} 64`}>
                {slice.map((p, i) => <rect key={i} x={i} y={32 - p * 30} width="1" height={Math.max(1, p * 60)} fill="#f0f0f0" />)}
              </svg>
            );
          })()}
          {/* dim the trimmed-away parts instead of tinting the selection —
              a flat green tint would be invisible on the now-green clip bg */}
          <div style={{ position: 'absolute', top: 0, bottom: 0, insetInlineStart: 0, width: pct(inP), background: 'rgba(0,0,0,0.55)', pointerEvents: 'none' }} />
          <div style={{ position: 'absolute', top: 0, bottom: 0, insetInlineStart: pct(outP), width: `calc(100% - ${pct(outP)})`, background: 'rgba(0,0,0,0.55)', pointerEvents: 'none' }} />
          <div style={{ position: 'absolute', top: 0, bottom: 0, insetInlineStart: pct(inP), width: `calc(${pct(outP)} - ${pct(inP)})`, borderInlineStart: '2px solid #fff', borderInlineEnd: '2px solid #fff', pointerEvents: 'none' }} />
          {/* draggable in/out handles — wider hit-zone + a visible grip so the
              ew-resize cursor is easy to land on, like a real NLE trim handle */}
          <div onPointerDown={(e) => startDrag('in', e)} title="גרור לשינוי נקודת ההתחלה"
            style={{ position: 'absolute', top: 0, bottom: 0, insetInlineStart: pct(inP), width: 16, marginInlineStart: -8, cursor: 'ew-resize', zIndex: 2, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ width: 4, height: 30, background: '#3fb950', borderRadius: 2, boxShadow: '0 0 0 1px rgba(0,0,0,0.5)' }} />
          </div>
          <div onPointerDown={(e) => startDrag('out', e)} title="גרור לשינוי נקודת הסוף"
            style={{ position: 'absolute', top: 0, bottom: 0, insetInlineStart: pct(outP), width: 16, marginInlineStart: -8, cursor: 'ew-resize', zIndex: 2, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ width: 4, height: 30, background: '#3fb950', borderRadius: 2, boxShadow: '0 0 0 1px rgba(0,0,0,0.5)' }} />
          </div>
        </div>

        {/* the one playhead — a flag poking up ~16px above the ruler with a
            hairline running down through the ruler and the waveform, like
            Resolve's red position marker. */}
        <div style={{ position: 'absolute', top: -16, bottom: 0, insetInlineStart: pct(cur), width: 1, background: RESOLVE_RED, pointerEvents: 'none', zIndex: 3, direction: 'ltr' }} />
        <div style={{ position: 'absolute', top: -16, insetInlineStart: pct(cur), width: 0, height: 0, marginInlineStart: -6, borderLeft: '6px solid transparent', borderRight: '6px solid transparent', borderTop: `9px solid ${RESOLVE_RED}`, pointerEvents: 'none', zIndex: 4, direction: 'ltr' }} />
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 12, color: '#8b949e' }}>התחלה</span>
        <input style={{ ...c.input, width: 100 }} dir="ltr" value={inText}
          onChange={(e) => setInText(e.target.value)}
          onBlur={() => { const t = parseT(inText); if (t != null) setInP(Math.min(t, outP - 0.2)); else setInText(fmt(inP)); }}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} />
        <button style={c.btn} onClick={() => setInP(cur)} title="I">סמן כאן</button>
        <span style={{ fontSize: 12, color: '#8b949e', marginInlineStart: 10 }}>סוף</span>
        <input style={{ ...c.input, width: 100 }} dir="ltr" value={outText}
          onChange={(e) => setOutText(e.target.value)}
          onBlur={() => { const t = parseT(outText); if (t != null) setOutP(Math.max(t, inP + 0.2)); else setOutText(fmt(outP)); }}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()} />
        <button style={c.btn} onClick={() => setOutP(cur)} title="O">סמן כאן</button>
        <span style={{ color: '#8b949e', fontSize: 13, marginInlineStart: 10 }}>אורך: {fmt(Math.max(0, outP - inP))}</span>
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10, flexWrap: 'wrap' }}>
        <button style={{ ...c.btn, ...(loop ? { borderColor: '#58a6ff', color: '#58a6ff' } : {}) }} onClick={() => setLoop((v) => !v)}>
          {loop ? '⏹ עצור לולאה' : '🔁 נגן קטע בלולאה'}
        </button>
        <div style={{ flex: 1 }} />
        <button style={c.btnDanger} onClick={reject}>מחק</button>
        <button style={c.btnP} onClick={save}>אשר (Enter)</button>
        {status && <span style={{ fontSize: 13, color: '#58a6ff' }}>{status}</span>}
      </div>

      <div style={{ marginTop: 8, fontSize: 11, color: '#6e7681' }}>
        קיצורים: J/K/L = נגן אחורה/עצור/קדימה (לחיצות חוזרות מאיצות, כמו בעורכי וידאו מקצועיים) · רווח = עצור/נגן ·
        I/O = סמן התחלה/סוף כאן · ←/→ = צעד של שנייה (החזק להאצה — כל שנייה פי 2 מהר יותר) · Home/End = קפוץ להתחלה/סוף המסומן ·
        Enter = אשר · גררו את הידיות הירוקות לשינוי מדויק · גררו את הטיימליין עצמו (לא ידית) כדי להזיז ימינה/שמאלה · Alt + גלגלת עכבר מזמזם פנימה/החוצה.
      </div>
    </div>
  );
}
