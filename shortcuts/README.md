# Apple Shortcuts for anisong-curator

The app talks to your Music library through three small shortcuts. Shortcuts
can't be generated as files from this repo, so build them by hand once. It
takes about 10 minutes. Build them on the Mac. They sync to your iPhone over
iCloud, which lets spike 1 be tested on both.

Action names below are from Shortcuts on macOS 14 / iOS 17. If one has moved,
search the action list for the quoted name. Each shortcut must be able to
**receive text input**: open the shortcut's details (ⓘ) and make sure it
receives input. If the first row reads *Receive [Any] input from [Nowhere]*,
change it to *Receive **Text** input from **Quick Actions*** or similar. Any
source works; what matters is that input is enabled. Set *If there's no input*
to *Continue*.

Every shortcut ends with **Stop and Output**, with *If there's nowhere to
output* set to **Copy to Clipboard**. When launched from the spike page, the
output goes back to the page through x-callback. If that doesn't work, the
output is on the clipboard and you can paste it into the page.

---

## 1. `Anisong · Echo` (spike 3: does the round trip work at all?)

1. **Stop and Output** → *Shortcut Input*. Nowhere to output → Copy to Clipboard.

That's it. The page sends `{"ping":"anisong",…,"unicode":"紅蓮華 · ½"}` and
checks that the same text comes back, including the non-ASCII characters.

---

## 2. `Anisong · Read Tail` (spike 2: can we read the playlist end, in order?)

For the spike, **hard-code your playlist** in step 3. Whether a variable can
drive the playlist filter is a secondary question. The page's `n` input
is still used.

1. **Get Dictionary from** *Shortcut Input*.
2. **Get Dictionary Value** for key `n` in *Dictionary* → **Set Variable** `N`.
3. **Find Music** where **Playlist is** *‹your playlist›*. Sort by: *None*.
   Limit: off.
   - Spike question: with no sort, do items come back in **playlist order**?
     If not, check whether the Mac has a **Get Playlist** / "Get items of
     playlist" action and try that instead. Write down what worked in the
     page's notes.
4. **Count** *Items* in *Music* → **Set Variable** `Total`.
5. **Calculate** `Total − N` → then **Calculate** *Result* `+ 1` →
   **Set Variable** `Start`.
6. **If** `Start` *is less than* `1` → **Set Variable** `Start` to `1` →
   **End If**.
7. **Get Items from List** → *Items in Range* `Start` to `Total`, from *Music*.
8. **Repeat with Each** item in *Items*:
   - **Dictionary** with these keys. In each value, insert the *Repeat Item*
     variable and tap it to pick the property:
     - `title` → Repeat Item › **Title**
     - `artist` → Repeat Item › **Artist**
     - `album` → Repeat Item › **Album**
     - `duration` → Repeat Item › **Duration** (unit unknown, the spike records it)
     - `dateAdded` → Repeat Item › **Date Added**
9. **End Repeat**.
10. **Stop and Output** → *Repeat Results*. Nowhere to output → Copy to Clipboard.

The page accepts a JSON array or newline-separated JSON objects. Shortcuts
usually turns a list of dictionaries into the latter.

---

## 3. `Anisong · Add Tracks` (spike 1: the riskiest one)

Input: `{"mode":"staging"|"append","playlist":"…","country":"us","ids":[123,…]}`

1. **Get Dictionary from** *Shortcut Input* → **Set Variable** `Args`.
2. **Get Dictionary Value** `country` in `Args` → **Set Variable** `CC`.
3. **Get Dictionary Value** `ids` in `Args`.
4. **Repeat with Each** item in *Dictionary Value*:
   - **Text**: `https://music.apple.com/` `CC` `/song/` *Repeat Item*
   - **Get URLs from Input** (*Text*). This turns the text into a URL value.
5. **End Repeat** → **Set Variable** `Links` to *Repeat Results*.
6. **Get Dictionary Value** `mode` in `Args`.
7. **If** *Dictionary Value* **is** `staging`:
   - **Create Playlist** named `anisong-curator · ` *Current Date* (format it
     short), **items:** `Links`.
   **Otherwise:**
   - **Add to Playlist**: `Links` → *‹your playlist, hard-coded for the
     spike›*.
   **End If**.
8. **Count** *Items* in `Links`.
9. **Dictionary** `{ ok: true, sent: ‹Count› }` → **Stop and Output** *Dictionary*.

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
