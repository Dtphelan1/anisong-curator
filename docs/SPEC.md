# anisong-curator — Prototype Spec

Status: draft v0.6 · Scope: single-user, single-page prototype
Decision log: v0.2 drops the Apple Developer Program requirement. Apple Music
access goes through the keyless iTunes Search/Lookup APIs (read) and Apple
Shortcuts (playlist read/write). The MusicKit path is kept as an upgrade (§10).
v0.3 moves AnimeThemes from its deprecated REST API to GraphQL (§9.1).
v0.4 records what M3's live evaluation established about iTunes (§9.2).
v0.5 (M6) reads the playlist from a Music.app **export or pasted rows**
instead of the `Anisong Read Tail` shortcut (§9.5, §9.6).
v0.6 makes duplicate prevention app-side only, with likelihood tiers instead
of exact matching, fed by `Anisong Export Playlist` or a Mac export (§9.4,
§9.6); `Anisong Add Kept` just adds links.

## 1. User story

> As an avid anime fan and anisong listener, I want to periodically review the
> opening and ending songs from the shows I've watched and add them to an
> existing, running Apple Music playlist I maintain.

## 2. Corrections to the premise

1. **AniList has no OP/ED song data.** Its `Media` type has no themes field.
   Songs come from **AnimeThemes.moe**, which links its entries to AniList IDs.
   **Jikan (the MyAnimeList API)** is a fallback that returns themes as
   free-text strings. This third integration is the weakest link in the data
   pipeline.
2. **A "paid" AniList account changes nothing for the API.** Donating gets a
   supporter badge, not more API quota or different data. What matters is
   whether your list is **public or private**. That decides whether you need
   OAuth at all.
3. **No Apple API will give you the "add duplicate song?" prompt.** That dialog
   exists only in the Music app UI. The app does its own duplicate detection.
4. **Appends are hard to undo.** Neither Shortcuts nor the Web API can reliably
   *remove* specific tracks from a playlist. A **staging playlist** is the safe
   default, followed by a manual drag into the main playlist in the Music app.
5. **After the first run, the lower bound comes from saved state.** If the app
   saves its own cursor and every keep/skip decision, later runs only show new
   material. The lower-bound picker (Mode 1) and playlist-tail inference (V2)
   are for **bootstrapping** the first run, or recovering after you edit the
   playlist by hand. See §7.

## 3. External dependencies

| Service | Purpose | Auth | Approx. limits |
|---|---|---|---|
| AniList GraphQL (`graphql.anilist.co`) | Your anime lists, statuses, dates | None for public lists; OAuth implicit grant for private ones | 90 req/min nominal. It has run in a "degraded" 30 req/min mode, so code for 30 |
| AnimeThemes **GraphQL** (`graphql.animethemes.moe`) | OP/ED song title (romaji + native), artists, sequence, episodes; `findAnimeByExternalSite(site: ANILIST, id: [..])` batches 50–100 shows per call | None | 90 req/min, complexity ≤ 200, depth ≤ 15. CORS verified for `localhost:5173` |
| Jikan v4 (`api.jikan.moe`) — fallback | MAL theme strings, via AniList `idMal` | None | 3 req/s, 60 req/min |
| **iTunes Search API** (`itunes.apple.com/search`) | Catalog search: `trackId`, names, album, duration, `previewUrl`, `trackViewUrl` | None | **~20 req/min**, which is the binding constraint |
| **iTunes Lookup API** (`itunes.apple.com/lookup`) | Fetch or refresh tracks by ID, many IDs per call; check availability per country | None | Shares the ~20 req/min budget |
| **Apple Shortcuts** (macOS 12+ / iOS) | Read the playlist tail; create a staging playlist / append tracks | Runs as you, locally | None. Each run is user-triggered |

`trackId` from iTunes Search is the Apple Music catalog song ID, the same number
that appears in `music.apple.com/{cc}/song/{id}`. This is what makes the
keyless approach work. Confirm it in the spike.

## 4. Keys and accounts

- **None for Apple.** The only requirement is an **Apple Music subscription**
  on the Apple ID that owns the playlist, so that Shortcuts can add catalog
  tracks.
- **AniList client ID**, only if your list is private. Register one at
  `anilist.co/settings/developer` with the app's origin as the redirect URL
  (e.g. `http://localhost:5173/`; the implicit grant returns there with
  `#access_token=…`). The SPA uses the implicit grant, so it only needs the
  client ID. There is no secret.
- **A Mac or iPhone with Shortcuts**, with the two shortcuts in §6 built
  (`Anisong Add Kept`, `Anisong Export Playlist`).
- **Settings in the app:** AniList username, Apple Music country code (`us`, `jp`,
  …), and the target playlist's **name** (Shortcuts addresses playlists by name).

There are no secrets in this design, so nothing sensitive goes into the repo
or the bundle.

### 4.1 Setup and Settings
- **First visit** opens a welcome page (what a session is, what setup needs),
  then four steps: **AniList** (username; required), **Your playlist**,
  **Shortcuts** and **Preferences** (each skippable). Each step is saved as
  it's done or skipped, so a closed tab resumes where it was. Until AniList is
  done and every step is settled, the session pages redirect to setup.
- **Public lists need only a username.** The login (client ID + implicit
  grant) appears in setup only when AniList answers that the list is private;
  otherwise it lives in Settings › AniList.
- **Settings** (the ⚙ at the top left) is a panel over the current page, so
  opening it mid-review keeps your place. Sections: AniList (username, sync,
  which extra statuses the anime page lists, optional login), Playlist,
  Shortcuts (your own "built" checklist and the guide), Preferences (store,
  full or TV size, insert songs, autoplay), Data (clear caches, forget the
  last show added, run setup again).
- **Pages have URLs:** `#/welcome`, `#/setup/<step>`, `#/anime`, `#/review`,
  `#/playlist`, and `?settings=<section>` for the panel. Back and reload work.
  The AniList token is read from the hash before routing, and the login
  returns to the page it started from.
- **The AniList list** is read from IndexedDB at once and refreshed in the
  background when it's more than 12 hours old. The header's AniList chip shows
  its age and refreshes it on demand.
- **Upgrading:** settings carry a `defaultsVersion`. At version 3, a browser
  that already has a username and a loaded list is marked as set up (no
  setup) and shows a one-time note that the account and preferences moved to
  Settings.

## 5. Architecture

```
┌──────────────────── Browser SPA (Vite + React + TS) ─────────────────────┐
│ Setup → Pick anime → Songs → Review → Already have → Add to playlist     │
│                                                                          │
│ anilist.ts   themes.ts      matcher.ts +    itunes.ts                    │
│ GraphQL      AnimeThemes    matching.ts     iTunes Search / Lookup       │
│              + Jikan fb     (scoring)       (fetch, JSONP fallback)      │
│ playlistImport.ts + playlistLibrary.ts + dedupe.ts: playlist, dup tiers  │
│ per-host rate limiting · IndexedDB: caches, decisions, playlist, add log │
└─────────────────▲───────────────────────────────────────┬────────────────┘
                  │ paste into Sync playlist              │ Copy / Share…
┌─────────────────┴──────────── Apple Shortcuts ──────────▼────────────────┐
│ Anisong Export Playlist                 Anisong Add Kept                 │
│ (playlist → text)                       (links → playlist)               │
└──────────────────────────────── Music library ───────────────────────────┘
```

- A pure client-side SPA with no backend.
- **Catalog access** is `itunes.ts` (keyless Search/Lookup). A later
  MusicKit client (§10) could replace it without touching the matcher or the UI.
- **Library access goes through two Shortcuts (§6), handed text by the user,
  never called by the app.** The app copies the kept list (or offers the Share
  Sheet); `Anisong Add Kept` adds it. `Anisong Export Playlist` copies the
  playlist as text; the user pastes it into the app's **Sync playlist** box.
  There's no x-callback bridge: the clipboard and Share Sheet proved simpler
  and more reliable than launching shortcuts from the page.

### 5.1 Data model (IndexedDB)

```ts
Show       { anilistId, idMal, title{romaji,english,native}, format, season, seasonYear,
             status, completedAt, startedAt, updatedAt, createdAt, score, repeat, progress }
Theme      { themeId, songId (animethemes), anilistId, kind: 'OP'|'ED'|'IN', sequence,
             songTitle, artists[], episodes, source: 'animethemes'|'jikan' }
Match      { songId, trackId, country, trackName, artistName, collectionName,
             durationMs, previewUrl, trackViewUrl, confidence, candidates[], userConfirmed }
Decision   { themeId, decision: 'keep'|'skip'|'later', decidedAt }
CommitLog  { runId, trackIds[], target: 'staging'|'append', playlistName, at, confirmed }
RunCursor  { lastProcessedEntries: {anilistId → updatedAt}, sortField, committedAt }
PlaylistItem { id, title, artist, album, durationMs, position, origin: 'import'|'app',
               trackId?, addedBatch?, addedAt?, anilistIds[],
               link: null | {state:'linked', via:'add-log'|'exact'|'fuzzy'|'manual', hits[{themeKey, anilistId, slug}], confidence}
                          | {state:'unlinked', nearest?, manual?} }       // Dexie v5 playlistItems
PlaylistMeta { name, syncedAt, lastImport: {format, ordered, orderIsPlaylist, artistsKnown,
               sortedBy, warnings[], rowCount, diff} }                    // meta 'playlist'
PlaylistUndo { id, at, items[], meta }                                    // Dexie v5 playlistImports (one kept)
```

The **playlist library** (§9.6) replaced the v3 `PlaylistSnapshot`, which each
import overwrote. The v5 migration replays the latest snapshot and the add log
into it; `playlistSnapshots` stays, unused, for one version as a rollback. A
snapshot (`{name, rows, importedAt, format, ordered, …}`) is still available
as a read-only view of the library for screens written against it.

The **add log** (Dexie v4 `added`; the `CommitLog` above in the original design)
matters more here than it would with MusicKit. The playlist can only be read as
names and artists, never catalog IDs, so the app's own record of what it sent
is the most exact duplicate source (§9.4).

### 5.2 Pipeline

1. **Settings / connect.** Enter the AniList username (run OAuth if the list is
   private), the country, and the playlist name.
2. **Load lists.** One `MediaListCollection(userName, type: ANIME)` query
   returns every list. Chunk it if large, and cache it.
3. **Pick the anime** (§8): a multi-select list. The quick start is "everything
   newer than the last show added" (picked by hand or suggested by V2), then
   add or remove individual shows.
4. **Resolve themes** with AnimeThemes, falling back to Jikan. Cache permanently;
   negative results get a TTL (§9.1).
5. **Match** with iTunes Search (§9.2). This is the slow step because of the
   ~20 req/min limit. Run it in the background with a progress bar, so the
   review can start on matched items while the rest finish.
6. **Review: a session in three phases** (`src/components/review/`). Sessions
   are quarterly, about 20–60 songs, usually done in one sitting with
   headphones on a desktop. A phase bar under the header reads **1 · Review ·
   N**, **2 · Already have · N**, **3 · Add to playlist**, with ✓ on finished
   phases; each phase opens by clicking it, and the header's **Next** button
   advances (straight to Add to playlist when nothing is already in the
   playlist). Phases 1–2 finishing is "review complete"; the session is done
   only when the songs are confirmed in the playlist (step 7).
   - **Saved place.** Decisions are in IndexedDB as before; the phase, the
     current song of each pass, the queue view and the recorded batch are kept
     in `localStorage` (`session.ts`), and a reload mid-review reopens the
     review where you were. A session for other songs starts over.
   - **Phase 1, Review:** the songs with no "already have" hit, split view:
     queue on the left, the song on the right, each scrolling on its own.
     - **Song card:** the show, the theme spelled out ("Opening 3", "Ending 1",
       from kind and sequence: `themeLabel.ts`) and a confidence pill
       (**Confident · 100%**, **Check me · 73%**, **Unlikely**, **No match**,
       **Search failed**, **Your pick**). A two-column comparison, **From the
       show** (AnimeThemes title, native title, artists; no album, AnimeThemes
       has none) | **Apple Music match** (art, title, artist, album, length),
       with **reason chips** derived from the chosen candidate (`reasons.ts`):
       artist matches / similar / different artist, title differs, TV size /
       full version, cover?, karaoke, live, soundtrack album, not streamable,
       your pick, linked on AnimeThemes.
     - **Player:** the card's own `<audio>` on `previewUrl`, with a big
       play/pause, a seekable progress bar and an **Autoplay** switch
       (`role="switch"`, on by default; it applies from the next song). It and
       the candidate previews never play at once (`sampler.ts`).
     - **Decisions:** **Keep** `1` and **Skip** `2` are large; **Later** `3`
       and **Later: whole show** `⇧3` (every undecided song of the current
       show in this pass, for a show whose matches are all bad) are quiet.
       After a decision the next undecided song in the visible order opens.
       A song with a hit is not in this queue, but if you reach it anyway
       (say, a fix picked a track you have), Keep reads **Hold back** and
       **Add anyway** `⇧1` appears.
     - **Not it?** (`C`): **YouTube ↗** (a separate, reused window searching
       title, artists, anime and slug), the in-playlist check ("Not in your
       playlist", "In your playlist: #212"), search or paste a link (`/`), and
       the other candidates. Open by default for check me, unlikely, no match
       and failed searches; one line for confident ones. A pasted
       `music.apple.com/.../song/...` or `?i=` URL is parsed to a `trackId`
       and resolved with Lookup: an exact escape hatch for anything the
       matcher misses. A failed search shows **Try again**.
     - **Candidate and search lists** are height-capped, with a score per row;
       weak, cover and karaoke results collapse behind "show N more".
   - **Queue** (`queueView.ts`):
     - "Queue · i of n" with ←/→ buttons; sort by **Watch order** (the
       default, oldest show first), match status (confident → your pick →
       check me → unlikely → no match, or reversed), song title, decision or
       anime, with a direction toggle; **By show** grouping, on by default,
       with a header per show (AniList cover or a tinted placeholder, title,
       decided / total).
     - Filter chips with counts: All, To decide, Check me, No match, Later,
       Kept, Skipped.
     - Rows: a decision mark (`✓` kept, `⊘` held back, `✓+` add anyway, `…`
       later, `✕` skipped), the slug, the title and a dot coloured by match
       state.
     - The current song is tracked by **key**, not position. The order is
       **frozen**: a status change (e.g. no match → your pick) updates the
       row in place, and an **Order changed · refresh** pill offers the
       re-sort. The song you're on stays listed even after it leaves the
       filter or the pass.
     - The footer counts the songs set aside: "N already in your playlist ·
       their own pass next".
   - **Phase 2, Already have:** the same split view for the songs with a hit
     (any tier), in watch order. The comparison's left column is the
     playlist's copy (**In your playlist · #212**: title, artist, album when
     known, length) with chips such as "same title and artist", "different
     album", "match 3 s longer". **Add anyway** `1` keeps it with the
     override; **Skip** `2` is the default, and an undecided song here counts
     as skipped. **Skip the rest (N)** sits in the header.
   - **Keys:** `J` or `→` next, `K` or `←` previous (the visible order); `1`
     `2` `3` `⇧1` `⇧3` as above (by `e.code`, so any layout works); `space`
     play/pause; `C` Not it?; `/` search. One handler; none fire while typing.
     A compact legend sits at the foot of the song.
   - **Layout:** at ≥ 900 px the page fits the window and both panes scroll on
     their own; narrower, the song stacks above the queue.
7. **Add to playlist: dedupe and export** (§9.4). The songs to add, grouped by
   show in watch order, with summary chips (kept + added anyway, skipped,
   already have and skipped, left for later, not decided), beside three
   steps:
   1. **Playlist checked:** the playlist's age, size and linked songs, and **Sync playlist**
      (paste what `Anisong Export Playlist` copied, or a Mac export).
   2. **Copy, then run `Anisong Add Kept`:** **Copy N songs** (or **Share to
      the shortcut…**), in watch order. The export format is a small option
      (Shortcut, Text + links, JSON).
   3. **Did they land?** **Yes, mark as added** records the batch in the add
      log (so it's never exported again) and shows **Session done**, with
      Undo. **Not yet** leaves everything as it is.

## 6. Shortcuts

Shortcuts can't be generated as files from the repo; you build them once by
hand. **Build steps live in the shortcuts setup guide,
[`shortcuts/README.md`](../shortcuts/README.md).** This section is the
*contract* each shortcut must meet, so either document can be reorganized
without breaking the other. Refer to shortcuts by name, not by where they're
documented.

### 6.1 `Anisong Add Kept`: add songs
- **Input:** text from the Share Sheet, or the clipboard when run without
  input. Any text containing `music.apple.com/{cc}/song/{id}` links. The app's
  Shortcut format puts one song per line (`Title | Artist | link`), but only
  the links are used.
- **Behavior:** extract the links in order, then add them to the target
  playlist, or create `anisong-curator <date>` with them. **No duplicate
  checks:** the app does those (§9.4).
- **Status:** verified on iOS 2026-11-12 (new playlist); appending to the
  existing playlist hasn't been confirmed yet.

### 6.2 `Anisong Export Playlist`: read the playlist
- **Input:** none.
- **Output (clipboard):** the `anisong-playlist v2` text that the app's
  **Sync playlist** box parses (`playlistImport.ts`):
  ```
  anisong-playlist v2
  <playlist name>
  ---count---
  <N, the number of songs>
  ---titles---
  <exactly N lines: one title per song>
  ---artists---
  <exactly N lines: one artist per song, same order>
  ---durations---
  <exactly N lines: whole seconds per song, same order; section optional>
  ```
  The sections are parallel lists of exactly N lines. **Every line under a
  heading is a value; there are no separator lines.** A blank line is an
  empty value (a song with no artist) and keeps its place. The count is what
  makes that unambiguous.
- **Durations** are plain whole seconds (e.g. `238`). The parser also accepts
  fractions, `m:ss` and `h:mm:ss` leniently.
- **Validation:** a section shorter than N isn't zipped. The app warns and
  matches that import without it (titles only, or no durations). Lines beyond
  N are ignored, with a warning.
- **v1** (no `---count---`) is still read. Its lists are aligned by trimming
  trailing blank lines, which can't tell a separator from a blank last value.
- **Constraints:** read-only, and no per-song loop (it must stay fast on a large
  playlist). Row order isn't guaranteed to be playlist order, so it's used for
  duplicate checks only. The "suggest last show" feature (§9.5) needs an
  ordered Mac export.

### 6.3 Manual fallback: link checklist
If adding from links ever stops working, the songs to add become a checklist of
`music.apple.com` links in order. Each opens in Music, and you add it with
"+". That's tolerable at ~10–25 songs a season, and still saves all of the
discovery and review work.

### 6.4 Retired
- **Spike shortcuts** `Anisong Echo`, `Anisong Read Tail` and `Anisong Add
  Tracks` answered the feasibility questions in §11. The app doesn't use them;
  the setup guide keeps their build steps for re-running the spike page.
- **Duplicate check inside the add shortcut.** It was too slow and only matched
  exact text, so it was replaced by the app-side check (§9.4).

## 7. Saved state instead of a lower bound (recommendation)

- **First run:** lower-bound picker (Mode 1) or tail inference (V2).
- **Later runs:** start from `RunCursor`, plus any show whose `status` or
  `updatedAt` changed since the last run. This catches CURRENT → COMPLETED
  transitions and dates you backfilled. Themes that already have a `Decision`
  are hidden by default.
- Keep a "rewind to…" picker for manual override.

A position in a sorted list misses shows whose sort key changes after the fact.
Diffing against saved state doesn't.

## 8. Ordering and picking the anime

Sort fields: `completedAt`, `startedAt`, `updatedAt`, `createdAt` (added),
`score`, `progress`, `repeat`, and title. These mirror AniList's
`MediaListSort`. Sorting happens **client-side**.

- **Bucket A**, sorted by the chosen field: `COMPLETED`, `DROPPED`, `PAUSED`.
- **Bucket B**, after all of A: `CURRENT`, `REPEATING`.
- `PLANNING` is excluded.
- **Default display: newest first.** Review and export always run oldest →
  newest (playlist order), whatever the display direction.

Edge cases:
- **Fuzzy dates.** Any of `{year, month, day}` can be null. Sort key:
  `(year ?? -∞, month ?? 0, day ?? 0)`, with a "no date" badge.
- **Dropped and paused shows have no `completedAt`.** Fall back to `updatedAt`,
  which changes on any edit, so label it as a proxy.
- **Rewatches** may already be in the playlist. The duplicate check (§9.4)
  handles this.
- **Seasons and sequels** are separate media with separate themes.
- Dropped and paused shows are listed (each can be turned off) but never
  pre-selected by a quick start (§8.1).

### 8.1 Picking which anime to add
The page asks **"Which anime would you like to add?"**: quick starts on the
left, a navigable multi-select list on the right, and a footer that stays in
view. The "last show added" is the quick way in, not the only one.

- **Model** (`selection.ts`): a **base** (the quick start) plus per-show
  **include** and **exclude** lists of AniList IDs. Bases:
  - `newer` (**After the last show added**): everything more recent than
    `boundId`, or everything with no bound. The default; shows you finish
    later join automatically.
  - `since` (**Finished since** a date): completed shows whose AniList
    completion date is on or after it. Completion date only, so it means
    "everything I finished since my last session"; the date defaults to the
    last session. *Provisional: under review, since `newer` may already
    cover it.* The page explains this under a "?".
  - `latest` (**The last N shows I finished**): the N most recently
    completed shows.
  - `none` (**Pick by hand**) and `all` (the `A` key).

  `newer`, `since` and `latest` always include shows in progress (Watching,
  Rewatching; an airing show with no songs listed yet never blocks the
  lookup) and never pre-select dropped or paused ones. Switching quick
  starts keeps hand edits ("N hand changes · reset" in the footer) and
  remembers the date and N. Stored in settings.
- **The list:** cover, title, format (when not TV), a status line
  ("Completed Nov 3", "Watching · ep 7 · airing", "Dropped · updated Sep 2"),
  a ♪ song count from cached lookups only ("–" for none, "?" when not looked
  up yet) and, with a playlist, "n/m in playlist". Grouped by season of the
  sort date (Watching now first when newest-first), each group with a
  selected count and a toggle. A **divider** marks the last show added:
  everything above it (newest-first) is newer.
- **Filter:** `/` focuses it; it matches any title script; Esc clears it.
  Filtering hides rows without changing the selection.
- **Mouse:** click toggles a show; **Shift**-click sets the range from the last
  click to the same state; **Alt/Option**-click marks a show as the last added
  (selects everything newer); **Cmd/Ctrl**-click selects only that show.
- **Keyboard** (anywhere on the page unless typing): `↑`/`↓` or `J`/`K` move;
  `Space` toggles; `Shift`+`↑`/`↓` extends; `L` marks the last added; `A`, `N`
  and `I` select all, none, or invert; `↵` finds songs.
- **Footer:** "N shows selected · ~M songs, + K shows not looked up yet" (from
  the cache), hand changes with reset, and **Find songs**.
- **The V2 suggestion** (§9.5) appears inline under "After the last show
  added" ("Your playlist now ends with songs from …"); **Use** sets the bound
  and switches to `newer`.
- **Finding songs is a footer, not a page.** Find songs locks the list and
  turns the footer into a progress bar ("Looking up songs · 9 of 14 shows · 23
  songs so far", Cancel); each row shows its state (looking…, ♪ 3, or why it
  has none, §9.1). When it finishes, Review opens by itself. Shows without
  songs are summarized in one line and never block. Only an AnimeThemes
  failure stops it, with **Retry** and **Review the rest**.


## 9. Technical and integration challenges

### 9.1 Theme coverage
- **Use the GraphQL API, not REST.** The REST/JSON:API (`api.animethemes.moe`)
  is officially deprecated ("will be removed") and returned 503 for every
  request on 2026-11-11, which is what broke the first spike run. GraphQL was
  up with CORS for `localhost:5173`. One call covered 17/18 recent shows.
  The docs name the query `filterAnimeByExternalSite`; the live schema calls
  it `findAnimeByExternalSite`. Trust the schema.
- `Song.resources` can carry `APPLE_MUSIC` / `SPOTIFY` links. When present,
  that's an exact catalog ID and skips matching. It was empty for all 22 songs
  sampled, so treat it as a bonus.
- AnimeThemes is strong for TV anime since ~2000, and weak for older shows,
  ONAs, shorts, and **currently airing shows** (data lags by days to weeks).
  Retry these on the next run (negative-cache TTL).
- Exclude `IN` (insert songs) by default. Dedupe reused songs by `song.id`.
- Jikan strings (`"1: \"Gurenge\" by LiSA (eps 1-26)"`) are parsed with a regex
  and flagged as low-confidence.
- **Jikan is best-effort.** Each request gets 8 s and one retry. On
  2026-11-12 it accepted connections and reset them after ~10 s, which made
  every visit to the songs step wait and then report an uncached error. Now:
  - The first Jikan failure in a run stops Jikan for the rest of that run.
  - A show AnimeThemes doesn't have and Jikan couldn't be asked about is
    cached as "no songs" marked *incomplete*, and rechecked after 1 day
    (7 days for a confirmed "no songs"). Re-fetch forces it sooner.
  - Only an AnimeThemes failure is an error (uncached, retried next time).
  - AnimeThemes requests get 30 s.
- **No songs is normal for some formats.** Movies, specials, OVAs and shorts
  often have no OP/ED, or one theme song not listed as either. The song
  lookup (§8.1) labels them by format ("Movie · no opening/ending listed", neutral) and
  keeps the warning style for TV and ONA series. A show still airing gets
  the neutral "airing · songs not listed yet" (rechecked weekly, as above).
  Music videos skip Jikan.

### 9.2 Matching on a 20-requests-per-minute budget
The old problems remain: romaji vs native script, TV size vs full, karaoke
spam, regional availability. Now they come with a tight query budget and **no
ISRC**.

- **Query budget.** Aim for 1–2 searches per theme on average.
  1. `term = "<title> <primary artist>"`, `entity=song`, `limit=25`,
     `country=<cc>`.
  2. Only if the top score is below 0.6: `term = "<title>"`.
  3. Only if still below 0.6, and native titles are available: repeat the
     search with `country=jp`, then **Lookup** the winning `trackId`(s) with
     `country=<cc>`. Lookup takes comma-separated IDs, so this is one call. It
     works if catalog IDs are shared across storefronts. Verify that in the
     spike.

  A typical season (~25 themes) costs ~35–50 requests, or 2–3 minutes. Start
  reviewing as matches arrive.
- **Scoring.** Normalize (lowercase, NFKC, strip punctuation, brackets,
  `feat.`, `(TV size)`), then token-set similarity on title and artist. Add a
  bonus when the album name contains the anime title or "OP/ED/Opening/Ending".
  Penalize `karaoke|instrumental|cover|remix|off vocal|tv size` unless the
  source says so. Use `trackTimeMillis` to separate TV size (~1:30) from full
  versions.
- **Thresholds.** ≥ 0.85 pre-selected, 0.6–0.85 "check me", < 0.6 "manual". All
  matches are still shown in review.
- **Cache confirmed matches** by AnimeThemes `song.id`. Never search for them
  again.
- **Pasting a URL** (§5.2 step 6) is the exact override.

**Verified in M3 (live evaluation, 22 themes, US store):**
- iTunes sends `access-control-allow-origin: *`, so plain `fetch` works.
  `trackViewUrl` is `music.apple.com/...?i=<trackId>`, so `trackId` is the
  Apple Music song id.
- **Track ids are global across storefronts; only names are localized.** JP
  returns native script, while the US may romanize or *translate*:
  "B no Revenge" → "Revenge of B", and "Golden Time Lover" → "Golden Time
  Rubber" (sic). JP-store hits are therefore looked up in the user's store
  (one batched Lookup) and scored on **both** names. Flags are the union, so
  a cover can't hide behind a storefront whose name omits "(From …)".
- Cover factories title tracks `X (From "Anime")`. Official releases don't,
  so that pattern is flagged as a cover. Soundtrack albums are penalized
  because they often hold same-named composer tracks.
- The search stops only on a confident match: score ≥ 0.8, or ≥ 0.55 with
  an artist match. A strong title with the wrong artist is usually a cover,
  so the search keeps looking for the original.
- Result: 20/22 correct top picks. The 2 doubtful ones are marked
  "check me", none are auto-accepted wrong, and no covers win. That took
  37 requests for 22 themes (~1.7 each, <2 min at 20/min).
- AnimeThemes `APPLE_MUSIC` song links cover ~1–10% of songs, as
  `/jp/song/{id}` or `/jp/album/{id}`. All of them resolve in ONE Lookup
  call (albums expand to tracks) before any search runs.

### 9.3 iTunes Search API quirks
- **CORS.** Historically it allows browser `fetch`, but this has been
  inconsistent. It does support **JSONP** (`callback=`). `catalog.ts` uses a
  transport that tries `fetch` and falls back to JSONP. A last resort is
  `vite dev` proxy config, which is local only.
- **Throttling** is undocumented. Expect 403/429 above ~20/min. Use a global
  token bucket (1 per 3 s), exponential backoff, and pause the queue when
  throttled.
- **Previews.** `previewUrl` is a ~30 s AAC that plays in a plain `<audio>`
  element. That is enough to judge a song, and it needs no login.
- **`isStreamable`** may be false for some tracks. Down-rank them, because
  Shortcuts can't add them as streaming tracks.

### 9.4 Duplicate prevention

**Goal:** never add a song that is already in the target playlist, without
silently dropping one you meant to add. No API offers a duplicate prompt or
lets us remove a track afterwards, so prevention has to happen before adding.

**App-side only.** The check runs in the app, against two sources:
- **The playlist library** (§9.6), refreshed with **Sync playlist** in the Add
  to playlist step (or Re-sync from the playlist chip): paste the text
  `Anisong Export Playlist` copies (format: §6.2), or import a Mac export
  (§9.5). The import shows what changed before saving. Add to playlist shows
  the playlist's age, size, source and how many songs are linked, and flags
  it when there's none or it's over 4 weeks old.
- **The add log.** When you press **Yes, mark as added** after running
  `Anisong Add Kept`, the exported batch is recorded (`trackId`, title, artist,
  duration, batch, time; undoable). It covers what the app added since the
  last sync, so a stale playlist still catches the app's own additions.

`Anisong Add Kept` is the simple shortcut (§6.1): it adds every link it's
given. The earlier design's second layer, a diff inside the add shortcut, is
dropped: it was slow and flaky on a large playlist, and could only compare
exact text.

**Likelihood, not equality.** The playlist exposes only names (no catalog
IDs or ISRCs), and the same song is often named differently: 紅蓮華 vs
"Gurenge", "Revenge of B" vs "B no Revenge", "SCANDAL (JP)" vs "SCANDAL". Each
kept song is scored against the playlist's songs and the add log
(`dedupe.ts`):
- **Names on the song's side:** the catalog title and artist, plus the
  theme's romaji/native titles and artists (AnimeThemes), plus the track's
  name in the JP store (one batched iTunes lookup for the kept tracks, cached;
  AnimeThemes often lacks the native title). A track titled as a cover
  (`(From "…")`, karaoke) doesn't borrow the theme's original artists.
- **Title similarity:** Dice on character bigrams of the core title (version
  suffixes stripped), whitespace-insensitive so it works for CJK; the best over
  all the song's titles.
- **Artist similarity:** best over the song's artists × the row's artists
  split on `&`, `,`, `feat.` …; one name inside the other counts 0.95. No
  artist on a side (or an import whose lists didn't line up) is *unknown*,
  not a mismatch.
- **Duration:** within ±3 s supports "same recording"; ≥ 20 s apart, or a
  TV size / live / remix / acoustic / instrumental flag on one side only,
  means another cut.
- **Theme level:** a playlist row linked (confidence ≥ 0.8) to the same OP/ED
  as the kept song, or an add-log record with the same theme key, is at least
  **likely duplicate** even when the names share nothing (a translated
  title); another cut of it is **other version**. A stronger name match still
  wins. The hold reason says "linked to this song".

| Tier | Rule | Default |
|---|---|---|
| **Repeat in batch** | Same `trackId`, or same normalized title + artist, twice in one export (one song used by two shows) | Drop the extras, always |
| **Duplicate** (already in playlist / already added) | Title ≥ 0.9, artist ≥ 0.8, duration ±3 s or unknown; or the same `trackId` in the add log | Hold back, can override |
| **Likely duplicate** | Title ≥ 0.75 and artist ≥ 0.6 but not a duplicate (e.g. 3–20 s apart); or title ≥ 0.9 with unknown artist and nothing contradicting | Hold back, can override |
| **Other version** | Title ≥ 0.8, artist ≥ 0.6, another cut (above) | Hold back, can override |
| No match | Title < 0.75, or artist < 0.6 (a cover, or an unrelated song with the same title: "Again" by someone else) | Exported |

Thresholds are tuned on real AnimeThemes and iTunes names in
`dedupe.test.ts`. When both sources match, the stronger tier wins (the add log
on ties). Rows are indexed by title bigrams, so a 2,000-row playlist × 50 kept
songs takes tens of milliseconds.

**In the UI.** The review uses the same scoring, so what the review says is
what the export does.
- **Every song is still reviewed,** but songs with a hit (any tier) don't
  interrupt the main review: they get their own pass, **Already have**, after
  it, in the same split view. Skip is the default there (an undecided one
  counts as skipped); **Add anyway** (`1`) exports it regardless. A song you
  kept that the app then recorded as added stays where you decided it.
- **One "already have" colour** (violet `--have`, distinct from the confidence
  and warning colours) marks it everywhere: the pill ("already in playlist" is
  filled; "likely" is outlined; "other version" is dashed), the comparison's
  **In your playlist · #pos** column, the in-playlist chip under **Not it?**,
  and the queue's score.
- **If such a song is reached during the review anyway**, Keep becomes **Hold
  back** (`1`) and **Add anyway** (`⇧1`) overrides it. The override is stored
  on the decision (`addAnyway`), so both passes and the export agree and it
  survives reloads. Recording the batch clears it (Undo restores it).
- **Queue markers say what will happen:** `✓` exported, `⊘` kept but held
  back, `✓+` add anyway, `…` later, `✕` skipped.
- **Add to playlist** (with **Sync playlist**, reachable from the review's
  queue footer when nothing is synced, so the passes split early) lists only
  what will be copied; anything still held back (listed twice, or found since)
  sits under **Held back**, with its reason, the matched row, the tier and the
  score, and **add anyway**.

**Open:** does the Shortcuts **Add to Playlist** action skip songs already in
the playlist? (The Music app asks; Shortcuts may add silently.) Either way the
app must catch them first, because a silent duplicate can't be undone from
Shortcuts.

### 9.5 V2: inferring the lower bound from the playlist tail
1. **Import the playlist** (M6): Music.app → File → Library → Export
   Playlist… (Plain Text: tab-separated, usually UTF-16LE + BOM with CR line
   endings, `Time` in seconds; columns found by header name), or ⌘C rows
   pasted from the song list (no header; Name / m:ss Time / Artist / Album are
   guessed and shown for checking). It goes into the playlist library (§9.6).
   Music.app exports (and copies) rows in the window's current sort, not
   playlist order: if ≥ 90% of the adjacent pairs that differ run one way by
   Name, Artist or Album, the import is marked `ordered: false` and the app
   asks for an export with View → Sort By → Playlist Order. Text from
   `Anisong Export Playlist` is always `ordered: false` (§6.2). This replaces
   the `Anisong Read Tail` shortcut for reading: no x-callback round trip, and
   the whole playlist arrives at once. Parser: `playlistImport.ts`; matching:
   `tailInference.ts`; the library: `playlistLibrary.ts`.
2. Build an index of normalized `title|artist` keys from the themes of every
   Bucket A/B show. This needs one-time theme resolution for the whole list.
   With batched GraphQL lookups that's ~10 requests for 500 shows, a few
   seconds. Cache it forever. **No iTunes queries are needed.** This is
   name-to-name matching, not catalog matching. (Jikan is skipped here to
   keep it cheap; Jikan-only shows can't be inferred.)
3. Map each tail track to `{show, confidence}`, or to "not an anisong". A
   cached catalog match with the same normalized title + artist is exact
   (confidence 1). Otherwise the row is scored with the matcher's
   `scoreTrack()` against every theme that survives a bigram prefilter. The
   album name ("… Opening Theme") and the anime title in the track name are
   extra signals. Accept ≥ 0.6 **and** (artist agrees **or** the show is
   named): a title alone ("Personal" by someone else) is not evidence.
   Fixture result on US-store names (translated, mistranslated, localized
   artists, plus same-title non-anisongs and covers): 19/19 rows right.
4. Suggest **the most recently watched show with a linked song** (completion
   date, else last list update), not simply the last playlist track: playlist
   order and watch order disagree whenever songs were added out of order.
   Because every song is linked, this works from an unordered import too.
   When the stored order is playlist order, the show of the last linked row is
   reported alongside as a cross-check when it differs.

Once saved state (§7) exists, V2 becomes a drift check: does the tail match
the CommitLog?

### 9.6 Other
- **Playlist library.** The one playlist (§5.1) as songs that persist across
  imports, each linked to what the app knows. Three sources feed it, each
  holding the whole playlist:
  - **Mac export** (§9.5): ordered unless the window was sorted by a column.
  - **`Anisong Export Playlist`** text (§6.2), pasted into **Sync playlist**
    on any device: `ordered: false`, because the order **Find Music** returns
    is unverified. If its lists don't line up, artists (or durations) are
    dropped for that import (`artistsKnown: false`) rather than zipped.
  - **⌘C rows** pasted from Music: columns guessed.

  **Import:** nothing is saved until you've seen the diff. A row is the same
  song when its normalized title and artist match and its length is within
  ±3 s (true repeats stay separate). Then: songs the app added that the
  import contains are **confirmed**; leftover old × new rows at the
  duplicate tier are **renamed** (the link is kept); the rest are **new** or
  **missing**. Missing songs drop out of the library; deliberate deletes
  aren't tracked, so one that comes up again is suggested like any other
  song. **Undo last sync** restores the previous library (one step).

  **Order:** an ordered import sets every position. An unordered one keeps the
  stored order (renamed and unchanged songs stay put), appends its new songs
  and drops the missing ones; it never reorders. **Yes, mark as added**
  appends the batch at once, in watch order; a later ordered import shows
  where they really are, and one that doesn't contain them leaves them as
  **added, not seen**. The order is labelled "in playlist order" or "in
  import order".

  **Linking** (no iTunes requests): the add log (exact), reviewed catalog
  matches (exact), then the §9.5 name matching against the themes of every
  show on the list (≈ one AnimeThemes call per 50 shows, cached; Jikan only
  if asked). A manual link or unlink is never overwritten. **Unlinked is not
  a problem:** songs from shows that aren't on the AniList list stay
  unlinked and searchable, and the duplicate check still finds them by name.

  **Where it shows:** a playlist chip (synced, out of date after 4 weeks,
  linking, or none yet) with a popover; **Your playlist** (all songs in
  order, by show with each show's missing OP/EDs as ghost rows, unlinked,
  added but not seen; search; change a link); coverage per show ("2/3 in
  playlist") for the anime picker; and the import in setup and Settings.
  Sync before exporting whenever the playlist changed outside the app.
- **x-callback length.** The result goes into a URL. Keep tail reads small
  (n ≤ ~100) and use the clipboard for anything larger.
- **Playlist names aren't unique.** The Shortcut picks the first match. Tell
  the user to keep the target name unique.
- **The browser→Shortcuts handoff needs a Mac or iOS device.** On Windows or
  Linux, only the manual link checklist works.
- **AniList auth.** A private profile or `hiddenFromStatusLists` entries need
  OAuth. A 401 triggers re-auth.

## 10. Upgrade path: MusicKit (Apple Developer Program, $99/yr)

Kept for later. It replaces only `MusicProvider`:
- A developer token (ES256 JWT from a Team ID, a Key ID, and a `.p8` with
  MusicKit enabled, minted by a local script, valid ≤ 6 months) plus the Music
  User Token from MusicKit JS `authorize()`.
- Gains: ISRC-exact dedupe and storefront joins, full playlist reads by
  catalog ID, and in-app create/append with no Shortcuts round trip. No 20/min
  ceiling.
- Still missing: track removal, a duplicate prompt, and (historically)
  reliable appends to playlists the app didn't create.

## 11. Spike list (verify before building on these)

Network probes weren't possible while this spec was written. In priority order:

1. ✅ **Resolved 2026-11-12 (iOS):** the `Anisong Add Kept` shortcut created a
   new playlist from `music.apple.com/us/song/<id>` links, so links do turn into
   music items. Appending to the existing playlist hasn't been confirmed yet.
   Original question: **Shortcuts: catalog ID/URL → added to a playlist.** Can "Add to Playlist"
   (or Add to Library, then Add to Playlist) accept a `music.apple.com` song URL
   for a song that isn't in your library? Test on both macOS and iOS. If this
   fails, adding falls back to the manual link checklist (§6).
2. *Superseded:* playlist reads now use the Music.app export (§9.6, M6).
   Original question: **Shortcuts: playlist items in playlist order**, and which properties
   (title, artist, album, duration) can be read.
3. *Not needed:* `Add Kept` takes the list from the clipboard or Share Sheet.
   Original question: **x-callback round trip**: `x-success` with `result` back to
   `localhost:5173/bridge`, in your browser of choice.
4. ~~**iTunes Search** from the browser: CORS, `trackId` = Apple Music ID.~~
   Resolved (§9.2). Still open: the real throttle limit.
5. ~~**Cross-storefront IDs**~~. Resolved: ids are global (§9.2).
6. ~~**AnimeThemes**: lookup by AniList external ID, batching, CORS.~~
   Resolved: GraphQL `findAnimeByExternalSite`, batched, CORS OK (§9.1).
7. AniList's current rate limit (the `X-RateLimit-Limit` header).

## 12. Milestones

| # | Deliverable | Proves |
|---|---|---|
| M0 | Spikes 1–4 (one HTML page + two hand-built Shortcuts) | The keyless loop is feasible |
| M1 ✅ | AniList load + ordering UI + lower-bound picker | §8 rules |
| M2 ✅ | Theme resolution + cache | Coverage on *your* list (log hit rate) |
| M3 ✅ | iTunes matcher + review UI with previews + URL paste | Match precision within the 20/min budget |
| M4 ✅ | Kept-list export (links / text / JSON) + `Anisong Add Kept` shortcut (staging verified on iOS) | End-to-end Mode 1 |
| M5 | Decisions + CommitLog + cursor (§7), dedupe | Periodic use without re-picking |
| M6 ✅ | Playlist import (export / paste) + V2 tail inference + snapshot dedupe badge | First-run bootstrap / drift detection |

Stack: Vite + React + TypeScript, Dexie, plain `fetch` (with a JSONP helper),
and `fastest-levenshtein` or a small token-set ratio. Test the matcher against
~50 known anisong → `trackId` pairs taken from your own playlist. You can get
them by pasting share links from the playlist.
