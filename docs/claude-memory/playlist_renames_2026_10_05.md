---
name: playlist-renames-2026-10-05
description: "On 2026-10-05, 37 YouTube playlists (27 zohar, 10 maalot) were renamed to exactly match column B of the titles sheet; how to revert"
metadata:
  node_type: memory
  type: project
  originSessionId: ae74ef0e-047f-4302-a4aa-5b8744e73bbc
  modified: 2026-10-05T10:56:49.907Z
---

On 2026-10-05 the user decided the titles sheet (column B, series name) is the
source of truth for YouTube playlist names, and had 37 playlists renamed to
match it exactly: 27 on @zoharday (every parsha playlist, to "העמוד היומי בזוהר -
פרשת X | שיעור קצר" / "שיעור עיון בזוהר - פרשת X | הרב יהושע ויצמן") and 10 on
ישיבת מעלות (e.g. dropped "בוקר של תורה בישיבת מעלות" from עיתים לתורה names).

Old names (field "from"), new names ("to") and playlist ids are in
`data/playlist-renames/2026-10-05.json`; what actually happened per playlist is in
`...2026-10-05.result.json`. To undo: `node scripts/rename_playlists.cjs
data/playlist-renames/2026-10-05.json --revert` (asks for youtube.force-ssl in the
browser once per channel, in memory only).

Left unrenamed on purpose: zohar plain "פרשת X" playlists, "פנינים", "הקדמת הזוהר";
6 maalot series needing the user's decision (שם משמואל — two candidate playlists;
דרכי לימוד בגמרא — one playlist per tractate; שיחות בנושאים שונים | ויצמן; נ"ך |
וינר; שיחות בנושאים שונים | וינר; "הרב מנשה וינר"). Two separate "פרשת בא - שיעור
עיון" playlists exist (64 shared videos) and both were renamed — a duplicate the
user may clean up.

**Why:** planned auto-add of each uploaded video to its series playlist, matched
by exact name. **How to apply:** if a playlist link/name looks off, check the
result file first; any future column-B rename must be mirrored on the playlist.
