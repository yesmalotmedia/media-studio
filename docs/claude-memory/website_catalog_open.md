---
name: website-catalog-open
description: Open decision — how to catalog lessons on yesmalot.co.il (topic vs. audience/program); new series follow the existing pattern meanwhile
metadata:
  node_type: memory
  type: project
  originSessionId: ae74ef0e-047f-4302-a4aa-5b8744e73bbc
  modified: 2026-10-19T10:18:45.939Z
---

On 2026-10-19 the user raised a site-wide question: catalog Maalot lessons encyclopedically (by topic) or by audience/program (עתים לתורה, שיעורים קצרים לדרך). Today the category tree mixes both (e.g. כוזרי exists under עתים AND under אמונה מחשבה וחסידות). Options laid out: topic as categories + audience/program as tags (phase 1, no developer), then a faceted model using the existing unused `sdarot` taxonomy for series (needs the theme developer). The user said it's "a topic of its own" — **not decided**.

**Why:** affects every automated post (lib/wordpress.js + data/wordpress/series-categories.json) and possibly ~9,500 existing posts.
**How to apply:** until decided, a new series is set up exactly like its siblings (e.g. a new עתים לתורה sub-series → category under 1495 + rabbi + וידאו + public YouTube playlist named as column B). Don't restructure categories without the user. Related: [[zohar-podcasts]].
