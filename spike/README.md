# M0 spike page

A single static page that probes every integration in `docs/SPEC.md §11`
and produces a JSON report to paste back. No build step and no dependencies.

## Run it (Mac)

```bash
cd spike && python3 -m http.server 5173
```

Then open <http://localhost:5173/>. Use the exact origin and port, because
the AniList redirect URL and the Shortcuts callback both point back here.

To test the shortcuts on **iPhone**, serve on the LAN and open
`http://<your-mac-ip>:5173/` in iPhone Safari. The AniList login only works on
the origin you registered, but you don't need it on the phone: load AniList on
the Mac.

## Order of operations

1. **AniList.** Enter your username and press *Load lists*. If your list is
   private, first register a client at <https://anilist.co/settings/developer>
   with redirect URL `http://localhost:5173/`, enter the client ID, and log in.
2. **AnimeThemes.** *Resolve themes* for your most recently completed shows.
   It reports coverage and whether batch lookups work.
3. **iTunes.** Click a theme row to fill the search term, then *Search*. Play a
   preview. Open a *Verify ID* link to confirm `trackId` is the Apple Music ID.
   Tick 1–3 tracks, ideally ones **not** in your library. Optionally run the
   cross-storefront lookup and the throttle probe.
4. **Shortcuts.** First build the spike shortcuts `Anisong Echo`,
   `Anisong Read Tail` and `Anisong Add Tracks`; the shortcuts setup guide
   ([`../shortcuts/README.md`](../shortcuts/README.md)) has their steps. Then
   run, in order: *Echo* → *Read Tail* → *Add selected → staging*. The app
   itself doesn't need these; they exist only for this page.
   Only try *append* once staging works, and on a playlist you don't mind
   leaving a test song in. Appends can't be undone from the app.
5. Tick the **manual observations** that held true, add notes, then press
   **Copy report** and paste it back.

The report contains counts, timings, transports, and pass/fail flags. It
contains no username, token, or list contents. Glance at it before sharing.
