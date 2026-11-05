// Source sheets (דפי מקורות) for a lesson: the uploaded files become ONE PDF
// (several files merged in order; a single image becomes a one-page PDF; a
// single PDF goes as is), the PDF is uploaded to the sources folder on Google
// Drive, and its /preview link is written to column E of the lesson's row in
// the titles sheet. Decided 2026-10-10 (the /preview form is what the site
// embeds; the existing links in column E are all in that form).
import { Readable } from 'node:stream';
import { google } from 'googleapis';
import { PDFDocument } from 'pdf-lib';
import { runFfmpeg } from './ff.js';
import { googleUserAuth } from './sheetsSync.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const previewUrl = (fileId) => `https://drive.google.com/file/d/${fileId}/preview`;

const isPdf = (f) => /pdf$/i.test(f.type) || /\.pdf$/i.test(f.name);

// pdf-lib embeds JPEG and PNG only — anything else (HEIC from iPhones, WebP…)
// goes through ffmpeg to JPEG first.
async function toEmbeddable(f) {
  if (/jpe?g$/i.test(f.type) || /\.jpe?g$/i.test(f.name)) return { kind: 'jpg', bytes: f.bytes };
  if (/png$/i.test(f.type) || /\.png$/i.test(f.name)) return { kind: 'png', bytes: f.bytes };
  const src = path.join(os.tmpdir(), `src-${Date.now()}-${Math.random().toString(36).slice(2)}${path.extname(f.name) || '.img'}`);
  const out = `${src}.jpg`;
  fs.writeFileSync(src, f.bytes);
  try {
    await runFfmpeg(['-v', 'error', '-y', '-i', src, '-frames:v', '1', '-q:v', '2', out]);
    return { kind: 'jpg', bytes: fs.readFileSync(out) };
  } finally { fs.rmSync(src, { force: true }); fs.rmSync(out, { force: true }); }
}

// files: [{ name, type, bytes: Buffer }] in the order they should appear.
export async function buildPdf(files) {
  if (files.length === 1 && isPdf(files[0])) return files[0].bytes;
  const doc = await PDFDocument.create();
  for (const f of files) {
    if (isPdf(f)) {
      const src = await PDFDocument.load(f.bytes, { ignoreEncryption: true });
      for (const p of await doc.copyPages(src, src.getPageIndices())) doc.addPage(p);
    } else {
      const { kind, bytes } = await toEmbeddable(f);
      const img = kind === 'png' ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
      const page = doc.addPage([img.width, img.height]); // page = image size, no margins or scaling
      page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
    }
  }
  return Buffer.from(await doc.save());
}

// The sources folder ("דפי מקורות") is in My Drive and shared "anyone with the
// link: viewer" — CONFIRMED 2026-10-10 — so new files inherit that and the
// /preview link works for site visitors. supportsAllDrives just keeps this
// working if the folder is ever moved into a shared drive.
export async function uploadPdfToDrive(pdf, name, folderId) {
  const drive = google.drive({ version: 'v3', auth: googleUserAuth() });
  const res = await drive.files.create({
    supportsAllDrives: true,
    requestBody: { name, parents: [folderId], mimeType: 'application/pdf' },
    media: { mimeType: 'application/pdf', body: Readable.from(pdf) },
    fields: 'id, name, webViewLink',
  });
  return res.data.id;
}

// Can anyone with the link open it? (the folder's sharing is inherited — this
// only reports, it never changes sharing)
export async function linkAccess(fileId) {
  const drive = google.drive({ version: 'v3', auth: googleUserAuth() });
  const { data } = await drive.permissions.list({ fileId, supportsAllDrives: true, fields: 'permissions(type, role)' });
  return data.permissions.some((p) => p.type === 'anyone') ? 'anyone-with-link' : 'restricted';
}

// ---- source text pasted into the notes (column D) -> a sources PDF -----------
// Decided with the user 2026-11-05: a real note in column D is 10–20 words at most,
// so a longer text is the lesson's sources (pesukim, gemara, a quoted passage).
// Measured on the sheet that day: all 63 notes of ≤25 words were notes, all 125
// longer ones were sources — 124 with source markers (nikud/te'amim, מסכת, דף, פרק,
// "(א)"), one a numbered quoted passage without any. `unsure` flags that last kind
// so it can be reported; it is still treated as sources.
const MARKS = /מסכת|תלמוד|בבלי|ירושלמי|\bדף\b|עמוד [אב]|ע"[אב]|פרק|פסוק|הלכה|רמב"ם|שו"ע|שולחן ערוך|מדרש|רש"י|תוספות|גמרא|משנה|זוהר|הלכות|סימן|סעיף|\([א-ת]{1,3}\)/;
const NIKUD = /[\u0591-\u05C7]/g;
export function classifyNotes(notes) {
  const s = String(notes || '').trim();
  if (s.split(/\s+/).length <= 25) return { sources: false };
  const marked = MARKS.test(s) || (s.match(NIKUD) || []).length > 20 || /^\s*[א-ת]{1,3}[.)]\s/m.test(s);
  return { sources: true, unsure: !marked };
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Sources pasted into a sheet cell lose their line breaks: what were separate sources
// arrive as one block with 2–3 spaces where each break was (CONFIRMED 2026-11-05 on
// rows 382/387/388). Each piece usually opens with its reference — "תלמוד בבלי מסכת
// סוכה דף כז עמוד ב", "ילקוט שמעוני שופטים רמז מב", "מלכים א פרק טז פסוק טו - כא" —
// which becomes the piece's heading. A piece with no reference up front stays plain.
const REF_END = /^((?:שמונה קבצים|קובץ)\s+[א-ת]{1,2}\s+[א-ת"']{1,5}(?:\s*\/\s*אורות הקודש(?:,?\s*חלק)?(?:,?\s*(?!עמ')[א-ת]{1,2}')+(?:,?\s*עמ'\s+\S+)?)?|.{2,120}?(?:דף\s+\S+\s+עמוד\s+[אב]|דף\s+\S+\/[אב]|פרק\s+\S+(?:\s+פסוק\s+\S+(?:\s*-\s*\S+)?|\s+הלכה\s+\S+)?|רמז\s+\S+|מזמור\s+\S+|הלכה\s+\S+|סימן\s+\S+(?:\s+סעיף\s+\S+)?|עמ'\s+\S+|אגרת\s+\S+|ריש\s+\S+)(?:\s+ד"ה\s+\S+(?:\s+\S+)?)?)(?=\s|$)/;
export function splitSources(text) {
  return String(text).split(/\r?\n|\s{2,}/).map((p) => p.trim()).filter(Boolean).map((p) => {
    const m = p.match(REF_END);
    return m && m[1].split(/\s+/).length <= 14 ? { ref: m[1].trim(), body: p.slice(m[1].length).trim() } : { ref: '', body: p };
  });
}

// The live Google Doc the sources are typed into during the lessons ("מעלותורה מקורות
// לשיעורים", config sources.doc; newest at the top) — the notes are a paste of a stretch
// of it, flattened. Found there, that stretch goes into the PDF with the Doc's own
// layout (headings, bold, spacing). READ ONLY: the Doc is someone else's, shared with
// many — never written to (user, 2026-11-05).
let docCache = null; // { at, paras: [{ html, text }] }
const decode = (s) => s.replace(/<[^>]+>/g, '').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
  .replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const squash = (s) => String(s).replace(/[\s ‎‏]+/g, '').replace(/[״“”]/g, '"').replace(/[׳‘’]/g, "'");
async function docParas(docId) {
  if (docCache?.id === docId && Date.now() - docCache.at < 5 * 60_000) return docCache.paras;
  const drive = google.drive({ version: 'v3', auth: googleUserAuth() });
  const html = String((await drive.files.export({ fileId: docId, mimeType: 'text/html' })).data);
  const paras = [...html.matchAll(/<p\b[^>]*>[\s\S]*?<\/p>/g)].map((m) => ({ html: m[0].replace(/<img\b[^>]*>/g, ''), text: squash(decode(m[0])) }));
  docCache = { id: docId, at: Date.now(), paras };
  return paras;
}
// The Doc's paragraphs that make up `notes`, as HTML — or null if not found there whole.
export async function sourcesHtmlFromDoc(notes, docId) {
  if (!docId) return null;
  const want = squash(notes);
  if (want.length < 200) return null;
  const paras = await docParas(docId);
  const starts = []; let all = '';
  for (const p of paras) { starts.push(all.length); all += p.text; }
  const s = all.indexOf(want.slice(0, 80));
  if (s < 0) return null;
  // the last occurrence within reach — a passage can repeat (row 387 quotes כט twice)
  const e = all.lastIndexOf(want.slice(-80), s + Math.ceil(want.length * 1.2)) + 80;
  if (e < 80 || e - s < want.length * 0.9 || e - s > want.length * 1.2) return null;
  const first = starts.findLastIndex((x) => x <= s), last = starts.findLastIndex((x) => x < e);
  return paras.slice(first, last + 1).map((p) => p.html).join('\n');
}

// Hebrew text -> PDF. Google Docs does the layout (right-to-left, nikud, line
// breaking): the text goes up as an RTL HTML page converted to a Google Doc,
// comes back exported as PDF, and the temporary Doc is deleted.
// docHtml: the same text as laid out in the sources Doc (sourcesHtmlFromDoc), used as is;
// otherwise the flattened text is split back into sources (splitSources).
export async function textToPdf({ heading, subheading, text, docHtml }) {
  const drive = google.drive({ version: 'v3', auth: googleUserAuth() });
  const paras = docHtml || splitSources(text).map(({ ref, body }) => [
    ref && `<p dir="rtl" style="text-align:right;font-size:14pt;font-weight:bold;margin-top:18pt;margin-bottom:4pt">${esc(ref)}</p>`,
    body && `<p dir="rtl" style="text-align:justify;font-size:13pt;line-height:1.5;margin-top:${ref ? 0 : 14}pt">${esc(body)}</p>`,
  ].filter(Boolean).join('\n')).join('\n');
  const html = `<html dir="rtl"><head><meta charset="utf-8"></head><body dir="rtl" style="font-family:'David Libre',David,Arial">
<h1 dir="rtl" style="text-align:center">${esc(heading)}</h1>${subheading ? `<p dir="rtl" style="text-align:center;font-size:14pt">${esc(subheading)}</p>` : ''}
${paras}</body></html>`;
  const doc = await drive.files.create({
    requestBody: { name: `tmp-sources-${Date.now()}`, mimeType: 'application/vnd.google-apps.document' },
    media: { mimeType: 'text/html', body: Readable.from(Buffer.from(html, 'utf8')) },
    fields: 'id',
  });
  try {
    const res = await drive.files.export({ fileId: doc.data.id, mimeType: 'application/pdf' }, { responseType: 'arraybuffer' });
    return Buffer.from(res.data);
  } finally {
    await drive.files.delete({ fileId: doc.data.id }).catch(() => {});
  }
}
