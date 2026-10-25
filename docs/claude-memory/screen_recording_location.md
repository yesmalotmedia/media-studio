---
name: screen-recording-location
description: "Where Windows screen recordings (Xbox Game Bar captures) actually land on this machine — a different Windows user profile than the one Claude Code's shell runs under"
metadata:
  node_type: memory
  type: reference
  originSessionId: a62ff656-60a8-492c-aeb4-0394205c248e
  modified: 2026-09-24T14:21:29.290Z
---

Screen recordings (Xbox Game Bar, Win+G) on this machine save to:

```
C:\Users\MediaLPT\Videos\Captures
```

**Why this is easy to get wrong:** Claude Code's shell on this machine runs under the `user` Windows profile (`C:\Users\user\...`), but the person actually recording the screen (e.g. for the Google OAuth verification demo video, see [[google-oauth-verification]]) is logged into Windows as a different account, `MediaLPT`. Searching `C:\Users\user\Videos\Captures` or anywhere else under the `user` profile will never find these recordings — always check `C:\Users\MediaLPT\Videos\Captures` directly instead.
