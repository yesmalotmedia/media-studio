// One-off isolation test (2026-09-08): uploads ONE file, by itself, with no
// export/crop/dereverb pipeline and no burst of other uploads around it — to
// find out whether a single, isolated call to lib/youtube.js's uploadVideo()
// survives on YouTube, or gets silently deleted afterward like the recent
// automated-pipeline uploads did (see conversation: uploads succeed, get a
// real video ID, then vanish — playlistItems.list still shows a "Deleted
// video" stub). If THIS one survives, the automated pipeline's back-to-back
// upload burst is the likely trigger (spam/abuse auto-detection), not
// anything about the content or the upload code itself.
//
// Usage: node scripts/test_isolated_upload.mjs
import { uploadVideo } from '../lib/youtube.js';

const FILE = String.raw`\\Servermedia\הקלטות\test\דף רסב עמוד ב  העמוד היומי בזוהר - פרשת פקודי  שיעור קצר .mp4`;

console.log('uploading (isolated test)...', FILE);
const { videoId, url } = await uploadVideo('maalot', FILE, {
  title: 'בדיקת בידוד - דף רסב עמוד ב',
  description: 'העלאת בדיקה מבודדת, ללא ייצוא/עיבוד, כדי לבודד את סיבת המחיקה האוטומטית.',
});
console.log('done:', videoId, url);
