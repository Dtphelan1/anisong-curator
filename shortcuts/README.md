# Apple Shortcuts for anisong-curator

The app finds and reviews songs. It can't touch your Apple Music library
itself, so two small shortcuts do that part. Build them once, by hand, on
your iPhone or Mac; they sync over iCloud.

| Shortcut | What it does | Where the app uses it |
|---|---|---|
| **`Anisong Add Kept`** | Adds the songs you kept to your playlist, or to a new playlist | **Add to playlist** step → **Copy** (or **Share to the shortcut…**) |
| **`Anisong Export Playlist`** | Copies your playlist's songs as text, so the app can check for duplicates | **Add to playlist** step → **Sync playlist** |

Name them **exactly** as above: plain spaces, no dots or other punctuation.
The app's instructions refer to these names.

The target playlist throughout is **🔥 AniSong MegaMix**. If you rename it,
update it in the app's settings and in both shortcuts.

## Workflow

1. In the app, review songs and keep the ones you want. Songs already in
   your playlist get their own pass afterwards (**Already have**).
2. Run **Anisong Export Playlist** and paste the result into **Sync
   playlist** in the app's **Add to playlist** step. This is needed only
   when the playlist changed outside the app since your last sync; syncing
   before you review sets those songs aside early.
3. The **Add to playlist** step holds back duplicates and shows **Add N
   songs**. Press **Copy N songs**.
4. Run **Anisong Add Kept** and choose **🔥 AniSong MegaMix** (or **New
   playlist** to try it out first).
5. Back in the app, under **Did they land?**, press **Yes, mark as added**.
   Those songs are never exported again.

Duplicate checking happens **only in the app**. It matches likely duplicates
even when names or track IDs differ (e.g. 勇者 vs "Yuusha"). The shortcuts
just read and add.

---

## Before you start

**Editor basics**
- **Add an action:** tap **+** (or the search field at the bottom on iPhone)
  and type its name, e.g. "Get URLs from Input".
- **Insert a variable:** tap a field, then pick from the variable bar above the
  keyboard. **Select Variable** shows all of them.
- **Use a property** (e.g. a song's **Title**): insert the variable, tap
  the inserted token, and choose the property.
- **Nesting:** **If**, **Repeat** and **Choose from Menu** add their closing
  action (**End If** / **End Repeat** / **End Menu**) automatically. Drag
  actions *between* them to nest them.
- **Pick playlists from the picker**, never by typing the name. The 🔥 emoji
  makes typed names easy to get wrong.
- **Debug:** add a temporary **Quick Look** (iPhone) or **Show Result** (Mac)
  after any step to see its value, then remove it.

**Accept input.** Open the shortcut's settings (tap **ⓘ** or the shortcut's
name, then **Details**) and turn on **Show in Share Sheet**. That adds a
*Receive … input* row at the top of the editor:
- set it to receive **Text**;
- set *If there's no input* to **Continue**, because the input block below
  handles that case.

**The input block.** Every shortcut that takes input starts with these six
actions. A shortcut never *prompts* for input: run with ▶ or from the home
screen, its input is empty. So this block uses the shared text when there is
some, and the clipboard otherwise:

| # | Action | Settings |
|---|---|---|
| 1 | **If** | Input: *Shortcut Input*. Condition: **has any value** |
| 2 | **Set Variable** | Name: `Input`. Input: *Shortcut Input* |
| 3 | **Otherwise** | added with step 1 |
| 4 | **Get Clipboard** | none |
| 5 | **Set Variable** | Name: `Input`. Input: *Clipboard* |
| 6 | **End If** | closes step 1 |

Both branches set the **same** variable, `Input`. Every later step reads
variable *Input*, never *Shortcut Input* or *Clipboard* directly.

These labels are from recent iOS versions and may have moved. If something
differs, search the action list for the bolded name.

---

## 1. `Anisong Add Kept`

Adds the copied songs, in order, to your playlist or to a new one.

**Input:** the text the app's **Add to playlist** step copies. In the
**Shortcut** format that's one song per line:

```
Gurenge | LiSA | https://music.apple.com/us/song/1538286723
```

The shortcut only uses the links, so the **Text + links** format works too.

| # | Action | Settings |
|---|---|---|
| 1–6 | **Input block** | as above |
| 7 | **Get URLs from Input** | Input: variable *Input* |
| 8 | **Choose from Menu** | Prompt: `Add songs to…`. Items: `🔥 AniSong MegaMix`, `New playlist` |
| 9 | *(under **🔥 AniSong MegaMix**)* **Add to Playlist** | Music: *URLs* (from step 7). Playlist: **🔥 AniSong MegaMix** (picker) |
| 10 | *(under **New playlist**)* **Create Playlist** | Name: `anisong-curator ` + *Current Date*. Items (tap *Show More*): *URLs* |
| 11 | **End Menu** | added automatically |

**Check it once.** Copy two songs that aren't in your library, run the
shortcut, and choose **New playlist**. Both should be in the new playlist, in
the copied order. Then delete that playlist.

**If songs don't land:**
- Turn on Settings → Music → **Add Playlist Songs**, which adds playlist songs
  to your library.
- Add a temporary **Quick Look** after step 7. You should see a list of
  `music.apple.com` links. If it's empty, the clipboard didn't hold the
  copied text.

---

## 2. `Anisong Export Playlist`

Copies the playlist's titles, artists and durations as one block of text, for
the app's **Sync playlist** box. It only reads, and it has no per-song loop,
so it's fast even for large playlists.

It takes no input (there's nothing to read except the playlist), so it has no
input block and doesn't need **Show in Share Sheet**.

| # | Action | Settings |
|---|---|---|
| 1 | **Find Music** | Filter: **Playlist** *is* **🔥 AniSong MegaMix** (picker). No sort, no limit |
| 2 | **Set Variable** | Name: `Songs`. Input: *Music* |
| 3 | **Count** | Count **Items** in variable *Songs* |
| 4 | **Set Variable** | Name: `Count`. Input: *Count* (from step 3) |
| 5 | **Get Details of Music** | Detail: **Title**. Input: variable *Songs* |
| 6 | **Combine Text** | Input: *Title* (from step 5). Separator: **New Lines** |
| 7 | **Set Variable** | Name: `Titles`. Input: *Combined Text* |
| 8 | **Get Details of Music** | Detail: **Artist**. Input: variable *Songs* |
| 9 | **Combine Text** | Input: *Artist* (from step 8). Separator: **New Lines** |
| 10 | **Set Variable** | Name: `Artists`. Input: *Combined Text* |
| 11 | **Get Details of Music** | Detail: **Duration**. Input: variable *Songs* |
| 12 | **Round Number** | Input: *Duration* (from step 11). Round to: **Ones Place**. Mode: **Normal**. This makes whole seconds, e.g. `238` |
| 13 | **Combine Text** | Input: *Rounded Number* (from step 12). Separator: **New Lines** |
| 14 | **Set Variable** | Name: `Durations`. Input: *Combined Text* |
| 15 | **Text** | The block below, with the four variables inserted where shown |
| 16 | **Copy to Clipboard** | Input: *Text* (from step 15) |
| 17 | **Show Notification** | `Copied ` + variable *Count* + ` songs. Paste into the app's Sync playlist box.` |

Step 15's text. Type the first line and the `---…---` markers exactly; each
`‹…›` is an inserted variable. **Don't add blank lines** between sections:
every line under a heading is read as a value.

```
anisong-playlist v2
🔥 AniSong MegaMix
---count---
‹Count›
---titles---
‹Titles›
---artists---
‹Artists›
---durations---
‹Durations›
```

**Check it once.** Run it, paste into a note, and confirm:
- **one line per song** in each section;
- **the same number of lines** in all three sections, equal to the number
  under `---count---`. The app pairs titles with artists by position; if a
  section is short, it warns and matches without it;
- **durations are whole numbers** like `238`, not `3:58` or `238.4`. If they
  aren't, check step 12's settings.

If step 5, 8, 11 or 12 returns one combined value instead of a list, wrap
steps 5–14 in a **Repeat with Each** over *Songs*. That's slower, but still
read-only.

**Order:** songs from **Find Music** may not come out in playlist order, so the
app uses this export for duplicate checks only. The "suggest last show"
feature needs an ordered copy: on a Mac, Music → **View → Sort By → Playlist
Order**, then **File → Library → Export Playlist…** (Plain Text), imported on
the show-picker page.

---

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| "Nothing to add" or no links found | The clipboard didn't hold the app's copied text. Copy again, or use **Share…** in the app |
| Wrong playlist, or "playlist not found" | The playlist name was typed rather than picked. Re-pick it from the action's picker |
| Export: titles without artists, or misaligned | The steps 6–8 artist chain isn't using variable *Songs*, or step 7 combines the wrong output |
| Export: one giant line | **Combine Text** isn't set to **New Lines** |
| An action shows as indented in the wrong place | An **End If / End Repeat / End Menu** got moved. Drag actions back between their open and close |
| A Siri-built shortcut misbehaves | Siri may pick different actions or edit an existing shortcut in place. Build new shortcuts from these tables instead |

---

## Appendix A: spike shortcuts (exploration only)

These three shortcuts were built to answer early feasibility questions; see
SPEC §11. The app doesn't use them. They're kept so the spike page
(`spike/index.html`, section 4) can still be run. Their names match the spike
page's default fields: `Anisong Echo`, `Anisong Read Tail` and
`Anisong Add Tracks`.

All three end with **Stop and Output**, with *If there's nowhere to output*
set to **Copy to Clipboard**. When launched from the spike page, the output
returns through x-callback; otherwise paste it into the page.

**Outcomes:**
- **Spike 1 (add from links): passed** on iOS. It's now `Anisong Add Kept`.
- **Spike 2 (read the playlist tail): superseded** by the Mac export and
  `Anisong Export Playlist`.
- **Spike 3 (x-callback round trip): not needed**; the app uses the clipboard
  or the Share Sheet.

### A.1 `Anisong Echo` (spike 3)

| # | Action | Settings |
|---|---|---|
| 1–6 | **Input block** | as above |
| 7 | **Stop and Output** | variable *Input*. Nowhere to output → Copy to Clipboard |

The page sends `{"ping":"anisong",…,"unicode":"紅蓮華 · ½"}` and checks that
the same text comes back.

### A.2 `Anisong Read Tail` (spike 2)

Input: `{"playlist":"…","n":30}`. The playlist is hard-coded in step 9.

| # | Action | Settings |
|---|---|---|
| 1–6 | **Input block** | as above |
| 7 | **Get Dictionary from** | variable *Input* |
| 8 | **Get Dictionary Value** | Key `n` → **Set Variable** `N` |
| 9 | **Find Music** | Playlist *is* ‹your playlist›. Sort: none. Limit: off |
| 10 | **Count** | Items in *Music* → **Set Variable** `Total` |
| 11 | **Calculate** | `Total − N`, then **Calculate** *Result* `+ 1` → **Set Variable** `Start` |
| 12 | **If** | `Start` *is less than* `1` → **Set Variable** `Start` = `1` → **End If** |
| 13 | **Get Items from List** | Items in Range `Start` to `Total`, from *Music* |
| 14 | **Repeat with Each** | *Items*. Inside: **Dictionary** with `title`/`artist`/`album`/`duration`/`dateAdded` set to *Repeat Item* › **Title**/**Artist**/**Album**/**Duration**/**Date Added** |
| 15 | **End Repeat** | |
| 16 | **Stop and Output** | *Repeat Results*. Nowhere to output → Copy to Clipboard |

### A.3 `Anisong Add Tracks` (spike 1)

Input: `{"mode":"staging"|"append","playlist":"…","country":"us","ids":[…]}`.
The spike page can also send IDs you paste into it.

| # | Action | Settings |
|---|---|---|
| 1–6 | **Input block** | as above |
| 7 | **Get Dictionary from** | variable *Input* → **Set Variable** `Args` |
| 8 | **Get Dictionary Value** | `country` in `Args` → **Set Variable** `CC` |
| 9 | **Get Dictionary Value** | `ids` in `Args` |
| 10 | **Repeat with Each** | *Dictionary Value*. Inside: **Text** `https://music.apple.com/` `CC` `/song/` *Repeat Item* → **Get URLs from Input** |
| 11 | **End Repeat** | → **Set Variable** `Links` = *Repeat Results* |
| 12 | **Get Dictionary Value** | `mode` in `Args` |
| 13 | **If** | *Dictionary Value* **is** `staging`: **Create Playlist** `anisong-curator ` + *Current Date* with `Links`. **Otherwise:** **Add to Playlist** `Links` → ‹your playlist›. **End If** |
| 14 | **Count** | Items in `Links` |
| 15 | **Dictionary** | `{ ok: true, sent: ‹Count› }` → **Stop and Output** |

## Appendix B: retired designs

- **Duplicate check inside the add shortcut.** An earlier `Anisong Add Kept`
  read the whole playlist and compared `title | artist` text before adding.
  It was slow, timed out on a large playlist, and could only match exact text.
  Duplicate detection moved into the app (SPEC §9.4), which matches likely
  duplicates by similarity. Don't rebuild it.
- **Siri-drafted shortcuts.** Asking Siri to *update* a shortcut edits it in
  place and broke a working version once. Build from the tables above.
