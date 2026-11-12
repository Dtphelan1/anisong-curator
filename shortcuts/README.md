# Apple Shortcuts for anisong-curator

The app talks to your Music library through three small shortcuts. Shortcuts
can't be generated as files from this repo, so build them by hand once. It
takes about 10 minutes. Build them on either the Mac or the iPhone. They sync
over iCloud, which lets spike 1 be tested on both.

**Quickest test first.** Spike 1 can be answered with a three-action
shortcut that needs no input: **Text** (a `music.apple.com/us/song/<id>` link
to a song *not* in your library) → **Get URLs from Input** → **Add to
Playlist** (a throwaway playlist). If the song lands, the automatic add path
works.

Action names below are from Shortcuts on macOS 14 / iOS 17. If one has moved,
search the action list for the quoted name. Each shortcut must be able to
**receive text input**: open the shortcut's details (ⓘ) and make sure it
receives input. If the first row reads *Receive [Any] input from [Nowhere]*,
change it to *Receive **Text** input from **Quick Actions*** or similar. Any
source works; what matters is that input is enabled. Set *If there's no input*
to **Continue**: the input block below handles the no-input case.

### Building on iPhone
These shortcuts can be built entirely on iPhone. You can also describe them to
Siri and let it draft them, then check the result against the steps below.
The iPhone layout differs from the Mac's:
- **Input settings** live in the shortcut's settings: tap the **ⓘ** or the
  shortcut's name at the top, then **Details**. Turn on **Show in Share
  Sheet**. That adds the *Receive … input* row at the top of the editor, along
  with its *If there's no input* option.
- **Show Result** isn't always offered on iPhone. Use **Quick Look** to
  inspect a value while debugging.
- A Siri-drafted shortcut may use different but equivalent actions. That's
  fine as long as the input JSON goes in and the output JSON comes back out.
- To run the spike page from the phone, serve it on your Mac and open
  `http://<mac-lan-ip>:5173/` in iPhone Safari (see `spike/README.md`). The
  page's links then launch the shortcuts on the phone.

These labels are from memory of recent iOS versions and may have moved. If
something differs, note it in the spike page's notes field.

### The input block: start every shortcut with this
A shortcut **never prompts** for Shortcut Input. Run from the editor with ▶, or
from the home screen, its input is empty; input only arrives from a caller
(the spike page's link, the Share Sheet, or another shortcut). So every
shortcut below opens with the same six actions. They use the input when there
is some, and otherwise fall back to the clipboard:

| # | Action | Settings |
|---|---|---|
| 1 | **If** | Input: *Shortcut Input*. Condition: **has any value** |
| 2 | **Set Variable** | Name: `Input`. Input: *Shortcut Input* |
| 3 | **Otherwise** | added with step 1 |
| 4 | **Get Clipboard** | none |
| 5 | **Set Variable** | Name: `Input`. Input: *Clipboard* |
| 6 | **End If** | closes step 1 |

Both branches set the **same** variable name, `Input`, and every later step
reads the variable *Input*, never *Shortcut Input* or *Clipboard* directly.
To test in the editor, copy the test text (for example
`{"playlist":"My Playlist","n":5}`), then press ▶.

### Names
Each name typed into the spike page must match the shortcut's name exactly.
The names below contain a middle dot (`·`), which is easy to mistype. Plain
names like `Anisong Echo` are safer; just type the same names into the
page's three name fields.

Every shortcut ends with **Stop and Output**, with *If there's nowhere to
output* set to **Copy to Clipboard**. When launched from the spike page, the
output goes back to the page through x-callback. If that doesn't work, the
output is on the clipboard and you can paste it into the page.

---

## 1. `Anisong · Echo` (spike 3: does the round trip work at all?)

1–6. **Input block** (above).
7. **Stop and Output** → variable *Input*. Nowhere to output → Copy to Clipboard.

That's it. The page sends `{"ping":"anisong",…,"unicode":"紅蓮華 · ½"}` and
checks that the same text comes back, including the non-ASCII characters.

---

## 2. `Anisong · Read Tail` (spike 2: can we read the playlist end, in order?)

For the spike, **hard-code your playlist** in step 9. Whether a variable can
drive the playlist filter is a secondary question. The page's `n` input
is still used.

1–6. **Input block** (above).
7. **Get Dictionary from** variable *Input*.
8. **Get Dictionary Value** for key `n` in *Dictionary* → **Set Variable** `N`.
9. **Find Music** where **Playlist is** *‹your playlist›*. Sort by: *None*.
   Limit: off.
   - Spike question: with no sort, do items come back in **playlist order**?
     If not, check whether the Mac has a **Get Playlist** / "Get items of
     playlist" action and try that instead. Write down what worked in the
     page's notes.
10. **Count** *Items* in *Music* → **Set Variable** `Total`.
11. **Calculate** `Total − N` → then **Calculate** *Result* `+ 1` →
   **Set Variable** `Start`.
12. **If** `Start` *is less than* `1` → **Set Variable** `Start` to `1` →
   **End If**.
13. **Get Items from List** → *Items in Range* `Start` to `Total`, from *Music*.
14. **Repeat with Each** item in *Items*:
   - **Dictionary** with these keys. In each value, insert the *Repeat Item*
     variable and tap it to pick the property:
     - `title` → Repeat Item › **Title**
     - `artist` → Repeat Item › **Artist**
     - `album` → Repeat Item › **Album**
     - `duration` → Repeat Item › **Duration** (unit unknown, the spike records it)
     - `dateAdded` → Repeat Item › **Date Added**
15. **End Repeat**.
16. **Stop and Output** → *Repeat Results*. Nowhere to output → Copy to Clipboard.

The page accepts a JSON array or newline-separated JSON objects. Shortcuts
usually turns a list of dictionaries into the latter.

---

## 3. `Anisong · Add Tracks` (spike 1: the riskiest one)

Input: `{"mode":"staging"|"append","playlist":"…","country":"us","ids":[123,…]}`

1–6. **Input block** (above).
7. **Get Dictionary from** variable *Input* → **Set Variable** `Args`.
8. **Get Dictionary Value** `country` in `Args` → **Set Variable** `CC`.
9. **Get Dictionary Value** `ids` in `Args`.
10. **Repeat with Each** item in *Dictionary Value*:
   - **Text**: `https://music.apple.com/` `CC` `/song/` *Repeat Item*
   - **Get URLs from Input** (*Text*). This turns the text into a URL value.
11. **End Repeat** → **Set Variable** `Links` to *Repeat Results*.
12. **Get Dictionary Value** `mode` in `Args`.
13. **If** *Dictionary Value* **is** `staging`:
   - **Create Playlist** named `anisong-curator · ` *Current Date* (format it
     short), **items:** `Links`.
   **Otherwise:**
   - **Add to Playlist**: `Links` → *‹your playlist, hard-coded for the
     spike›*.
   **End If**.
14. **Count** *Items* in `Links`.
15. **Dictionary** `{ ok: true, sent: ‹Count› }` → **Stop and Output** *Dictionary*.

### What to try if songs don't land
Test first with a song that's **not** already in your library. That is the
real-world case.

- **Diagnose:** add a temporary **Get Details of Music → Title** on one of
  the `Links` and **Show Result**. If you get a song title back, Shortcuts is
  turning the URL into a music item. If you get an error or nothing,
  Add to Playlist can't work with URLs and the automated write path is
  closed.
- **iOS setting:** Settings › Music › **Add Playlist Songs** (adds songs to your
  library when added to a playlist). Try with it on.
- Note any error text. The page records x-error messages automatically.

If none of these work, the app falls back to the **manual link checklist**
(SPEC §6.2), and Read Tail is still used to verify the result and catch
duplicates. That's a fine outcome for the spike. It just changes M4.

---

## 4. Adding kept songs: two shortcuts

Build these as **two separate shortcuts**, by hand, one action at a time. Keep
the simple one as a fallback, so a broken dedupe version never leaves you
unable to add songs. Asking Siri to "update" a shortcut edits it in place, so
build new ones.

The app's **Kept** section, in **Shortcut** format, copies one song per line:

```
Gurenge | LiSA | https://music.apple.com/us/song/1538286723
```

Both start with the **input block** (§ *The input block* above): shared from the
app's **Share…** button they use that text, and run on their own they read the
clipboard. Turn on **Show in Share Sheet** (accepting Text) in each shortcut's
Details, with *If there's no input* set to **Continue**.

**Tips for iPhone:**
- To put a variable into a field, tap the field. The variable bar above the
  keyboard shows recent outputs; **Select Variable** lists all of them.
- To use a property of an item (e.g. a song's **Title**), insert the
  variable, tap the inserted token, then pick the property.
- Name each variable exactly as written below. The steps refer back to them.

### 4a. `Anisong Add Kept`: simple, no duplicate check (fallback)

| # | Action | Settings |
|---|---|---|
| 1 | **If** | Input: *Shortcut Input*. Condition: **has any value** |
| 2 | **Set Variable** | Name: `Input`. Input: *Shortcut Input* |
| 3 | **Otherwise** | added with step 1 |
| 4 | **Get Clipboard** | none |
| 5 | **Set Variable** | Name: `Input`. Input: *Clipboard* |
| 6 | **End If** | closes step 1 |
| 7 | **Get URLs from Input** | Input: variable *Input* |
| 8 | **Choose from Menu** | Prompt: `Add songs to…`. Items: `🔥 AniSong MegaMix`, `New playlist` |
| 9 | *(under **🔥 AniSong MegaMix**)* **Add to Playlist** | Music: *URLs* (from step 7). Playlist: pick **🔥 AniSong MegaMix** from the picker; don't type it |
| 10 | *(under **New playlist**)* **Create Playlist** | Name: `anisong-curator ` + *Current Date*. Items (tap *Show More*): *URLs* |
| 11 | **End Menu** | added automatically |

This adds every link, including duplicates. The app's held-back list is
the only duplicate protection when you use this one.

### 4b. `Anisong Add Kept (dedupe)`: skips songs already in the playlist

| # | Action | Settings |
|---|---|---|
| 1 | **If** | Input: *Shortcut Input*. Condition: **has any value** |
| 2 | **Set Variable** | Name: `Input`. Input: *Shortcut Input* |
| 3 | **Otherwise** | added with step 1 |
| 4 | **Get Clipboard** | none |
| 5 | **Set Variable** | Name: `Input`. Input: *Clipboard* |
| 6 | **End If** | closes step 1 |
| 7 | **Find Music** | Filter: **Playlist** *is* **🔥 AniSong MegaMix** (picker). No sort, no limit |
| 8 | **Repeat with Each** | Input: *Music* (from step 7) |
| 9 | **Text** | Insert *Repeat Item*, tap it → **Title**; then type ` \| ` (space, bar, space); then insert *Repeat Item* again, tap it → **Artist** |
| 10 | **End Repeat** | added automatically |
| 11 | **Combine Text** | Input: *Repeat Results*. Separator: **New Lines** |
| 12 | **Change Case** | Input: *Combined Text*. Case: **lowercase** |
| 13 | **Set Variable** | Name: `Existing`. Input: *Updated Text* (from step 12) |
| 14 | **Split Text** | Input: variable *Input*. Separator: **New Lines** |
| 15 | **Repeat with Each** | Input: *Split Text* |
| 16 | **Set Variable** | Name: `Line`. Input: *Repeat Item* |
| 17 | **If** | Input: *Line*. Condition: **contains** `music.apple.com` |
| 18 | **Replace Text** | Find: ` \| https?://.*$` (leading space). Replace with: *(leave empty)*. In: *Line*. Tap *Show More*: turn **Regular Expression** on. The result is `Gurenge \| LiSA` |
| 19 | **Change Case** | Input: *Updated Text* (from step 18). Case: **lowercase** |
| 20 | **Set Variable** | Name: `Key`. Input: *Updated Text* (from step 19) |
| 21 | **If** | Input: variable *Existing*. Condition: **contains** → insert variable *Key* |
| 22 | **Add to Variable** | Name: `Skipped`. Input: *Key* |
| 23 | **Otherwise** | added with step 21 |
| 24 | **Get URLs from Input** | Input: *Line* |
| 25 | **Add to Variable** | Name: `ToAdd`. Input: *URLs* (from step 24) |
| 26 | **End If** | closes step 21 |
| 27 | **End If** | closes step 17 (it sits just above **End Repeat**) |
| 28 | **End Repeat** | closes step 15 |
| 29 | **Count** | Count **Items** in variable *ToAdd* |
| 30 | **If** | Input: *Count* (from step 29). Condition: **is** `0` |
| 31 | **Show Alert** | `Nothing new to add. All songs are already in the playlist.` Turn *Show Cancel Button* off |
| 32 | **Stop This Shortcut** | none |
| 33 | **End If** | closes step 30 |
| 34 | **Choose from Menu** | Prompt: `Add songs to…`. Items: `🔥 AniSong MegaMix`, `New playlist` |
| 35 | *(under **🔥 AniSong MegaMix**)* **Add to Playlist** | Music: variable *ToAdd*. Playlist: **🔥 AniSong MegaMix** (picker) |
| 36 | *(under **New playlist**)* **Create Playlist** | Name: `anisong-curator ` + *Current Date*. Items: variable *ToAdd* |
| 37 | **End Menu** | added automatically |
| 38 | **Count** | Count **Items** in variable *Skipped* |
| 39 | **Show Notification** | `Done. Skipped ` + *Count* (from step 38) + ` duplicate(s).` |

**Before trusting it, check these:**
- **The list is right.** Temporarily add a **Quick Look** after step 13 and run
  it. You should see lines like `gurenge | lisa`, one per playlist song. If
  you see one line, step 11 isn't using *Repeat Results*. If you see titles
  without artists, step 9's second token isn't set to **Artist**.
- **Duplicates are skipped.** Copy a list that includes a song already in the
  playlist (in the app, tick **add anyway** to force it in), run with **New
  playlist**, and check that song is missing from the new playlist and the
  notification says `Skipped 1`.
- **Nesting.** The **If / Otherwise / End If** blocks in steps 17–27 must sit
  *inside* the **Repeat** of step 15. If step 29 appears indented, an
  **End** is in the wrong place.

**Known limits.** The check is exact text after lowercasing, so a song whose
library title differs from the catalog title won't be caught; the app's check
is more forgiving. A title that contains another (`again | yui` inside
`again | yuika`) can cause a false skip. Both are rare.
