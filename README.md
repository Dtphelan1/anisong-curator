# anisong-curator
An app for seamlessly adding your favorite anisongs from this season to an existing Apple Music playlist.

- Spec: [`docs/SPEC.md`](docs/SPEC.md)
- UX review and backlog: [`docs/UX-REVIEW.md`](docs/UX-REVIEW.md)
- Integration spike page: [`spike/`](spike/README.md)
- Shortcuts setup guide: [`shortcuts/README.md`](shortcuts/README.md). How to build
  `Anisong Add Kept` and `Anisong Export Playlist`, the two shortcuts the app relies on.

## Deploy

Every push to `main` builds the app and publishes it to GitHub Pages at
`https://<owner>.github.io/<repo>/` (the `Deploy to GitHub Pages` workflow
in `.github/workflows/deploy-pages.yml`; tests and the type check run first).
Pull requests and other branches run the same checks without deploying
(`.github/workflows/ci.yml`).

One-time setup: in the repository's **Settings → Pages → Build and
deployment**, set **Source** to **GitHub Actions**. To log in to AniList from
the deployed site (only needed for private lists), register its address as the
client's redirect URL; Settings › AniList in the app shows it.

## Develop

```bash
npm install
npm run dev     # http://localhost:5173
npm test
```

On the first visit the app walks you through setup: your AniList username
(public lists need nothing else), your playlist, the two shortcuts and a few
preferences. After that it opens on "Which anime would you like to add?", and
everything from setup is under ⚙ Settings.

Status: M1–M4 and M6 done; duplicate prevention in progress.
- **M1:** AniList list, ordering, and the anime picker: multi-select with checkboxes,
  Shift/Alt/Cmd-click and keyboard shortcuts, and "everything newer than the last
  show added" as the quick start.
- **M2:** OP/ED lookup via AnimeThemes GraphQL, with a Jikan fallback.
- **M3:** Apple Music matching via iTunes Search, plus a keyboard-driven review
  in three phases: **Review**, **Already have** (songs already in your
  playlist, in their own pass) and **Add to playlist**. Your place is saved,
  so you can pause and come back. Keys:
  - `J` or `→` next, `K` or `←` previous
  - `1` keep (in Already have: add anyway), `2` skip
  - `3` later, `⇧3` later for the whole show
  - `⇧1` add anyway (a song you already have, reached during the review)
  - `space` play/pause, `C` "Not it?" (other candidates), `/` search or paste
    a link
- **M4:** the **Add to playlist** step copies the songs in watch order; the
  `Anisong Add Kept` shortcut adds them to your playlist (see the shortcuts
  setup guide), and **Yes, mark as added** records them.
- **M6:** import the playlist (Music.app export or pasted rows); the app maps
  its last songs onto your shows, suggests the last show, and flags songs
  already in the playlist during review.
- **Duplicate prevention:** the app holds back songs already in the playlist,
  using the synced playlist library and its own add log ("Yes, mark as added").

Everything is cached in IndexedDB. Don't commit personal playlist exports;
the fixtures in `src/lib/__fixtures__/playlists/` are synthetic.

```bash
NODE_USE_ENV_PROXY=1 LIVE=1 npx vitest run matching.live   # re-record the live matcher eval
```
