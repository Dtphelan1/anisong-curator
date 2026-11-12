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
to *Continue*.

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

### Running with no input
A shortcut **never prompts** for Shortcut Input. Run from the editor with ▶,
its input is simply empty, so *Get Dictionary from Shortcut Input* has nothing
to parse. Input only arrives from a caller: the spike page's link, the Share
Sheet, or another shortcut. To test in the editor, either:
- set *If there's no input* to **Get Clipboard**, then copy test JSON (for
  example `{"playlist":"My Playlist","n":5}`) before pressing ▶; or
- temporarily put a **Text** action holding test JSON at the top, and point
  *Get Dictionary from* at it.

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

---

## 4. `Anisong Add Kept`: add the kept list, skipping duplicates

This is the shortcut the app's **Kept** section is built for. In the app, keep
the **Shortcut** format, press **Copy** (or **Share…** on a secure origin), then
run this shortcut. Each line is one song:

```
Gurenge | LiSA | https://music.apple.com/us/song/1538286723
```

The app has already removed known duplicates (SPEC §9.4). This shortcut is the
safety net for songs added to the playlist outside the app since your last
export: it skips any line whose `title | artist` already matches a song in the
playlist. Songs are added in the order of the lines.

Actions:
1. *Receive **Text** input from **Share Sheet***; *If there's no input*:
   **Get Clipboard**. **Set Variable** `Input`.
2. **Find Music** where **Playlist** *is* **🔥 AniSong MegaMix** (no limit,
   no sort).
3. **Repeat with Each** item in *Music*:
   **Text** `‹Repeat Item › Name› | ‹Repeat Item › Artist›` → **End Repeat**.
4. **Combine Text** *Repeat Results* with **New Lines** → **Change Case** to
   **lowercase** → **Set Variable** `Existing`.
5. **Split Text** `Input` by **New Lines** → **Repeat with Each** line:
   - **If** *Repeat Item* *contains* `music.apple.com`:
     - **Split Text** *Repeat Item* by **Custom** ` | ` (space, bar, space).
     - **Get Item from List**: item **1** → **Set Variable** `Title`.
       Item **2** → **Set Variable** `Artist`.
     - **Text** `‹Title› | ‹Artist›` → **Change Case** **lowercase** →
       **Set Variable** `Key`.
     - **If** `Existing` *contains* `Key`: **Add to Variable** `Skipped`
       (the Title).
       **Otherwise**: **Get URLs from Input** (*Repeat Item*) →
       **Add to Variable** `ToAdd`.
     - **End If**.
   - **End If**.
6. **End Repeat**. If `ToAdd` has no items: **Show Alert** "Nothing new to
   add (skipped *Count of Skipped*)", then **Stop This Shortcut**.
7. **Choose from Menu**: "Add *Count of ToAdd* songs to…":
   - **🔥 AniSong MegaMix**: **Repeat with Each** in `ToAdd` → **Add to
     Playlist** **🔥 AniSong MegaMix** → **End Repeat**.
   - **New staging playlist**: **Create Playlist** `anisong-curator ‹Current
     Date›` with items `ToAdd`.
8. **Show Notification** "Added *Count of ToAdd*, skipped *Count of Skipped*
   duplicates".

Siri prompt (paste or dictate; replace the playlist name if it changes):

> Update my shortcut "Anisong Add Kept" (or create it). It takes text from the
> share sheet or, if there's no input, from the clipboard. First, find all songs
> in my playlist "🔥 AniSong MegaMix" and make a lowercase list where each line
> is the song's name, then " | ", then its artist. Then go through the input
> text line by line. Skip lines that don't contain "music.apple.com". For the
> others, split the line by " | ": the first part is the title and the second
> is the artist. Make a lowercase "title | artist" key. If the playlist list
> already contains that key, add the title to a Skipped list. Otherwise add the
> line's URL to a To Add list. If To Add is empty, show an alert "Nothing new to
> add" and stop. Otherwise ask with a menu whether to add the To Add songs one
> at a time, in order, to "🔥 AniSong MegaMix", or to create a new playlist named
> "anisong-curator" plus today's date with them. Finish with a notification
> saying how many were added and how many duplicates were skipped.

**Pick the playlist from the action's picker** rather than typing its name; the
🔥 emoji makes typed names easy to get wrong.

Notes:
- The `contains` check is plain text, so it's stricter than the app's: a song
  whose library name differs from the catalog name (e.g. added from another
  storefront) can slip through. The app's check is the primary one.
- **Quick test worth doing once:** run the shortcut twice with the same song
  and the duplicate check temporarily removed. If **Add to Playlist** already
  refuses duplicates by itself, note it. The check stays either way, since a
  silent duplicate can't be undone from Shortcuts.
