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
