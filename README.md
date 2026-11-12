# anisong-curator
An app for seamlessly adding your favorite anisongs from this season to an existing Apple Music playlist.

- Spec: [`docs/SPEC.md`](docs/SPEC.md)
- Integration spike page: [`spike/`](spike/README.md)
- Shortcuts setup guide: [`shortcuts/README.md`](shortcuts/README.md). How to build
  `Anisong Add Kept` and `Anisong Export Playlist`, the two shortcuts the app relies on.

## Develop

```bash
npm install
npm run dev     # http://localhost:5173
npm test
```

Status: M1–M4 and M6 done; duplicate prevention in progress.
- **M1:** AniList list, ordering, and the "last show added" picker.
- **M2:** OP/ED lookup via AnimeThemes GraphQL, with a Jikan fallback.
- **M3:** Apple Music matching via iTunes Search, plus a keyboard-driven review
  with previews: `K` keep, `S` skip, `L` later, `/` search or paste a link.
- **M4:** the Kept list exports in order; the `Anisong Add Kept` shortcut adds it
  to your playlist (see the shortcuts setup guide).
- **M6:** import the playlist (Music.app export or pasted rows); the app maps
  its last songs onto your shows, suggests the last show, and flags songs
  already in the playlist during review.
- **Duplicate prevention:** the app holds back songs already in the playlist,
  using a synced playlist snapshot and its own add log ("I added these").

Everything is cached in IndexedDB. Don't commit personal playlist exports;
the fixtures in `src/lib/__fixtures__/playlists/` are synthetic.

```bash
NODE_USE_ENV_PROXY=1 LIVE=1 npx vitest run matching.live   # re-record the live matcher eval
```
