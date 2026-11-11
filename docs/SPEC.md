# anisong-curator — Prototype Spec

Status: draft v0.1 · Scope: single-user, single-page prototype

## 1. User story

> As an avid anime fan and anisong listener, I want to periodically review the
> opening and ending songs from the shows I've watched and add them to an
> existing, running Apple Music playlist I maintain.

## 2. Corrections to the premise (read first)

A few assumptions in the brief don't hold, and they change the design:

1. **AniList has no OP/ED song data.** Its `Media` type has no themes field. You
   need a third data source for songs. The best one is **AnimeThemes.moe**, which
   links its entries to AniList IDs. **Jikan (the MyAnimeList API)** is a fallback
   that returns themes as free-text strings. This adds a third integration and is
   the weakest link in the pipeline.
2. **A "paid" AniList account changes nothing for the API.** AniList is free.
   Donating gets you a supporter badge and cosmetic perks, not more API quota or
   different data. The thing that does matter is whether your list is
   **public or private**. That decides whether you need OAuth at all.
3. **Apple Music's API has no "add duplicate song?" prompt.** That dialog exists
   only in the Music app. The Web API silently appends whatever you send. The app
   has to do its own duplicate detection.
4. **Apple Music's API cannot remove tracks from a playlist or delete a playlist.**
   Appends are effectively irreversible from the app. That makes the
   "new staging playlist" option the safe default, not just the simple one.
5. **The app has no use for a "lower bound" once it has run once.** If the app
   saves its own cursor (the last list entry processed) and every keep/skip
   decision, later runs only show new material. The lower-bound picker (Mode 1)
   and the playlist-tail inference (V2) are ways to **bootstrap** the first run,
   or to recover when you've changed the playlist by hand. They shouldn't be the
   main path. See §7.

## 3. External dependencies

| Service | Purpose | Auth | Approx. limits |
|---|---|---|---|
| AniList GraphQL (`graphql.anilist.co`) | Your anime lists, statuses, dates | None for public lists; OAuth implicit grant for private ones | 90 req/min nominal. It has run in a "degraded" 30 req/min mode, so code for 30 |
| AnimeThemes API (`api.animethemes.moe`) | OP/ED song title, artists, sequence (OP1, ED2…), episode ranges | None | ~90 req/min |
| Jikan v4 (`api.jikan.moe`) — fallback | MAL `theme.openings/endings` strings, via AniList `idMal` | None | 3 req/s, 60 req/min |
| Apple Music API + MusicKit JS v3 | Catalog search, previews/playback, read playlist, append, create playlist | Developer token (JWT) + Music User Token | Undocumented; back off on 429 |
| iTunes Search API — no-Apple-Developer fallback | Catalog search plus 30 s previews without a developer token | None | ~20 req/min, JSONP |

## 4. API keys and accounts you'll need to provide

### Required
1. **Apple Developer Program membership ($99/yr).** This is non-negotiable for
   writing to playlists. In the developer portal:
   - Create a **Media ID** (Identifiers → Media IDs) with MusicKit enabled.
   - Create a **Key** with MusicKit enabled. Download the `.p8` private key. It
     can be downloaded **only once**.
   - Note your **Team ID** and **Key ID**.
   - With these, mint the **developer token**: an ES256 JWT with
     `iss=TeamID`, `kid=KeyID`, `exp ≤ 6 months`, and an optional
     `origin: ["http://localhost:5173", "https://<your-host>"]` claim to lock it to
     your origins.
2. **An active Apple Music subscription** on the Apple ID that owns the
   playlist. Without it, library and playlist endpoints return 403.

### Conditional
3. **AniList API client**, only if your list is private or you want to read
   entries marked "hidden from status lists". Register one at
   `anilist.co/settings/developer` with redirect URL
   `http://localhost:5173/callback`. The SPA uses the **implicit grant**
   (`response_type=token`), so it only needs the **Client ID**. No client secret
   ships to the browser. Tokens last about a year.

### Not needed
- AnimeThemes, Jikan, and iTunes Search need no keys.

### Secret handling
- The `.p8` key **never** goes into the SPA bundle or the repo. Mint the
  developer token with a local script (`npm run mint-token`) and put the token
  in `.env.local` as `VITE_APPLE_DEV_TOKEN`.
- The developer token **is** visible to the browser. That is how MusicKit JS is
  designed, so this is normal. The `origin` claim and the 6-month expiry are the
  mitigations. For a personal prototype this is fine. If the app is ever hosted
  for others, move minting into a small serverless function.
- Add `.p8`, `.env.local`, and `*.token` to `.gitignore`.

## 5. Proposed architecture

```
┌──────────────────────────── Browser SPA (Vite + React + TS) ───────────────────────────┐
│                                                                                         │
│  UI: Wizard ─ 1.Connect ─ 2.Load lists ─ 3.Pick lower bound ─ 4.Resolve ─ 5.Review ─ 6.Commit │
│                                                                                         │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐                  │
│  │ anilist.ts  │  │ themes.ts    │  │ matcher.ts   │  │ apple.ts     │                  │
│  │ GraphQL     │  │ AnimeThemes  │  │ query gen +  │  │ MusicKit JS  │                  │
│  │ client      │  │ + Jikan fb   │  │ scoring      │  │ + REST calls │                  │
│  └──────┬──────┘  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘                  │
│         └──── rate-limited fetch queue (per-host token bucket, 429 backoff) ─────┘       │
│                                   │                                                     │
│                    IndexedDB (Dexie): cache + decisions + cursor                        │
└─────────────────────────────────────────────────────────────────────────────────────────┘
          ▲ local only
   scripts/mint-token.ts  (reads .p8 → writes developer token to .env.local)
```

This is a pure client-side SPA with no backend, and that is deliberate.
AniList, AnimeThemes, and the Apple Music API all allow browser CORS. Confirm
this in the spike, §10. Jikan does too. iTunes Search may need JSONP.

### 5.1 Data model (IndexedDB)

```ts
Show       { anilistId, idMal, title{romaji,english,native}, format, season, seasonYear,
             status, completedAt, startedAt, updatedAt, createdAt, score, repeat, progress }
Theme      { themeId (animethemes), anilistId, kind: 'OP'|'ED'|'IN', sequence, slug,
             songTitle, artists[], episodes, source: 'animethemes'|'jikan' }
Match      { themeId, catalogSongId, isrc, name, artistName, albumName, durationMs,
             previewUrl, confidence 0..1, candidates[] (top 5), userConfirmed: bool }
Decision   { themeId, decision: 'keep'|'skip'|'later', decidedAt }   // permanent memory
RunCursor  { lastProcessedAnilistEntry, sortField, playlistId, committedAt }
PlaylistSnapshot { playlistId, tracks[{libraryId, catalogId, isrc, name, artist}], fetchedAt }
```

`Decision` and `RunCursor` are what make repeat runs painless. Everything else
is cache and can be rebuilt.

### 5.2 Pipeline

1. **Connect.** Configure MusicKit, call `music.authorize()` to get the Music User
   Token, and read `music.storefrontId`. If needed, run the AniList OAuth redirect.
2. **Load lists.** One `MediaListCollection(userName, type: ANIME)` query returns
   every list. Chunk it with `chunk`/`perChunk` if your list is large. Cache the
   result and refresh on demand. Re-fetching is cheap: 1–3 requests.
3. **Order shows** (§6). The user picks a lower bound (Mode 1), or V2 suggests one.
4. **Resolve themes** for shows above the bound: AnimeThemes by AniList ID,
   falling back to Jikan by `idMal`. Cache per show permanently. Themes rarely
   change after a season airs.
5. **Match to the Apple catalog** (§8.2). Store the top candidates, not just the
   winner, so the review UI can swap without searching again.
6. **Review.** Show a card per theme with the show, OP1/ED2, the matched track,
   a confidence badge, and a preview player. Keys: `K` keep, `S` skip, `L` later,
   `←/→` navigate, `space` play/pause, `C` open the candidate picker, and `/` for
   a manual search. The review step **doubles as match verification**, which is
   the main way the app absorbs matcher errors.
7. **Commit.** Diff the kept items against a fresh `PlaylistSnapshot`
   (by catalog ID, then ISRC, then normalized title+artist). Show a confirmation
   screen with N new, M likely duplicates (toggle each), and K unmatched
   (exported as text). Then either
   - **Append:** `POST /v1/me/library/playlists/{id}/tracks` in chronological
     order, in batches of ≤ 25, or
   - **Stage:** `POST /v1/me/library/playlists` to create
     "anisong-curator · 2026-11-11" containing the tracks.

   Finally, advance `RunCursor`.

## 6. Ordering rules (Mode 1)

AniList's per-entry fields that can be sorted on are `completedAt`, `startedAt`,
`updatedAt`, `createdAt` (added), `score`, `progress`, `repeat`, plus the media
title. These match the `MediaListSort` enum: `FINISHED_ON`, `STARTED_ON`,
`UPDATED_TIME`, `ADDED_TIME`, `SCORE`, `PROGRESS`, `REPEAT`, `MEDIA_TITLE_*`.
Sort **client-side**, not with the API's `sort` argument. You need two buckets
and fallbacks the API can't express.

- **Bucket A**, sorted by the chosen field: `COMPLETED`, `DROPPED`, `PAUSED`.
- **Bucket B**, listed after all of A: `CURRENT`, `REPEATING`.
- `PLANNING` is excluded. You haven't watched it.

Challenges here:

- **Fuzzy dates.** `completedAt` is `{year, month, day}`, and any part can be
  null. Older entries often have only a year, or nothing. Sort key:
  `(year ?? -∞, month ?? 0, day ?? 0)`. Entries with no date sort to the start,
  as "ancient", and get a visible "no date" badge.
- **Dropped and paused shows have no `completedAt`.** When `FINISHED_ON` is
  selected, fall back to `updatedAt`, which is a unix timestamp of the last list
  edit. This is a proxy, and the UI should say so. Note that `updatedAt` changes
  whenever you touch the entry, for example to edit a score.
- **Rewatches.** A `COMPLETED` entry with `repeat > 0`, or a `REPEATING` one,
  keeps its original `completedAt` in some workflows and gets overwritten in
  others. Its themes may already be in the playlist. The duplicate check (§8.4)
  handles this. The ordering doesn't need to.
- **Seasons and sequels** are separate AniList media with separate themes. That
  is correct behaviour, but expect many cards for long franchises.
- **Should dropped shows be included at all?** Default to yes, matching the
  brief, behind a toggle. Shows you dropped after 2 episodes probably contribute
  noise.

## 7. Mode 1 vs. persisted state (recommendation)

The brief's Mode 1 asks "what's the last show you added?" on every run. That is
a manual lookup each time, and easy to get wrong. Recommended behaviour:

- **First run:** lower-bound picker (Mode 1) or tail inference (V2).
- **Later runs:** start from `RunCursor`, but also include any show whose
  status/`updatedAt` changed since the last run. This catches a show that was
  `CURRENT` last time and is now `COMPLETED`, which a pure lower bound would
  miss, because it sits in Bucket B and moves up into A. Themes with an existing
  `Decision` are hidden by default.
- Keep the picker available as "rewind to…" for manual override.

This also fixes a correctness problem in the pure lower-bound model. Sorting by
`completedAt` means a show you finish today but that started 2 years ago lands
in chronological order. A show finished *after* your last run can still sort
*before* your bound if its date was backfilled. Diffing against stored state is
robust to that. A position in a sorted list is not.

## 8. Technical and integration challenges

### 8.1 Theme coverage (AnimeThemes / Jikan)
- AnimeThemes coverage is very good for TV anime since roughly 2000, patchy for
  older shows, ONAs, shorts, and the current season. Data lags airing by days to
  weeks. **Currently airing shows are the most likely to have no themes.** Mark
  them "pending" and retry on the next run rather than caching "none" forever:
  set a TTL on negative results.
- `IN` (insert songs) exist. Exclude them by default, behind a toggle.
- AnimeThemes splits "versions" (v1/v2) and some shows reuse an OP. Dedupe by
  `song.id` within a run.
- Jikan's fallback strings look like
  `"1: \"Gurenge\" by LiSA (eps 1-26)"`. Parsing them is regex-fragile: quotes,
  romaji/kanji pairs, and "feat." all vary. Use it only when AnimeThemes has
  nothing, and flag those cards as low-confidence.

### 8.2 Matching anisong metadata to the Apple Music catalog (hardest part)
This is where most errors will come from:
- **Title script mismatch.** AnimeThemes uses romaji or English titles. Apple's
  catalog shows native Japanese in the JP storefront and a mix elsewhere.
  "Kaikai Kitan" vs "廻廻奇譚". Artist names vary the same way: "Kenshi Yonezu" vs
  "米津玄師".
- **Versions.** TV size, full, instrumental, "off vocal", live, remasters,
  covers, and karaoke-cover spam accounts.
- **Availability.** Some anisongs aren't on Apple Music at all, or only in some
  regions. Some are only on the OST album as "TV size".

Strategy:
1. Generate queries in priority order: `title + primary artist` →
   `title` alone → `title + anime name` → native-script variants if
   AnimeThemes/AniList supplies them (AniList `title.native` helps for the
   anime name).
2. Score candidates on normalized title similarity: lowercase, NFKC, strip
   punctuation, `(TV size)`, `feat.`, and brackets, then Jaro-Winkler or token
   set ratio. Add artist similarity, an album-name bonus if the album contains the
   anime title or "OP/ED/Opening", and penalties for `karaoke|instrumental|cover|
   remix|off vocal|tv size` unless the source says TV size.
3. Prefer the full-length single/album version by default. TV size is a
   per-user preference toggle.
4. Thresholds: ≥ 0.85 auto-accept (still shown in review), 0.6–0.85 "check
   me", < 0.6 "unmatched → manual search".
5. **Cache confirmed matches** by AnimeThemes `song.id`. A confirmed match is
   never searched again.
6. Optional improvement: search both the user's storefront and `jp`. Use the JP
   hit's ISRC to find the same recording in the user's storefront with
   `GET /v1/catalog/{sf}/songs?filter[isrc]=…`. ISRC lookup is an exact join,
   and this is the best trick available for the script-mismatch problem.

### 8.3 Apple Music API limitations
| Limitation | Workaround |
|---|---|
| No track removal / playlist deletion | Default to staging playlist; confirmation screen before append; local "commit log" so you know what was added |
| No duplicate prompt | Own diff against `PlaylistSnapshot` by catalog ID → ISRC → normalized title+artist |
| Library playlist tracks return **library** IDs (`i.xxxx`), not catalog IDs | Use `include=catalog` on the tracks relationship, or `attributes.playParams.catalogId`; some tracks (uploaded/matched, or removed from catalog) have none → fall back to name+artist |
| Playlist tracks are paginated (≈100/page); no "tail" endpoint | Paginate to the end; a 2,000-track playlist is ~20 requests; cache the snapshot and refresh incrementally by count |
| Appending to playlists **not created by the app** has historically been unreliable (403/500 reports; `canEdit` attribute) | **Spike this first.** If it fails for your playlist, the fallback is staging playlist + manual drag in Music app, or the Shortcuts route below |
| Developer token max 6 months | Calendar reminder / mint script prints expiry; app shows a banner when <14 days remain |
| Undocumented rate limits | Per-host queue at ~5 req/s, exponential backoff on 429 |
| Full playback requires subscription + MusicKit; Safari/Chrome autoplay rules | Use `attributes.previews[0].url` (30 s AAC) in a plain `<audio>` element for "scrubbing"; it's faster, needs no playback session, and is enough to judge. Offer "play full" via MusicKit as secondary |
| Storefront-specific catalog IDs | Always search/add in `music.storefrontId`; never persist cross-storefront IDs as the add target |

### 8.4 Duplicate semantics
"Duplicate" can mean three different things. Show each separately on the
confirmation screen:
1. Same catalog ID: a true duplicate. Default: skip.
2. Same ISRC, different catalog ID (single vs album release): the same
   recording. Default: skip.
3. Same normalized title+artist, different ISRC (TV size vs full, remaster):
   probably the same song. Default: ask.

### 8.5 V2 — inferring the lower bound from the playlist tail
Reverse lookup from an Apple track to an anime is hard in general. Here it's
**bounded**: you only need to match the tail against themes of shows on *your*
list. That turns it into a lookup against a closed index:

1. Fetch the last N = 30 playlist tracks with catalog data.
2. Build an index from the themes of all Bucket A/B shows (which requires
   resolving themes for the **whole** list once: roughly 1 AnimeThemes request
   per show, or fewer if batching by external ID works, then cached forever).
   Keys: ISRC if a confirmed `Match` exists, else normalized title+artist.
3. Map each tail track → `{show, confidence}` or "not an anisong".
4. Suggest a lower bound. Pick the hit with the **greatest position in the
   current sort order**, not just the last playlist track. Playlist order and
   watch order disagree whenever you added songs out of order. Show the mapped
   tail so the user can confirm or override.

Challenges: non-anisong tracks in the playlist (ignored), songs that are themes
for multiple shows (pick the latest by sort order), and the first-run cost of
resolving themes for every show. At about 500 shows and 30 req/min that's a
roughly 15–20 minute cold start, so run it in the background with a progress
bar. After the first run of the persisted-state design (§7), V2 mostly turns
into a **sanity check**: "the playlist tail agrees with the cursor" vs "you
edited the playlist by hand; re-sync?".

### 8.6 Other
- **Rate-limit budget per run:** AniList takes 1–3 requests, AnimeThemes about 1
  per new show, Apple search 1–4 per new theme. A typical seasonal run of
  ~10 shows → ~25 themes → ~60 Apple requests takes under a minute.
- **AniList auth edge cases:** private profile, or entries with
  `hiddenFromStatusLists`, need the OAuth token. A query with an expired token
  returns a 401 → re-auth.
- **MusicKit JS v3 lifecycle:** it must load from Apple's CDN
  (`js-cdn.music.apple.com/musickit/v3/musickit.js`), and `authorize()` must run
  inside a user gesture (popup blockers).
- **Localhost:** MusicKit works on `http://localhost`. For any hosted version you
  need HTTPS and the origin in the token's `origin` claim.

## 9. Workarounds if the Apple Developer membership is a blocker

1. **iTunes Search API + Shortcuts.** iTunes Search (`itunes.apple.com/search?
   entity=song&term=…&country=us`) needs no key and returns `trackId`, which is
   the same number as the Apple Music catalog ID. It also returns `previewUrl`
   and `isrc`-less metadata. So search and preview both work without the $99
   membership. For the write side, the app exports a list of
   `https://music.apple.com/{sf}/song/{trackId}` URLs, and an Apple **Shortcuts**
   shortcut ("Get contents of URL" → "Add to Playlist") on macOS or iOS appends
   them. Costs: no automatic duplicate check (no playlist read), a ~20 req/min
   search limit, and JSONP for CORS.
2. **macOS JXA/AppleScript with Music.app** can add *library* tracks to
   playlists but can't add arbitrary catalog tracks without adding them to the
   library first. It's brittle, so not recommended.
3. **Paste-list fallback.** Export "Song — Artist (Anime OP1)" text for manual
   adding, or for SongShift/Soundiiz-style transfer tools.

Recommendation: pay the $99 if you're already a developer member or plan to
iterate on this. Otherwise build the prototype on path 1 first. Matching and
review, which is ~70% of the value, are identical. Only `apple.ts` changes.

## 10. Spike list (verify before building on these)

Network probes weren't possible while this spec was written. Verify these first,
roughly in this order:

1. **Append to an existing, hand-made library playlist** via
   `POST /v1/me/library/playlists/{id}/tracks`. Check the `canEdit` attribute.
   This is the brief's core requirement and the biggest risk. If it fails,
   staging becomes the only automated path.
2. `include=catalog` on library playlist tracks returns ISRCs.
3. AnimeThemes: the exact filter syntax for lookup by AniList external ID, and
   whether comma-separated IDs batch (e.g.
   `/anime?filter[has]=resources&filter[site]=AniList&filter[external_id]=16498,113415&include=animethemes.song.artists`).
   Also confirm CORS headers.
4. AniList's current rate limit (read the `X-RateLimit-Limit` header).
5. Catalog `filter[isrc]` behaviour across storefronts (§8.2 step 6).
6. iTunes Search CORS vs JSONP (only if taking path §9.1).

## 11. Prototype milestones

| # | Deliverable | Proves |
|---|---|---|
| M0 | Spike scripts for §10.1–10.3 | The integration is feasible at all |
| M1 | AniList load + ordering UI + lower-bound picker | §6 rules |
| M2 | Theme resolution + cache | Coverage on *your* list (log hit rate) |
| M3 | Matcher + review UI with previews | Match precision; review ergonomics |
| M4 | Commit: staging playlist, then append with dedupe | End-to-end Mode 1 |
| M5 | Persisted decisions + cursor (§7) | Periodic use without re-picking |
| M6 | V2 tail inference | First-run bootstrap / drift detection |

Suggested stack: Vite + React + TypeScript, Dexie (IndexedDB), `graphql-request`
or plain `fetch`, `fastest-levenshtein` or `string-similarity`, and a `jose`
script for token minting. Testing: unit-test the matcher's normalization and
scoring against a fixture set of ~50 known anisong → catalog-ID pairs from your
own playlist. Your existing playlist is the ground-truth dataset.
