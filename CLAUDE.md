# Working on anisong-curator

## Documentation: avoid fragile cross-references
- **Refer to things by stable names, not by where they live in another
  document.** Name the shortcut (`Anisong Add Kept`), the feature ("Sync
  playlist", "suggest last show") or the file (`shortcuts/README.md`), never
  "§4a of the shortcuts guide", "Appendix A", "step 7" or "the third section".
  Other documents get reorganized; names don't.
- **§ numbers are fine only inside the same document.** For example,
  `docs/SPEC.md` may cite its own §9.4. Don't cite another file's section
  numbers, headings or step numbers.
- **Split contract from instructions.** `docs/SPEC.md` states *what* each
  shortcut must do (input, output format, constraints). `shortcuts/README.md`
  says *how* to build it, step by step. Change a contract in the spec; change
  build steps in the guide. Neither should restate the other's details.
- **After renaming or restructuring anything,** grep the repo for its old name,
  heading or section number (docs, `spike/`, UI strings in `src/`) and update
  every reference in the same change.
- **Step numbers inside the guide's action tables** are referenced by later rows
  of the same table ("from step 7"). After inserting or removing a row,
  renumber the table and recheck every "step N".

## Names the app depends on
- **Shortcut names:** `Anisong Add Kept` and `Anisong Export Playlist`. The
  spike-only shortcuts are `Anisong Echo`, `Anisong Read Tail` and
  `Anisong Add Tracks`. Use plain spaces, no `·` or other punctuation.
  UI strings and the spike page's default fields use these exact names.
- **Target playlist:** `🔥 AniSong MegaMix` (the app's default `playlistName`
  setting). Tell users to pick it from the Shortcuts picker, never type it.
- **Clipboard format of `Anisong Export Playlist`:** `anisong-playlist v1`,
  defined in `docs/SPEC.md` and parsed by `src/lib/playlistImport.ts`. Change
  all three together.

## Data and privacy
- **Never commit a user's real playlist export or listening data.** Test
  fixtures in `src/lib/__fixtures__/playlists/` must be synthetic, with a note
  in their `.expected.json` saying so. Keep a real export the user shares
  outside the repo (e.g. the session scratchpad), for local checks only.

## Workflow
- **Checks:** `npx vitest run`, `npx tsc --noEmit`, `npx vite build`. Network
  tests in Node need `NODE_USE_ENV_PROXY=1` (opt-in live eval:
  `LIVE=1 npx vitest run matching.live`).
- **Shortcut instructions are written as numbered action tables** (action +
  settings), not prose or Siri prompts: Siri-built shortcuts have broken a
  working version before. Every shortcut that takes input starts with the
  input block (Shortcut Input if present, otherwise the clipboard).
