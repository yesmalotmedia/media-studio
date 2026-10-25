---
name: maalot-podcast-titles
description: "Maalot podcast show titles = sheet column B + \" | ישיבת מעלות\" (vertical bar), so a search for the yeshiva finds them"
metadata:
  node_type: memory
  type: project
  originSessionId: ae74ef0e-047f-4302-a4aa-5b8744e73bbc
  modified: 2026-10-25T17:35:37.572Z
---

Every Maalot podcast title (data/podcast/shows.json `title`) is the series name from sheet column B followed by " | ישיבת מעלות". The plain column-B name is kept in `sheetTitle`. Applied to all 28 Maalot shows on 2026-10-25. Episode titles do NOT get the suffix.

**Why:** the user wants people searching "ישיבת מעלות" on Spotify to find the shows; publisher/description alone may not be enough. The user asked for a vertical bar ("קו מפריד"), not a hyphen ("מקף").

**How to apply:** any new Maalot show gets the same suffix with " | ". Show the user a preview of names before publishing. Related: [[zohar-podcasts]]
