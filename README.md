# anisong-curator
An app for seamlessly adding your favorite anisongs from this season to an existing Apple Music playlist.

- Spec: [`docs/SPEC.md`](docs/SPEC.md)
- Integration spike page: [`spike/`](spike/README.md)
- Shortcuts build guide: [`shortcuts/`](shortcuts/README.md)

## Develop

```bash
npm install
npm run dev     # http://localhost:5173
npm test
```

Status: M1–M3 done.
- **M1:** AniList list, ordering, and the "last show added" picker.
- **M2:** OP/ED lookup via AnimeThemes GraphQL, with a Jikan fallback.
- **M3:** Apple Music matching via iTunes Search, plus a keyboard-driven review
  with previews: `K` keep, `S` skip, `L` later, `/` search or paste a link.

Everything is cached in IndexedDB. Next is M4: adding kept songs to the playlist
via Shortcuts.

```bash
NODE_USE_ENV_PROXY=1 LIVE=1 npx vitest run matching.live   # re-record the live matcher eval
```
