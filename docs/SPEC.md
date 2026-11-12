# anisong-curator — Prototype Spec

Status: draft v0.5 · Scope: single-user, single-page prototype
Decision log: v0.2 drops the Apple Developer Program requirement. Apple Music
access goes through the keyless iTunes Search/Lookup APIs (read) and Apple
Shortcuts (playlist read/write). The MusicKit path is kept as an upgrade (§10).
v0.3 moves AnimeThemes from its deprecated REST API to GraphQL (§9.1).
v0.4 records what M3's live evaluation established about iTunes (§9.2).
v0.5 (M6) reads the playlist from a Music.app **export or pasted rows**
instead of the "Read Tail" Shortcut (§9.5, §9.6).

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
  `anilist.co/settings/developer` with redirect URL
  `http://localhost:5173/callback`. The SPA uses the implicit grant, so it only
  needs the client ID. There is no secret.
- **A Mac or iPhone with Shortcuts**, and the two shortcuts in §6 installed.
- **Settings in the app:** AniList username, Apple Music country code (`us`, `jp`,
  …), and the target playlist's **name** (Shortcuts addresses playlists by name).

There are no secrets in this design, so nothing sensitive goes into the repo
or the bundle.

## 5. Architecture

```
┌──────────────────── Browser SPA (Vite + React + TS) ─────────────────────┐
│ Wizard: Connect → Load lists → Lower bound → Resolve → Review → Commit   │
│                                                                          │
│ anilist.ts   themes.ts      matcher.ts     catalog.ts (MusicProvider)    │
│ GraphQL      AnimeThemes    queries +      iTunes Search / Lookup        │
│              + Jikan fb     scoring        (fetch, JSONP fallback)       │
│        └──── per-host rate-limited queue (token bucket, 429/403 backoff) │
│                     IndexedDB (Dexie): cache + decisions + cursor        │
│                                                                          │
│ shortcutsBridge.ts ── shortcuts://x-callback-url/run-shortcut?... ───────┼──┐
│        ▲  x-success → http://localhost:5173/bridge?result=<json>         │  │
└────────┼─────────────────────────────────────────────────────────────────┘  │
         │                                                                     ▼
         │                                ┌─────────── Apple Shortcuts ─────────────┐
         └────────────────────────────────│ "Anisong · Read Tail"  (playlist → JSON)│
                                          │ "Anisong · Add Tracks" (IDs → playlist) │
                                          └──────────────── Music library ──────────┘
```

- A pure client-side SPA with no backend.
- **`MusicProvider` interface** (`search`, `lookup`, `readPlaylistTail`,
  `addTracks`, `createPlaylist`). The keyless implementation is
  `ItunesShortcutsProvider`. A later `MusicKitProvider` (§10) can be added
  without touching the matcher or the UI.
- **Shortcuts bridge.** The app starts a shortcut through the
  `shortcuts://x-callback-url/run-shortcut` URL scheme, with
  `input=text&text=<json>`. The shortcut's output comes back as a `result`
  query parameter on the `x-success` URL, which points at the app's
  `/bridge` route. Fallback when x-callback is flaky (e.g. Safari vs Chrome
  handling): **clipboard**. The shortcut copies the JSON and the app has a
  "paste result" box.

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
PlaylistSnapshot { name, rows[{position, title, artist, album, durationMs}], importedAt }  // Dexie v3
```

`CommitLog` matters more here than in the MusicKit design. The playlist can only
be read through a Shortcut that lists names and artists, so the app's own record
of what it sent is the most exact duplicate source.

### 5.2 Pipeline

1. **Settings / connect.** Enter the AniList username (run OAuth if the list is
   private), the country, and the playlist name. A one-time "test bridge" button
   round-trips a no-op through Shortcuts.
2. **Load lists.** One `MediaListCollection(userName, type: ANIME)` query
   returns every list. Chunk it if large, and cache it.
3. **Order shows** (§8). Pick a lower bound (Mode 1), or let V2 suggest one.
4. **Resolve themes** with AnimeThemes, falling back to Jikan. Cache permanently;
   negative results get a TTL.
5. **Match** with iTunes Search (§9.2). This is the slow step because of the
   ~20 req/min limit. Run it in the background with a progress bar, so the
   review can start on matched items while the rest finish.
6. **Review.** A card per theme: show, OP1/ED2, matched track, confidence badge,
   and a `<audio>` player on `previewUrl`. Keys: `K` keep, `S` skip,
   `L` later, `←/→`, `space`, `C` candidates, `/` manual search. Manual search
   also accepts a pasted `music.apple.com/.../song/...` or `?i=` URL, which is
   parsed to a `trackId` and resolved with Lookup. This is an exact escape hatch
   for anything the matcher misses.
7. **Commit.**
   1. Run "Read Tail" to refresh `PlaylistSnapshot`.
   2. Show the confirmation screen: new tracks, likely duplicates (each one
      toggleable), and unmatched themes (exported as text).
   3. Run "Add Tracks" with `{mode: 'staging'|'append', playlist, trackIds}` in
      chronological order.
   4. Write `CommitLog` as *pending*.
   5. Run "Read Tail" again to **verify** the tracks landed, then mark the log
      *confirmed* and advance `RunCursor`.

## 6. The two Shortcuts

Shortcuts can't be generated as signed files from the repo. The repo ships
build instructions (`shortcuts/README.md`), and you make them once by hand, or
import them from an iCloud share link you create.

### 6.1 "Anisong · Read Tail"
Input: `{"playlist": "<name>", "n": 30}`
1. Get Dictionary from Input → playlist name, n.
2. **Get Playlist** named *playlist*, then **Get Items from** it. Verify that
   these come back in playlist order.
3. Take the last *n* items (Get Items from List, range).
4. Repeat with each item → Dictionary
   `{title, artist, album, durationMs}` → add to a list.
5. Return the list as JSON text. The x-callback `result` carries it back.
   Also Copy to Clipboard as a fallback.

Limitation: music items in Shortcuts expose names, album, duration, and date
added, but **not the catalog ID or ISRC**. The app has to match the tail by
normalized title + artist (+ duration).

### 6.2 "Anisong · Add Tracks"
Input:
`{"mode": "staging"|"append", "playlist": "<name>", "country": "us", "ids": [..]}`
1. For each ID, build `https://music.apple.com/{country}/song/{id}`.
2. Turn the URLs into music items. **This is the riskiest step; see spike #1.**
   Candidate actions: pass the URL directly to *Add to Playlist*;
   *Add to Library*, then find it and *Add to Playlist*; or a shortcut built
   from the Apple Music "Search" action keyed on title + artist.
3. `staging` → **Create Playlist** named "anisong-curator · {date}" with the
   items. `append` → **Add to Playlist** *playlist*.
4. Return `{added: n, failed: [ids]}`.

**Manual fallback when step 2 can't be automated:** the commit screen becomes a
checklist of `music.apple.com` links in order. Each opens in Music, and you add
it with the "+" button. That's tolerable at ~10–25 songs a season, and still
saves all of the discovery and review work.

## 7. Saved state instead of a lower bound (recommendation)

- **First run:** lower-bound picker (Mode 1) or tail inference (V2).
- **Later runs:** start from `RunCursor`, plus any show whose `status` or
  `updatedAt` changed since the last run. This catches CURRENT → COMPLETED
  transitions and dates you backfilled. Themes that already have a `Decision`
  are hidden by default.
- Keep a "rewind to…" picker for manual override.

A position in a sorted list misses shows whose sort key changes after the fact.
Diffing against saved state doesn't.

## 8. Ordering rules (Mode 1)

Sort fields: `completedAt`, `startedAt`, `updatedAt`, `createdAt` (added),
`score`, `progress`, `repeat`, and title. These mirror AniList's
`MediaListSort`. Sorting happens **client-side**.

- **Bucket A**, sorted by the chosen field: `COMPLETED`, `DROPPED`, `PAUSED`.
- **Bucket B**, after all of A: `CURRENT`, `REPEATING`.
- `PLANNING` is excluded.

Edge cases:
- **Fuzzy dates.** Any of `{year, month, day}` can be null. Sort key:
  `(year ?? -∞, month ?? 0, day ?? 0)`, with a "no date" badge.
- **Dropped and paused shows have no `completedAt`.** Fall back to `updatedAt`,
  which changes on any edit, so label it as a proxy.
- **Rewatches** may already be in the playlist. The duplicate check (§9.4)
  handles this.
- **Seasons and sequels** are separate media with separate themes.
- A toggle to include or exclude dropped shows. Default on, per the brief.

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

### 9.4 Duplicates without catalog IDs or ISRCs
Duplicate sources, best first:
1. **`CommitLog`**: an exact `trackId` that the app has already sent. Skip.
2. **Snapshot match**: normalized title + artist, with duration within ±3 s.
   Default: skip.
3. **Same title + artist, different duration** (TV size vs full, remaster).
   Default: ask.

Since playlist reads only cover the tail, older duplicates (e.g. a rewatched
show's OP added years ago) are caught by the CommitLog only if the app added
them. Optionally, import the **whole** playlist once (§9.6) to seed the snapshot.

### 9.5 V2: inferring the lower bound from the playlist tail
1. **Import the playlist** (M6): Music.app → File → Library → Export
   Playlist… (Plain Text: tab-separated, usually UTF-16LE + BOM with CR line
   endings, `Time` in seconds; columns found by header name), or ⌘C rows
   pasted from the song list (no header; Name / m:ss Time / Artist / Album are
   guessed and shown for checking). It is saved as a `PlaylistSnapshot`, and
   the last n = 30 rows are the tail. This replaces the "Read Tail" Shortcut
   for reading: no x-callback round trip, and the whole playlist arrives at
   once. Parser: `playlistImport.ts`; inference: `tailInference.ts`.
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
4. Suggest the hit with the **greatest position in the current sort order**,
   not simply the last playlist track. Playlist order and watch order disagree
   whenever songs were added out of order. Show the mapped tail so you can
   confirm or override.

Once saved state (§7) exists, V2 becomes a drift check: does the tail match
the CommitLog?

### 9.6 Other
- **Full playlist import (M6).** The Music.app export (§9.5) holds the whole
  playlist, so it also seeds the §9.4 snapshot check: Review shows an
  "already in playlist" badge (title + artist, ±3 s) and can hide those
  songs. Re-import whenever the playlist changes by hand.
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
   fails, commit falls back to the manual link checklist (§6.2).
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
