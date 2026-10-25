---
name: zohar-podcasts
description: "The two Zohar podcasts (iyun + short/pshat) — self-hosted on R2, their Spotify links and how lessons are routed"
metadata:
  node_type: memory
  type: project
  originSessionId: ae74ef0e-047f-4302-a4aa-5b8744e73bbc
  modified: 2026-10-18T08:58:13.780Z
---

Two separate Zohar podcasts, both self-hosted on Cloudflare R2 (Worker https://yesmalot-podcast.media-384.workers.dev), config in data/podcast/shows.json:
- `zohar` — iyun lessons only ("שיעור עיון בזוהר…"), migrated from Spotify for Creators with a 301 redirect 2026-10-12. Spotify: https://open.spotify.com/show/2hL7TxOFEqHErFOLcDUr0E
- `zohar-pshat` — short lessons ("העמוד היומי בזוהר … | שיעור קצר"), created 2026-10-12 from ALL YouTube videos labeled שיעור קצר/פשט (no filtering — user deletes irrelevant ones later), audio downloaded with yt-dlp. Submitted to Spotify ("Somewhere else" host) 2026-10-18: https://open.spotify.com/show/3QfXZQyL4oa4oCUlYwVNsY

Both autoPublish from the studio export. YouTube descriptions link each kind to its own show (lib/description.js ZOHAR.spotify[kind]).

**Why:** the short lessons were never on Spotify before; the user wants names consistent across YouTube/site/podcasts (sheet column B is the source of truth).
**How to apply:** never change episode guids; new Zohar podcast work goes through shows.json + lib/podcast.js. Maalot podcasts: see CLAUDE.md (2026-10-25: 9 redirected, 14 new submitted, 5 short/French still manual on Spotify for Creators).
