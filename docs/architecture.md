# Notation architecture — Milestone 2B

## Process and data boundaries

```text
Electron main                         Sandboxed React renderer
  native dialogs                        document/history + transient interaction state
  validated score file I/O               shared immutable editing commands
  window lifecycle                      VexFlow systems + pointer geometry
          ↕ narrow typed IPC ↔ context-isolated preload
                         shared composition model
                                        ↕
                               short Web Audio audition
```

`src/shared/composition.ts` owns serializable musical data, constructors, migration, runtime validation, and insertion/deletion. `signatures.ts` provides the measure timeline, key metadata, and accidental resolution. `editing.ts` provides pitch/duration/signature/tie commands and bounded immutable undo/redo. These modules depend on neither React, Electron, audio, nor VexFlow.

Each instrument part owns one or two staves with stable IDs and independent event lists. A piano is one part with treble and bass staves, allowing future playback to merge its events into one instrument stream. App owns document state and a history of up to 100 edits. Entry settings, selection, caret, drag, and audio state are transient and never saved. An edit is validated before entering history; failed commands preserve the entire previous document. A drag commits once on pointerup, so it creates at most one history step. New/Open clears history. Dirty state compares the current document with the last saved snapshot, including after undo/redo.

Main owns native dialogs and paths. Saves validate again, write a sibling temporary file, then rename. The preload exposes only typed `openScore`, `saveScore`, and `setDocumentDirty`; no raw IPC, Node, or filesystem APIs reach the renderer. File operations disable document editing, including signature forms.

## Canonical events, chords, dots, and ties

Milestone 2B uses **schema version 3**. Times remain absolute integer ticks at 480 PPQ. Notes retain individual event IDs, spelled pitch, velocity, start, and duration. Chords are simultaneous note events in the same staff with identical starts and durations, rather than a rendering-owned chord object. This representation preserves each tone's identity for MIDI input, piano-roll selection, per-tone repitching, deletion, and future polyphonic recording. The current engraver groups these tones into one VexFlow `StaveNote` with multiple keys and a single rhythmic duration. Independent overlapping voices with different starts/durations remain unsupported; validation rejects them explicitly. A duration command expands to all tones in each affected chord and validates the result atomically.

Duration ticks include whole through sixteenth and their single-dotted values (2880, 1440, 720, 360, 180). A 60-tick duration is also supported for exact implicit gap decomposition on the 60-tick grid required by dotted sixteenths. The toolbar offers whole through sixteenth, with a separate dot toggle. Rests and notes share duration rules. No event can cross a barline or score end. Unwritten time is filled with display-only rests, never saved.

A note's optional `tieTo` points to the next adjacent note event in the same staff. Validation requires equal written step/octave and resolved MIDI pitch, with the target starting exactly at the source's end. A tie may connect different durations, cross a barline, or continue through a chain. Ties connect existing events; incompatible pitch/duration/key edits are rejected until the affected ties are removed. Deletion removes incoming dangling ties. VexFlow draws complete ties within systems and paired partial ties across system breaks.

## Signatures and musical time

The composition stores initial `timeSignature` and `keySignature` plus sorted, unique `signatureChanges` at zero-based measure boundaries. A change can contain key, meter, or both; each applies until the next override of the same type. Changes apply across all parts, keeping barlines aligned. Supported meters are 2/4, 3/4, 4/4, and 6/8; keys include all major/minor signatures through seven sharps/flats.

All timeline consumers use `measureStart`, `measureTicks`, `measureAtTick`, and `scoreEnd`, rather than multiplying by a uniform bar length. During a meter command, each event's original measure and offset are preserved; downstream absolute ticks adjust to the new bar lengths. IDs, spelled pitches, velocities, and durations remain unchanged. If any event would overflow its original measure, the whole command is rejected. The editor explains this behavior before Apply. Key edits never rewrite stored pitch spelling; notes following the key are intentionally sounded according to the new signature. Ties must remain valid.

Pitch accidentals distinguish `''` (follow key/previous accidental), `'#'`, `'b'`, and `'n'` (explicit natural). Resolution checks the active key, then preceding explicit accidentals of the same step and octave in that staff and measure, then the note's own override. A barline resets carry. Enharmonic spelling remains intact. The same resolver supplies audition MIDI and VexFlow pitches, preventing a discrepancy between what is engraved and sounded. Minor keys use their conventional key signatures; harmonic/melodic inflections require explicit accidentals.

`SignatureEditor` is shared by sidebar and contextual forms. Targets cover actual printed signature modifiers. A visible K/T target above each bar offers keyboard/mouse access where a signature is absent. Both interfaces submit the same validated command and update the other through canonical document state. Escape, Cancel, and outside click dismiss contextual forms and return focus without scrolling.

## Continuous engraving and hit testing

`score/engrave.ts` draws one SVG of coherent horizontal systems. It derives voices, groups chord tones, resolves accidentals, and uses VexFlow's minimum widths and actual signature modifier widths to plan columns. Every part shares columns, tick formatting, and system breaks. Stave segments meet at identical endpoints; barlines are conventional. Grand staff braces appear once per piano per system, with connecting barlines. Clefs repeat only at system starts; key signatures repeat at system starts and changes; meters appear at the beginning and changes. A small `ScoreStave` adapter sets the semantic bass clef without adding an unwanted glyph on intermediate bars. Compound 6/8 beams use dotted-quarter groups.

VexFlow notehead glyph bounds (excluding dot glyphs) provide per-tone hit positions. Closely spaced chord seconds receive non-overlapping vertical targets, including displaced heads. Keyboard focus remains available for every individual tone. Signature hit geometry comes from stave modifiers; a zero-width key receives an explicit target. Fonts are bundled and loaded before layout, supporting offline engraving. Ledger extents influence vertical row spacing.

`ScoreView` redraws engraving only for document/width changes. Hover, selection, and drag update the overlay without reformatting music. Pointer coordinates are resolved through the actual SVG screen matrix **before focus**; all programmatic focus uses `preventScroll`, preserving the Milestone 2A Windows fix. Dragging captures the pointer on the stable root SVG and retains the original staff, tick, duration, and pointer-to-head offset. Y snaps by half a staff space through the same treble/bass pitch mapping as insertion. Only changes in snapped diatonic pitch trigger audition. Pointerup commits once; Escape, pointer cancellation, lost capture, window blur, or layout replacement cancel without mutating the score. The blue drag ghost shows the proposed note while the original engraving remains intact until commit.

Duration/accidental controls edit a selection or future entry settings. Shift-click supports additive selection across staves/parts; duration edits expand chord groups. Deletion does not retime later music. Keyboard entry shares the insertion command; text inputs retain native editing shortcuts. Chord entry holds the caret at one onset; normal entry advances past occupied time.

## Lightweight audition

`audio/PianoAudition.ts` owns a lazily created renderer Web Audio context, one periodic waveform with piano-like harmonics, and a short attack/decay envelope. No network samples or new dependencies are needed. A new preview quickly releases the previous one, with at most two retained oscillators. After asynchronous context activation, only the latest requested pitch is scheduled. Stop/cancel invalidates pending requests; replacement/unmount releases audio resources. Audio failure is reported without preventing notation edits. Audition can be muted.

This is note preview only. It does not schedule a composition, interpret tempo, produce a sustained tie, select instrument programs, or record/export audio. Automated checks verify oscillator frequencies, scheduling, and interaction triggers; they do not establish subjective piano quality or physical speaker output.

## Compatibility and limits

Version 1 migration preserves document/part/event IDs, notes, durations, velocities, and ticks on the original clef. Legacy piano parts receive deterministic, collision-free companion staff IDs. Version 2 migration preserves all existing music and adds an empty signature-change list. Existing C-major natural notes retain their sound. New saves use version 3, which older milestones cannot open; migration never overwrites files automatically. Unknown versions are rejected, and unknown UI fields are dropped.

Limits remain 16 parts, 64 measures, 4096 events per staff, 30–240 BPM, and 2 MB per file. Grand staves must be treble then bass. Tuplets, independent overlapping voices, double accidentals/dots, cross-staff notation, and marquee selection are not implemented.

## Future integration points

MIDI recording can quantize timestamped pitches into stable part/staff/event IDs and feed shared commands. Piano roll editing can consume the same absolute ticks and per-tone IDs. A future voice model can extend overlap rules without replacing chord identities. Full playback can merge staff events, resolve pitches, and join tie chains in a scheduler separate from audition. VST3 hosting belongs in an isolated native host; WAV/MP3 export should consume immutable score/instrument snapshots through typed IPC. No Milestone 3 engine is implemented here.

Electron sandboxing, context isolation, disabled Node integration, trusted-frame checks, denied navigation/new windows/permissions, and production CSP remain in place. Development binds to loopback.

## Validation

Model/audio/React tests cover migrations, resolved MIDI, every supported signature, accidentals, ties, chords, dots, safe meter changes, immutable history, dirty state after undo/redo, and pending-file-operation guards. Geometry tests cover line/space pitches, rhythmic snapping, and system packing. Browser tests inspect actual painted VexFlow paths and glyphs, actual Web Audio frequency scheduling, pointer dragging/cancellation, repeated-pitch suppression, signature synchronization, chord seconds, batch deletion, undo/redo, dots, and ties across system breaks. Desktop tests exercise native file round trips, isolation, legacy migration, scaled/scrolled insertion and dragging, and exact restoration of complex edits.

CI runs these checks on Ubuntu and Windows. OS dialog UI and physical audio output remain Windows 11 manual checks. There are no MIDI/VST3/audio-export or installer tests in this milestone.
