# שחזור המערכת על מחשב חדש

המדריך מסביר איך להעמיד את "סטודיו שיעורים" מאפס, אם המחשב הזה הושבת. תיאור המערכת
עצמה נמצא ב-[CLAUDE.md](CLAUDE.md).

## מה לא צריך לשחזר (כבר נמצא בענן)

| מה | איפה |
| --- | --- |
| קוד, סקריפטים, תבניות, נתוני עבודה (`data/`) | GitHub: `yesmalotmedia/media-studio` |
| פידים ואודיו של כל הפודקסטים, ה-Worker | Cloudflare (R2 `yesmalot-podcast`, Worker `yesmalot-podcast`) |
| תמונות המקור של הפודקסטים החדשים, והסקריפטים שיצרו אותן | `assets/podcast-covers/` בגיטהאב |
| הקלטות גולמיות | `\\Servermedia\הקלטות` |
| שיעורים מיוצאים | `G:\תיקיות אחסון שיתופי\OtzarHashiorim\שיעורים להפצה` (Google Drive משותף) |
| הטבלה והטופס | Google Sheets / Forms |
| ערוצי יוטיוב, אתר הזוהר (Wix), אתר מעלות (WordPress), Spotify for Creators | בחשבונות של media@yesmalot.co.il |

## מה כן צריך לשחזר

1. **תיקיית `credentials/`.** היא לא בגיטהאב, בכוונה. מקור השחזור הוא הגיבוי המוצפן, ראה סעיף ג.
2. **התוכנות שמותקנות על המחשב**, ראה סעיף א.

## א. התקנות

1. **Git ו-Node.js.** הגרסאות שעבדו: Git 2.47, Node 22.11.
2. **ffmpeg ו-ffprobe:** צריכים להיות ב-PATH. בודקים עם `בדיקת-מערכת.bat`.
3. **Python 3.12:** לפי הנתיב שב-`config.json → python_path`. כרגע זה
   `C:\Users\user\AppData\Local\Programs\Python\Python312\python.exe`.
   מתקינים את החבילות:
   ```
   python -m pip install opencv-python numpy pedalboard soundfile yt-dlp python-docx
   ```
4. **הפלאגין Supertone Clear (VST3),** להסרת הד. זה מוצר בתשלום, ומתקינים אותו עם הרישיון
   שלו. הנתיב שהקוד מצפה לו: `C:\Program Files\Common Files\VST3\Clear.vst3`. בלי הפלאגין
   אפשר לכבות את הסרת ההד ב-`config.json → dereverb.enabled`.
5. **גישה לרשת:** המחשב צריך לגשת ל-`\\Servermedia\הקלטות`, וגם ל-Google Drive for desktop
   עם הכונן `G:`.

> שמות קובצי ה-bat בתיקייה מופיעים משובשים בגלל בעיית קידוד, למשל `╫פ╫ñ╫ó╫£.bat`. לפי הסדר: `╫פ╫ñ╫ó╫£` הוא "הפעל", `╫פ╫¬╫º╫á╫פ` הוא "התקנה", ו-`╫ס╫ף╫ש╫º╫¬-╫₧╫ó╫¿╫¢╫¬` הוא "בדיקת-מערכת".

## ב. קוד

```
git clone https://github.com/yesmalotmedia/media-studio.git shiur-studio
cd shiur-studio
npm install            (או: התקנה.bat)
```
`node_modules`, `.next` ו-`data/cache` לא נמצאים בגיט, והם נבנים מחדש לבד.

## ג. תיקיית credentials

מעתיקים מהגיבוי המוצפן את 7 הקבצים לתיקייה `credentials/`. אם הגיבוי אבד, יוצרים כל
אחד מחדש:

| קובץ | מה זה | איך יוצרים מחדש |
| --- | --- | --- |
| `youtube_oauth_client.json` | OAuth client של Google Cloud | Google Cloud Console, הפרויקט של הסטודיו. בתפריט Credentials בוחרים OAuth client מסוג Desktop, ומורידים JSON |
| `youtube_token_maalot.json` | גישה לערוץ מעלות | `node scripts/youtube_auth.mjs`. בחלון ההתחברות בוחרים את ערוץ **מעלות** |
| `youtube_token_zohar.json` | גישה לערוץ הזוהר | מריצים שוב את אותו סקריפט, ובוחרים את ערוץ **הזוהר** |
| `sheets_token.json` | Sheets, Drive, Forms | מהמערכת עצמה, בכתובת `/api/auth/google/start?target=sheets`. זה כולל את הרשאת forms.body. דרך חלופית, בלי Forms: `node scripts/sheets_auth.mjs` |
| `wix.json` | apiKey, accountId, siteId, collections | בלוח הבקרה של Wix בוחרים API Keys. שמות האוספים: `iyun: "Import1"`, `pshat: "pshat"` |
| `wordpress.json` | site, username, applicationPassword | ב-yesmalot.co.il: Users, אחר כך shiur-studio, ושם Application Passwords. Wordfence חייב לאפשר application passwords |
| `r2.json` | accountId, accessKeyId, secretAccessKey, bucket | ב-Cloudflare: R2, ואז Manage API tokens. יוצרים token עם הרשאת Object Read & Write על `yesmalot-podcast` |

כל ההתחברויות נעשות עם המשתמש media@yesmalot.co.il.

## ד. הפעלה ובדיקה

1. **הפעלה:** `הפעל.bat`, או `npx next dev -p 3001`. בלוג צריכות להופיע השורות
   `[ingest] watcher starting` ו-`[publish] watching for public videos`.
2. **מסך החיתוכים:** פותחים localhost. המסך צריך להיפתח, ורשימת החיתוכים צריכה להופיע.
3. **בדיקת חיבורים:**
   - `node scripts/check_podcast.mjs maalot-tehillim` בודק את הטבלה, יוטיוב והפודקסט ביחד.
   - `node scripts/mark_distributed.mjs --days 3` (בלי `--apply`) בודק את WordPress ואת Wix.
4. **ה-Worker של הפודקסטים:** לפרוס מחדש רק אם הוא נמחק בקלאודפלייר:
   `cd cloudflare && npx wrangler deploy`.

## ה. עבודה עם Claude Code

- **מאיפה להתחיל:** `CLAUDE.md` הוא נקודת הפתיחה לכל שיחה חדשה. צריך לשמור אותו מעודכן.
- **זיכרונות:** ההעדפות שנשמרו לאורך העבודה, כמו "לענות בעברית" וכללי השמות, נמצאות
  בגיבוי ב-`docs/claude-memory/`. במחשב חדש מעתיקים אותן ל:
  `C:\Users\<user>\.claude\projects\<שם-התיקייה>\memory\`.
- **שיחות קודמות:** הצ'אטים לא מגובים ולא נחוצים לשחזור. כל מה שחשוב מהם נמצא ב-CLAUDE.md.

## ו. גיבוי שוטף (מה לעשות כדי שהמדריך הזה יעבוד)

- **שמירה אוטומטית לגיטהאב:** מתבצעת כל לילה בשעה 23:00, דרך משימה מתוזמנת של Windows בשם
  `Shiur Studio - GitHub backup`, שמריצה את `scripts/auto_backup.ps1`. אם המחשב כבוי בשעה הזו,
  השמירה רצה בהפעלה הבאה. יומן הריצות נכתב ל-`backup.log`, שלא נשמר בגיט.
  במחשב חדש יוצרים את המשימה מחדש (ב-PowerShell):
  ```
  $a = New-ScheduledTaskAction -Execute powershell.exe -Argument '-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "<נתיב>\scriptsuto_backup.ps1"'
  Register-ScheduledTask -TaskName 'Shiur Studio - GitHub backup' -Action $a -Trigger (New-ScheduledTaskTrigger -Daily -At 23:00) -Settings (New-ScheduledTaskSettingsSet -StartWhenAvailable)
  ```
- **כשמתווספת או משתנה סיסמה או מפתח ב-`credentials/`:** מעדכנים את הגיבוי המוצפן.
