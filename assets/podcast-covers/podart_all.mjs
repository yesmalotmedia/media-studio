// Square Spotify covers for the new Maalot podcasts (option ב, approved direction 2026-10-20).
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
const S = process.argv[2];
const { findTemplate } = await import('file:///C:/Users/user/Downloads/shiur-studio/lib/cover.js');
// [series (column B), title lines, rabbi prefix, rabbi name]
const items = [
  ['עִתִּים לַתּוֹרָה - גאולה בפרשה | הרב מאור כהן', 'גאולה|בפרשה', 'הרב', 'מאור כהן'],
  ['עִתִּים לַתּוֹרָה - הלכות שבת ומועד | הרב מיכאל אזרד', 'הלכות שבת|ומועד', 'הרב', 'מיכאל אזרד'],
  ['עִתִּים לַתּוֹרָה - אגדתות | הרב שי הוד', 'אגדתות', 'הרב', 'שי הוד'],
  ['עִתִּים לַתּוֹרָה - עיונים בספר שמות | הרב תמיר כהן', 'עיונים|בספר שמות', 'הרב', 'תמיר כהן'],
  ['עִתִּים לַתּוֹרָה - מועדי ישראל | הרב מרדכי פרומר', 'מועדי|ישראל', 'הרב', 'מרדכי פרומר'],
  ['עִתִּים לַתּוֹרָה - השוואות במקרא | הרב דוד הורן', 'השוואות|במקרא', 'הרב', 'דוד הורן'],
  ['עִתִּים לַתּוֹרָה - עיונים ברש"י חומש שמות | הרב בן ציון שטרן', 'עיונים ברש״י|חומש שמות', 'הרב', 'בן ציון שטרן'],
  ['עִתִּים לַתּוֹרָה - פרקים בגאולת ישראל | ר\' גבריאל מלמד', 'פרקים|בגאולת ישראל', 'ר׳', 'גבריאל מלמד'],
  ['עִתִּים לַתּוֹרָה - עיון בכתבי הרב קוק | הרב מנחם ויצמן', 'עיון בכתבי|הרב קוק', 'הרב', 'מנחם ויצמן'],
  ['שיעור כללי | הרב יהושע ויצמן', 'שיעור|כללי', 'הרב', 'יהושע ויצמן'],
  ['דרכי לימוד בגמרא | הרב יהושע ויצמן', 'דרכי לימוד|בגמרא', 'הרב', 'יהושע ויצמן'],
  ['השתלשלות סידור התפילה | ר\' משה צבי וידר', 'השתלשלות|סידור התפילה', 'ר׳', 'משה צבי וידר'],
  ['אורות התשובה | הרב יהושע וייצן', 'אורות|התשובה', 'הרב', 'יהושע ויצן'],
];
fs.mkdirSync(S + '/podart', { recursive: true });
const done = [];
for (const [i, [series, title, rp, rn]] of items.entries()) {
  const tpl = findTemplate(series);
  if (!tpl) { console.log('NO TEMPLATE', series); continue; }
  const out = `${S}/podart/${String(i).padStart(2, '0')}.jpg`;
  const info = execFileSync('node', [S + '/podart_one.mjs', tpl.file, out, title, rp, rn, '0'], { cwd: 'C:/Users/user/Downloads/shiur-studio', stdio: 'pipe' }).toString().trim();
  done.push({ series, file: out });
  console.log('ok', i, series, info);
}
fs.writeFileSync(S + '/podart/index.json', JSON.stringify(done, null, 1), 'utf8');
// contact sheet: 4 per row, 500px each
const args = [], inputs = done.map((d) => d.file);
for (const f of inputs) args.push('-i', f);
const cols = 4, rowsN = Math.ceil(inputs.length / cols);
let fc = inputs.map((_, i) => `[${i}]scale=500:500[s${i}]`).join(';') + ';';
const pad = rowsN * cols - inputs.length;
for (let p = 0; p < pad; p++) fc += `color=c=white:s=500x500:d=1[p${p}];`;
const cells = [...inputs.map((_, i) => `[s${i}]`), ...Array.from({ length: pad }, (_, p) => `[p${p}]`)];
fc += cells.map((c, i) => c).join('') + `xstack=inputs=${cells.length}:layout=` + cells.map((_, i) => `${(i % cols) * 500}_${Math.floor(i / cols) * 500}`).join('|') + ':fill=white';
execFileSync('ffmpeg', ['-v', 'error', '-y', ...args, '-filter_complex', fc, '-frames:v', '1', S + '/podart/sheet.jpg']);
console.log('sheet done');
