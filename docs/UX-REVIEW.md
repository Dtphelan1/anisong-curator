# UX review: suggestions and status

A design pass over the app as of 2026-11-12, made from screenshots of every
screen with live data at 1440 × 900 and 390 px wide. Items are grouped into
batches by priority. Tick them off as they ship; add new findings at the end.

## What prompted it
- **The review page was about 3,300 px tall on desktop.** The card, queue and
  Kept list were stacked in a 1,000 px column; after one manual search the
  queue sat about 1,600 px below the card, and clicking a queue row changed a
  card that was out of view.
- **Manual search listed every result:** 28 for one query, mostly 0-scored
  covers, each with its own audio player.
- **Settings and a long key legend sat inside the review card.**
- **The AniList section stayed on top of every step;** the songs step was mostly
  a wait screen.
- **Phone:** 23 px of horizontal scroll, an empty album-art box, and the action
  buttons below the fold.

## Batch A: keep the song under review in view ✅
- [x] **Two-pane review on desktop:** the card pinned on the left, a tabbed
  Queue / Kept / Later panel on the right, each scrolling on its own. Narrow
  screens stack them. The app is now 1,280 px wide.
- [x] **Height-capped candidate and search lists** with score bars; weak,
  cover and karaoke results collapse behind "show N more".
- [x] **One shared preview player** (▶/■ per row) instead of an audio player
  per row; it pauses the card's player and vice versa.
- [x] **Queue sort:** original, match status (confident → your pick → check me
  → unlikely → no match, or reversed), anime, song title, decision.
- [x] **Queue filter chips** with counts, and **group by anime** with
  per-show progress.
- [x] **Stable position:** the current song is tracked by key; the order
  stays frozen when a status changes (an "Order out of date · refresh" pill
  offers the re-sort); next/previous and "next undecided" follow the visible
  order.
- [x] **Phone:** no horizontal scroll; a failed album-art image no longer
  leaves an empty box.

## After review of batch A ✅
- [x] **A clear exit:** **Done · Export N →** in the review header, plus an
  "all songs decided" prompt, opening the Kept tab.
- [x] **Positional keys:** `1` keep / hold back, `⇧1` add anyway, `2` skip,
  `3` later. This frees the button wording ("Hold back" for songs you already
  have).
- [x] **The song box takes its status badge's colour** in every case, not only
  for songs you already have.
- [x] **No violet stripe on queue rows:** the badge is enough.
- [x] **Search YouTube** (separate window) when there's no match: title,
  artists, anime, OP/ED slug.
- [x] **Prev / Next moved above the queue,** with the position ("3 of 12",
  plus the total when filtered). It owns the ←/→ keys, so the action row holds
  decisions only.
- [x] **No "Already in your playlist" banner on the card:** it appeared and
  disappeared between songs, shifting the layout. The violet frame, the badge
  (hover for the matched row) and the Hold back / Add anyway buttons carry it.
- [x] **Bug: a failed search showed "Queued for matching…" forever.** The card
  now shows "Search failed" with **Try again** and **Search YouTube**, and the
  queue labels it "search failed" (listed under No match).

## Triage v2: a session in three phases ✅
A redesign from three approved mockups (split-pane triage, an already-have
pass, and an add-to-playlist page), for how the review is really used:
quarterly sessions of about 20–60 songs on a desktop with headphones, most
songs decided in the first seconds, unsure matches checked against YouTube and
the playlist and fixed on the spot. It replaces Batch A's card-plus-tabs
layout and the "Done · Export" exit.
- [x] **Three phases** with a phase bar ("1 · Review · N", "2 · Already have
  · N", "3 · Add to playlist", ✓ when finished, each clickable) and a **Next**
  button in the header. The Queue / Kept / Later tabs are gone: Kept, Later
  and Skipped are queue filters, and the export is phase 3.
- [x] **Songs you already have don't interrupt the review:** they get their
  own pass in the same split view, with the playlist's copy next to the match
  and reason chips. Skip is the default; `1` adds anyway. **Skip the rest**.
- [x] **Split view:** the queue on the left ("Queue · i of n", sort with
  **Watch order** first, a direction toggle, **By show** grouping on by
  default with AniList covers and decided / total, filter chips To decide /
  Check me / No match / Later / Kept / Skipped, a status dot per row), the song
  on the right.
- [x] **The song card says what to check:** show and "Opening 3" spelled out,
  a confidence pill, **From the show | Apple Music match** side by side with
  album art, and reason chips (artist matches, title differs, full version,
  cover?, soundtrack album…). This covers Batch B's side-by-side check.
- [x] **A real player:** big play/pause, a seekable progress bar, and a
  prominent **Autoplay** switch.
- [x] **Later is quieter,** and **Later: whole show** (`⇧3`) punts a show
  whose matches are all bad.
- [x] **"Not it?"** gathers YouTube, the in-playlist check, search or paste a
  link, and the other candidates. It opens by itself for check me, unlikely,
  no match and failed searches; it's one line for confident songs (`C`).
- [x] **Keys:** `J`/`K` as well as the arrows, one handler for the whole
  review, a compact legend at the foot of the song.
- [x] **Progress is saved:** the phase, the current song of each pass and the
  queue view survive a reload, which reopens the review where you were.
- [x] **Two "dones":** review complete (phases 1–2), and **Session done**
  after **Yes, mark as added** under "Did they land?" (with Undo).
- [x] **Palette:** the mockups' dark palette as design tokens, a light
  counterpart, Inter; text contrast ≥ 4.5:1 in both. This covers Batch D's
  contrast item.

## Playlist library ✅
From the "Playlist library" mockups: the playlist stops being a snapshot that
each import overwrites and becomes songs that persist across imports, each
linked to its show and OP/ED.
- [x] **Import with a diff:** add a file or paste, see new / missing /
  renamed / your adds confirmed / unchanged, watch the new songs link to
  shows, then **Save sync**. **Undo last sync** puts back the previous
  version. The same component serves setup ("Your playlist", no diff) and
  Settings ("Re-sync").
- [x] **Order you can trust:** only an ordered import (a Mac export in
  playlist order) sets the order; an iPhone re-sync keeps it and appends new
  songs. Confirmed adds go to the end at once.
- [x] **Linking without Apple Music lookups:** add log, reviewed matches,
  then names against every show's openings and endings. Unlinked songs are
  plain, not warnings.
- [x] **Your playlist:** All (playlist order, then adds since the sync), By
  show (newest watched first, missing OP/EDs as ghost rows, "Review the N
  missing"), Unlinked, Added, not seen; search, `J`/`K`, `L` takes the
  nearest guess; change a link or unlink in the detail pane.
- [x] **Playlist chip** for the header: synced, out of date (4 weeks),
  linking, or none yet, with a popover.
- [x] **Duplicate check by theme:** a playlist song linked to the same OP/ED
  counts even under a translated title ("linked to this song").
- [ ] **Wire-up** in the app shell: the header chip, the page's route,
  Settings → Playlist, setup's playlist step, and "suggest last show" in the
  anime page's quick start.
- [ ] *(Optional)* ▶ preview on a playlist row (one iTunes lookup, on demand).

## Batch B: faster, safer decisions
- [ ] **Undo toast** after each decision ("Kept *Hologram* (held back) ·
  Undo"), plus `U` to undo the last few.
- [x] **Side-by-side check for "check me" songs:** done in Triage v2 (without
  episodes, which weren't needed).
- [ ] **"Watch the OP/ED" link to AnimeThemes,** to confirm it's the song you
  remember.
- [ ] **Progress bar** (decided / matched / total) in place of the text
  "matching N more", with a retry action when iTunes throttles.
- [ ] *(Optional, conflicts with "every song is reviewed")* **"Keep all
  confident"** as an explicit, confirmed batch decision.

## Batch C: tidy the overall flow
- [ ] **Step bar:** AniList · Anime · Songs · Review · Export, with counts;
  finished steps collapse to one-line summaries. This also lets the pinned
  review card start at the top of the screen.
- [ ] **Skip or slim the songs step:** go straight to review (matching already
  runs in the background), or show a compact per-show song count.
- [ ] **One gear menu for settings:** store, TV size, autoplay, playlist name,
  insert songs.
- [ ] **One playlist status chip** ("🔥 AniSong MegaMix · 329 songs · synced
  2 h ago") opening a single Sync/Import dialog, replacing the two separate
  entry points.
- [ ] **Key legend in a `?` overlay** instead of inline text.
- [ ] **Picker:** a type-to-filter box, AniList cover thumbnails, song counts
  per show once known, and season grouping when sorted by date.

## Batch D: phone and accessibility
- [ ] **Phone:** a fixed bottom bar with Keep / Skip / Later; optionally swipe
  gestures.
- [ ] **Screen readers:** announce status changes ("matched", "kept") in a
  live region; return focus to the card after a decision.
- [x] **Contrast:** checked in Triage v2 (muted grey ≥ 7:1 in dark mode).

## Notes
- **Keep slows the next match a little.** Each Keep triggers a Japan-store name
  lookup (for duplicate matching) that shares iTunes' ~20/min budget with
  matching. Reviewing quickly, the next song can wait about 20 s. Fix: run
  those lookups only when matching is idle, or at export time.
- **Pinned panes and the top of the page:** the review panes pin once you've
  scrolled past the AniList section. Batch C's step bar removes that offset.
