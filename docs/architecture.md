# Notation architecture — Milestone 3A

## Boundaries and shared state

```text
Electron main                         Sandboxed React renderer
  native dialogs                        App: one document + bounded undo/redo history
  validated score file I/O                ├─ Notation: VexFlow + pointer overlay
  window lifecycle                        └─ Piano roll: SVG timeline + pointer gestures
          ↕ narrow typed IPC ↔ context-isolated preload
                         canonical composition + shared immutable commands
                                        ↕
                               separate short Web Audio audition
```

`src/shared/composition.ts` owns serializable musical data, constructors, explicit migrations, runtime validation, and basic insertion/deletion. `signatures.ts` supplies the variable-meter timeline and accidental resolution. `editing.ts` supplies notation/signature/tie commands and immutable undo/redo. `piano-roll.ts` supplies chromatic insertion, scoped batch editing, spelling, staff assignment, and explicit chord/tie selection. Shared modules depend on neither React, Electron, audio, nor VexFlow.

App owns one canonical document and up to 100 history edits. Both views submit validated commands to it; there is no second musical model or synchronization protocol. Switching views preserves selection and the editing cursor. Per-part roll scroll positions, per-view page scroll, zoom/snap/tool preferences, hover, gestures, and audition state are transient. Opening/replacing a document clears history and old scroll caches. Dirty state compares the document to its last saved snapshot, including after undo/redo.

Main owns native dialogs and paths. Saves validate again, write a sibling temporary file, then rename. The preload exposes only typed `openScore`, `saveScore`, and `setDocumentDirty`; raw IPC, Node, and filesystem APIs do not reach React. File operations disable musical editing.

## Schema 4 and exact timing

Times are absolute integer ticks at **480 PPQ**. Event starts align to **60 ticks**, exactly one thirty-second note. Schema 4 durations can be any positive integer multiple of 60 up to score end. Each note retains its own ID, spelled pitch, velocity, staff, start, duration, and optional `tieTo`. A sustained note crossing bars remains **one canonical event and one piano-roll block**; it is not destructively split into new IDs.

Each part owns one or two staves with stable IDs and independent event lists. Piano is one instrument with treble then bass. Chords are note events in the same staff with identical start and duration; VexFlow groups their per-tone identities into one chord glyph. Independent overlapping voices with unequal starts/durations are explicitly rejected. Validation also prevents duplicate sounding chord tones, out-of-range events, broken ties, and score-end overflow. Invalid commands leave the entire prior document intact. These restrictions can later be extended with explicit voice identity without replacing event IDs.

Only explicitly selected notes are modified. A chord-wide duration edit therefore requires selecting all its tones; **Select chord / ties** computes a connected component of existing same-staff chord tones and explicit ties. It changes selection only. Moving/resizing an incompatible subset is rejected, rather than retiming or deleting unselected tones. Deletion removes dangling incoming ties without moving later music.

A note's optional `tieTo` references an adjacent same-staff note of equal written step/octave and resolved MIDI pitch. Existing explicit tie relationships survive compatible batch moves; incompatible edits are rejected until the user selects the required components or removes the tie. Renderer-generated sustain ties do not add `tieTo` fields to the document.

Versions 1→2→3→4 have explicit migrations. Version 1 retains original notes/IDs/ticks on the original clef and adds deterministic collision-free companion staves to piano. Version 2 adds an empty signature-change list. Version 3→4 retains every musical field and identity; it changes the version only. Legacy validation still rejects durations/cross-bar events that were invalid in their original format. New saves use version 4; older applications cannot read them. Loading never overwrites files automatically. Unknown versions are rejected and unknown UI fields dropped.

## Chromatic pitch and written spelling

Pitch stores step, octave, and accidental: `''` follows the active key/earlier explicit accidental, `'#'`, `'b'`, and `'n'` override it. `resolvedPitch` checks key, preceding explicit accidentals of the same step/octave in the same staff/bar, and the note's own override. Bar boundaries reset accidental carry. Minor keys use conventional signatures; inflections need explicit accidentals.

`pianoNotes` derives sounding MIDI and staff ownership from canonical notes. `spellMidi` prefers existing spelling where possible, then the active key, natural spellings, and the key's sharp/flat family. When a roll edit changes accidental carry or moves a note into another key, the command rebuilds sorted staves and adds explicit modifiers where needed to preserve each unedited note's sounded MIDI. A roll pitch edit intentionally changes chromatic pitch; an explicit signature edit preserves written spelling and intentionally changes pitches following that key. Clefs affect notation geometry, not MIDI rows.

Existing staff ownership never changes during roll transposition. New piano notes default to treble at MIDI 60/C4 and above, bass below; the roll offers a new-note override and explicit reassignment controls. Other instruments retain their single staff. The roll supports existing octave-0–9 spellings, including C-flat0/MIDI 11 through G9/MIDI 127. Lower MIDI pitches require a future spelling-range extension.

## Piano-roll interaction and geometry

`renderer/piano-roll/geometry.ts` is a pure adapter for ticks/pixels, MIDI/rows, and timeline marks. `PianoRoll.tsx` renders note blocks, a stationary keyboard, a sticky measure/beat ruler, and grid subdivisions. Both piano staves are visible with staff colors; overlapping treble/bass unisons use separate half-row hit targets. Static accents mark compound 6/8 groups. These timeline primitives do not depend on an audio clock and can later support a separate transport overlay.

Snap choices are 480/240/120/60 ticks (1/4 through 1/32). Changing snap/zoom never edits data. Insertion and cursor positioning snap to the grid. Horizontal movement snaps the anchor note while preserving relative group offsets; purely vertical movement preserves original timing even on a coarser grid. Resizing snaps the anchor duration and applies its duration delta to the explicit selection, preserving a group's existing relationships. Minimum duration is the active snap, down to 60 ticks. Right-edge handles separate resize from move.

Pointer coordinates pass through the actual SVG screen matrix before focus; focus uses `preventScroll`. Gestures capture the pointer on the stable root SVG and require four client pixels before moving/resizing. A gesture holds source notes and renders ghosts without changing canonical data. Pointerup submits one batch command and creates at most one undo step. Escape, blur, pointer cancellation/lost capture, disabled editing, score replacement, and scale/tool changes cancel. Distinct snapped pitch changes trigger audition; jitter at the same pitch does not. Invalid bounds preview red; validation explains overlaps/tie errors at commit.

Draw clicks insert into empty grid space. Select clicks deselect empty space; rectangular dragging selects intersecting blocks. Ctrl/Meta/Shift-click toggles membership. Arrow keys edit selected notes by snap/semitone (Shift for octaves), or position the cursor without selection; Enter inserts at the editing cursor. Duration keys 1–6, Delete/Backspace, Ctrl+A, shared undo/redo, and keyboard-operable note/resize/key targets support computer-keyboard use. Browser text fields retain native shortcuts.

Scroll/zoom exposes destinations before dragging; edge autoscroll is not implemented. Piano roll displays notes, while explicit rests stay in notation. Preferences are not written into `.notation` files.

## Continuous notation and sustained fragments

`score/engrave.ts` creates coherent VexFlow systems in one SVG. It derives minimum widths including actual signature modifier widths, packs columns, shares tick formatting and system breaks across parts, and draws contiguous stave segments/barlines. Piano braces appear once per system. Clefs repeat at system starts, keys at starts/changes, and meters at the beginning/changes. Bundled Bravura/Academico fonts load before layout. Compound 6/8 beams use dotted-quarter groups.

`measureEvents` clips events to each measure and decomposes durations into exact display glyphs, including thirty-seconds and single-dotted glyphs. Each fragment retains a reference to its canonical source; missing time becomes display-only rests. Fragments of chord tones are sorted/grouped by onset. No generated fragments or rests are saved.

The engraving adapter tracks a list of rendered fragments per canonical ID, automatically connects fragments with ties, and connects explicit `tieTo` links from the source's last fragment to the target's first. System breaks get paired partial ties. Continuing fragments resolve pitch at the original onset, so a sustained sound does not change under a later key signature. Hit targets/selection point back to the canonical event; deleting any fragment deletes that event, and dragging it repitches the original note while retaining duration/time.

VexFlow notehead glyph bounds supply per-tone hit geometry, including displaced chord seconds; dots are excluded. Signature targets derive from stave modifiers. Sequential K/T placeholders above measures provide distinct accessible targets for absent signatures, including C major at wrapped system starts. Direct interaction identifies the part/staff from the clicked element; no Active Staff sidebar selector is needed. Parts selection determines the roll instrument, but never gates direct notation interaction.

`ScoreView` redraws only for score/width changes; hover, selection, and dragging update its overlay. Coordinates are transformed before focus, retaining the Windows Milestone 2A fix. Vertical drags snap diatonically with clef-aware ledger positions, audition on changes, and retain ID/rhythm/ownership. Notation entry/duration buttons keep the within-bar workflow; sustained durations are created/resized in the piano roll. Dotted thirty-seconds would be 90 ticks and are disabled because they do not align to this milestone's 60-tick grid.

## Signatures and audition

Initial key/meter plus sorted measure-boundary `signatureChanges` apply across every part until the next override of that property. All consumers use `measureStart`, `measureTicks`, `measureAtTick`, and `scoreEnd`; none assume uniform bars. Meter commands preserve each onset's measure and offset and retain duration. New onset overflow, existing within-bar event overflow, invalid overlaps/ties, or score-end overflow reject the command. Already sustained events may continue across the new bars. `SignatureEditor` is shared by sidebar and contextual forms.

`audio/PianoAudition.ts` remains separate from commands. It lazily creates Web Audio, uses a built-in harmonic waveform and short envelope, and bounds previews to at most two oscillators. New previews release old sound; asynchronous context activation keeps only the latest request. Cancel/mute/replacement/unmount stop pending previews. Audio failure does not prevent editing. This is short audition only: no composition scheduling, transport, instrument sound library, metronome, or export.

## Limits, future integration, and validation

Limits remain 16 parts, 64 measures, 4096 events per staff, 30–240 BPM, and 2 MB per file. No tuplets, independent overlapping voices, double dots/accidentals, or cross-staff notation are added. MIDI recording can later feed the same immutable commands, per-tone IDs, and staff-assignment rules. A future playback scheduler can merge staves, resolve pitches/tie chains, and drive a separate timeline overlay. VST3 hosting belongs in an isolated native host; export should consume immutable snapshots through typed IPC. Milestone 3B is not implemented.

Electron sandboxing, context isolation, disabled Node integration, trusted-frame checks, denied navigation/new windows/permissions, and production CSP remain in place. Development binds to loopback.

Unit tests cover migrations, exact snap/timing, spelling/accidental preservation, staff ownership, chord/tie edits, validation, immutable history, audio, and renderer geometry. Browser tests check actual SVG paths/glyphs and audio frequencies, roll edits at several zoom levels, all snaps, selection/marquee, unisons, sustained tied engraving, flags/beams/rests, signature synchronization, and notation regressions. Desktop tests save/reopen exact edited data at 100%/125% native zoom and retain existing isolation/legacy/native-file coverage.

CI runs on Ubuntu and Windows. Native tests precede browser downloads, with failure assertions and recent Playwright actions published as check annotations. Physical audio, OS dialogs, and Windows display scaling remain manual checks described in README.
