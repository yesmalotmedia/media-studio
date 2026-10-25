"""Encrypted backup of credentials/ (see RECOVERY.md, section ג).

Run it yourself in a terminal — it asks for the password, so the password never goes
through a chat or a file:
    python scripts/backup_credentials.py
Creates credentials-backup-<date>.zip (AES-256) in Downloads. Open it with 7-Zip or WinRAR
(Windows Explorer can't open AES zips). Keep the zip in Drive / Servermedia and the
password somewhere else.
"""
import datetime, getpass, os, sys
import pyzipper

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, '..', 'credentials')
OUT = os.path.join(os.path.expanduser('~'), 'Downloads', f'credentials-backup-{datetime.date.today()}.zip')

pw = getpass.getpass('סיסמה לגיבוי (לא תוצג): ')
if len(pw) < 10 or pw != getpass.getpass('שוב, לאימות: '):
    sys.exit('הסיסמה קצרה מ-10 תווים או לא תואמת. לא נוצר גיבוי.')
with pyzipper.AESZipFile(OUT, 'w', compression=pyzipper.ZIP_DEFLATED, encryption=pyzipper.WZ_AES) as z:
    z.setpassword(pw.encode('utf8'))
    for name in sorted(os.listdir(SRC)):
        z.write(os.path.join(SRC, name), arcname=f'credentials/{name}')
# check it opens with the password
with pyzipper.AESZipFile(OUT) as z:
    z.setpassword(pw.encode('utf8'))
    names = z.namelist(); z.testzip()
print(f'נוצר: {OUT}  ({len(names)} קבצים, נבדק שנפתח עם הסיסמה)')
