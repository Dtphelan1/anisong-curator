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

Status: M1 (AniList list + ordering + "last show added" picker) and M2 (OP/ED
lookup via AnimeThemes GraphQL with a Jikan fallback, cached in IndexedDB) are
done. M3 (Apple catalog matching + review) waits on the spike results.
