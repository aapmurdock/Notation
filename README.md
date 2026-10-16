# Notation

A Windows desktop music composition workspace built with Electron, React, TypeScript, Vite, and VexFlow.

## Milestone 2B: interactive composition

- Click the staff to enter and immediately hear a short built-in piano preview. Drag an existing note vertically to snap through lines, spaces, and ledger lines; release to commit, or Escape to cancel.
- Key-aware audition, including major/minor signatures, explicit accidentals, and accidental carry within a measure. **Audition on/off** controls preview sound; no samples or audio services are required.
- Click a printed key/time signature to edit it directly. Small **K/T** targets above a measure also provide access where no signature is printed, including C major. The sidebar edits the same properties.
- Major/minor keys, 2/4, 3/4, 4/4, and 6/8, with changes at measure boundaries across every part. Meter edits preserve each note's measure and beat; unsafe changes are rejected without losing music.
- Select notes/rests and change durations or dots from the compact toolbar. Add chord tones, change/remove accidentals, connect adjacent matching notes with ties, Shift-click to select multiple entries, and delete selections.
- Undo/redo with **Ctrl+Z / Ctrl+Y**, plus duration and pitch shortcuts.
- Continuous VexFlow systems, piano grand staves, aligned multiple parts, native Open/Save, and unsaved-change protection remain available.
- Version 3 `.notation` saves with automatic migration from versions 1 and 2, preserving existing IDs, pitches, durations, and tick positions on load.

This branch stops at Milestone 2B. Complete playback, MIDI recording/import, piano roll editing, VST3 hosting, and WAV/MP3 export remain future work. Chord tones share a rhythmic duration within one staff voice; independent overlapping voices, tuplets, double dots, and cross-staff notation are not included.

![Notation Milestone 2B editing workspace](docs/milestone-2b.png)

## Launch on Windows 11

Install **Node.js 24 LTS** (including npm) from [nodejs.org](https://nodejs.org/) and [Git for Windows](https://git-scm.com/downloads/win). Restart PowerShell after installing them.

```powershell
git clone https://github.com/aapmurdock/Notation.git
cd Notation
npm ci
npm run dev
```

When reviewing the Milestone 2B PR before it is merged, run `git switch feat/milestone-2b-notation-editing` after cloning and before `npm ci`.

`npm run dev` opens a **desktop window**, with React hot reload. Keep PowerShell open while developing; press Ctrl+C in the terminal to stop it. Node.js and the downloaded Electron binary must match your Windows architecture (x64 or ARM64). No Python, Visual Studio, audio plugins, API keys, or additional services are required for this milestone.

To run the production development build:

```powershell
npm run build
npm start
```

Build output goes to `out/`. `npm start` requires those outputs and the installed dependencies. This milestone does not generate an installer or a standalone distribution; run it from the repository using the commands above.

### Testing this branch in an existing Windows 11 checkout

Stop the application, open PowerShell in your Notation directory, and run:

```powershell
git fetch origin
git switch feat/milestone-2b-notation-editing
npm ci
npm run dev
```

### Manual evaluation on Windows 11

1. **Check the score foundation.** Inspect the example, resize the window, and add Violin/Cello. Staff lines remain continuous; barlines and beats align across parts; each piano system has one brace and one clef per staff. Both piano staves accept independent music.
2. **Hear mouse entry.** Start **New score**, choose a quarter, and click the bottom treble line (**E4**, MIDI 64). Click the bass C3 position (three diatonic steps above its bottom G2 line; MIDI 48). Each successful note insertion should sound once, and rests should stay silent. **Audition off** mutes previews. Check your Windows output device and application volume if silent.
3. **Drag and cancel.** Click a notehead and drag vertically. The blue preview snaps to lines/spaces and ledger lines, and sounds only when its pitch changes. Horizontal motion keeps the original beat. Release to commit; duration, ID, and beat stay unchanged. Repeat and press Escape before release: the original pitch must remain. Move outside the staff while holding the mouse to check pointer capture. Window focus loss also cancels.
4. **Check zoom and scroll.** Repeat insertion/dragging in a short window requiring scrolling, at Windows display scaling of 100% and 125%. Focus Title first, then enter notes. Preview and inserted pitch must agree without a focus-induced viewport jump. Desktop tests additionally exercise 100% and 125% application zoom.
5. **Edit signatures directly.** Click the printed **4/4**, choose 3/4 or 6/8, and Apply. Click the key signature or **K** target above a staff. Choose G major: entered F4 should now sound F♯4 (MIDI 66). Choose D minor: B should sound B♭. Sidebar controls reflect the active measure's signatures. Tab/Enter can operate signature targets; Escape/Cancel dismisses the contextual editor.
6. **Make a local change.** Use **K/T** above measure 2 or later. Changes apply from that boundary until the next change of the same type, across every part. Earlier measures retain their signatures. Choose a measure header or staff to show its signatures in the sidebar. Applying the sidebar controls uses that selected measure.
7. **Protect existing music.** Enter a whole note in measure 1 of 4/4, then try changing it to 3/4: the editor should explain which measure will not fit and retain the score. For valid meter edits, notes keep their measure and offset from its start; downstream absolute ticks adjust to the new bar lengths. Key edits preserve written pitch spelling, while notes following the key sound according to the new signature.
8. **Edit notes and rests.** Select an entry and use duration buttons or **1–5**. Toggle the dot (**.**) for a dotted duration. A quarter becomes 720 ticks (1½ quarter beats); a dotted sixteenth is 180 ticks. Overlaps and barline crossings are rejected atomically. Dotted rests work the same way. Toolbar controls affect the selection when one exists and future entry otherwise. **N** clears selection and moves past occupied time for continued writing.
9. **Build chords.** Toggle **Chord** (**H**) before entering tones. The caret stays at the same beat; type C, E, G or click their staff positions at that beat. Each tone has its own identity and pitch, and VexFlow engraves one chord. Turn Chord off and press Right or N to move onward. To add to an existing chord, select a tone and enable Chord. Changing a chord tone's duration resizes the whole chord; deleting or dragging a tone affects that tone only.
10. **Edit accidentals.** Select a note and choose Sharp, Flat, Natural, or **Key**. Natural explicitly cancels the key or a carried accidental; Key removes an explicit override and follows the key/earlier accidental in that bar. These controls also work for future notes with no selection. Explicit accidentals carry for the same written pitch and octave in the same staff until the next barline.
11. **Tie notes.** Enter adjacent notes of the same written and sounded pitch, select the earlier one, and choose **Toggle tie** (**T**). Repeat to remove it. Ties can cross barlines and system breaks. They connect existing notes; they do not create new notes. Remove an affected tie before an edit that would make its pitches or times incompatible. Deleting a tie target also removes its incoming tie.
12. **Select multiple entries.** Shift-click individual noteheads/rests. Delete removes the selection as one edit; duration/accidental changes apply to the selection (and all tones of a resized chord). Adjacent chord seconds remain independently selectable. Selection is available across piano staves and parts; marquee selection is not included.
13. **Undo and redo.** Use Ctrl+Z / Ctrl+Y or the buttons. A drag, chord duration edit, batch delete, or signature change takes one undo step. A new edit clears redo. Undoing back to the saved document clears the unsaved indicator; opening/creating a score clears history. Title/tempo typing retains normal text-field shortcuts.
14. **Save and reopen.** Save a score with both piano staves, chords, dots, accidentals, ties, and local signatures. Open it again and verify pitches, durations, part labels, signatures, and tie curves. Open copies of older version 1/2 files; music remains on its original staves. Save to a **new filename** for evaluation: version 3 files cannot be opened by older milestones.
15. **Check protection.** Cancel unsaved-change confirmations when creating/opening/closing. Open an invalid file and confirm the current score survives. Editing controls, including signatures, are disabled during native file operations.

Mouse x positions snap to the selected duration's grid. Existing notes/rests are selected rather than overwritten. Deleted entries leave gaps without shifting later music. Duration extensions require unoccupied time and cannot cross a barline; use separate tied notes across bars.

### Keyboard reference (with score or toolbar focus)

| Key | Action |
| --- | --- |
| `1`, `2`, `3`, `4`, `5` | Whole, half, quarter, eighth, sixteenth; edits selection when present |
| `.` | Toggle dotted duration |
| `H` | Toggle chord entry (hold the beat for more tones) |
| `T` | Add/remove ties from selected notes to adjacent matching notes |
| `A`–`G` | Enter pitch in the pending octave |
| Up / Down | Repitch a single selected note, or move the pending pitch |
| Left / Right | Clear selection and move the caret by one sixteenth |
| Enter / `0` | Insert pending note/rest / explicit rest |
| `R` | Toggle rest entry |
| `+`, `-`, `=` | Sharp, flat, explicit natural |
| Delete / Backspace | Delete selected entries |
| Ctrl+Z / Ctrl+Y | Undo / redo (Ctrl+Shift+Z also redoes) |
| `N` / Escape | Continue writing past occupied time / select mode; Escape cancels a drag |
| Shift-click | Toggle an entry in the selection |
| Tab, Enter | Focus and activate measure/note/signature/toolbar controls |

Typing in metadata fields does not invoke score shortcuts. Instrument choices remain General MIDI metadata; the single built-in piano is used only for audition.

### Troubleshooting

- If PowerShell blocks `npm.ps1`, use `npm.cmd ci` / `npm.cmd run dev`, or use Command Prompt. A global execution-policy change is unnecessary.
- Initial installation downloads the Electron binary from GitHub releases. Allow `registry.npmjs.org`, `github.com`, and `release-assets.githubusercontent.com` on your network. For an HTTPS proxy, configure the proxy normally and set `$env:ELECTRON_GET_USE_PROXY = '1'` before `npm ci`; preserve TLS verification and use your organization's trusted CA configuration when necessary.
- Port 5173 must be free. Stop another Vite instance before starting the app.
- If dependencies or outputs are stale, stop the app, run `npm ci`, then `npm run build` and `npm start`.
- `.notation` files are limited to 2 MB and validated before use. Unsupported or corrupt files produce an error without replacing the current score. Version 1 and 2 files migrate to version 3 on load; unknown versions are rejected.
- Native file dialogs are available in Electron. A browser-only test harness intentionally disables Open/Save.

## Checks

```powershell
npm run check
npx playwright install chromium
npm run test:e2e
npm run test:desktop
```

`check` runs the model, engraving-adapter, file, and React tests, then type checking and a production build. `test:e2e` exercises real continuous VexFlow paths, clef placement, responsive wrapping, grand staff/part alignment, direct entry, Web Audio MIDI frequencies, snapped dragging/cancellation, repeated-pitch suppression, signature editors, chords, dots, ties, selections, undo/redo, and rhythm boundaries. The layout test blocks external requests to verify offline fonts. `test:desktop` requires a completed build and launches Electron to test the isolated bridge and a real save/open round trip with independently entered treble/bass music, version 1 migration, dragging at 100%/125% zoom, and exact restoration of chords/dots/ties/local signatures. Model tests also verify version 2 migration. It substitutes dialog destinations to avoid interactive prompts; it does not automate the operating system's dialog UI. Close other instances before running desktop tests.

CI runs these checks on Ubuntu and Windows. Linux desktop tests require Xvfb (`xvfb-run --auto-servernum npm run test:desktop`) and Electron's system libraries. A constrained container may also require writable XDG configuration/cache directories. `TEST_ELECTRON_NO_SANDBOX=1` is a test-only escape hatch for containers that cannot run Chromium's OS sandbox; the application itself does not disable sandboxing. Do not use that variable for normal development.

## Structure and future development

See [the architecture guide](docs/architecture.md) for the process boundaries, score format, and extension points. The shared score model owns musical data; VexFlow is an engraving adapter and does not own the document.

| Command | Purpose |
| --- | --- |
| `npm ci` | Install the locked dependencies and platform Electron binary |
| `npm run dev` | Build main/preload and launch Electron with Vite hot reload |
| `npm run build` | Type check and build main, preload, and renderer |
| `npm start` | Launch the existing production build |
| `npm test` | Run initial unit and integration tests |
| `npm run test:watch` | Watch unit tests during development |
| `npm run test:e2e` | Exercise real engraving and editing in Chromium |
| `npm run test:desktop` | Exercise the actual Electron window and file bridge |
