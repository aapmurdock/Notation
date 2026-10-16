# Notation architecture — Milestone 2A

## Process and data boundaries

```text
Electron main                       Sandboxed React renderer
  native dialogs                      document + transient cursor/selection
  validated score file I/O             shared editing commands
  window lifecycle                    system engraving + geometry hit testing
          ↕ narrow typed IPC ↔ context-isolated preload
                    ↕
           shared composition model
```

- `src/shared/composition.ts` owns serializable musical data, constructors, migration, runtime validation, and immutable insert/delete commands. It imports neither React, Electron, nor VexFlow.
- A composition has instrument `tracks` (parts). A part owns one or two `staves`, each with a stable ID, clef, and independent event list. A piano is one instrument with treble and bass staves, not two unrelated instrument tracks. Future playback can flatten a part's staff events into one instrument stream.
- `src/main/` owns native dialogs and filesystem access. Paths stay in main. Saves validate again, write a sibling temporary file, then rename; validation or a failed write preserves the previous document. This is partial-write protection, not a guarantee against every filesystem/power failure.
- `src/preload/` exposes only typed `openScore`, `saveScore`, and `setDocumentDirty` capabilities, without raw IPC, Node, shells, or arbitrary filesystem paths.
- `src/renderer/App.tsx` owns the document plus transient entry settings, cursor, active staff, selected event ID, dirty flag, and file-operation status. Cursor/selection/preview never enter the saved model. Native file operations disable editing until they finish.
- `src/renderer/NotationToolbar.tsx` shares duration, rest, and accidental controls between the persistent toolbar and the contextual popover.

## Continuous engraving

`src/renderer/score/engrave.ts` draws one SVG containing complete horizontal systems. It does not arrange separate measure SVGs with CSS.

1. Derive complete bar voices for every staff with `measureEvents`. Gaps become display-only rests; stored events are unchanged.
2. Use VexFlow `Formatter.preCalculateMinTotalWidth` across all staff voices to estimate a minimum width for each measure, taking the densest rhythm/accidentals into account.
3. `planSystems` packs consecutive measures into available width, reserves space for clefs/time signatures, and distributes remaining width. All parts use the same columns and system breaks. A single bar too dense to fit retains its minimum width and can scroll horizontally.
4. Draw contiguous VexFlow `Stave` segments with identical line y-coordinates and exactly shared endpoints. Clefs repeat only at system starts; meter appears at the score start. `Stave.formatBegModifiers` aligns clefs/meter and note starts across parts.
5. Join voices within each staff separately, then format all voices of a measure together. The shared tick contexts align simultaneous notes vertically, including unequal rhythms in different piano staves. Center whole-measure implicit rests without using their centered x positions as rhythmic anchors.
6. Draw standard VexFlow barlines and `StaveConnector` braces at each grand staff's system start, and connect piano barlines through both staves. Parts share columns but retain independent staff rows.
7. Use rendered note positions and bounds to produce transient hit-test geometry. Vertical spacing includes the score's ledger-note extents. Bravura/Academico fonts are bundled and loaded before calculating spacing; layout requires no font CDN.

`ScoreView.tsx` observes available width with `ResizeObserver` and redraws systems when width or musical data changes. Selection, toolbar changes, and pointer movement update the interaction layer without re-engraving the score. The interaction SVG remains mounted during edits so repeated keyboard entry retains focus. Rendering failures are visible and never mutate the composition.

## Interaction and musical time

`geometry.ts` is the pure adapter between staff coordinates and musical positions. The bottom treble line is E4; the bottom bass line is G2. Each half staff space maps to one diatonic pitch. Screen coordinates are transformed through the SVG's actual matrix, so scrolling, resizing, and display scaling use the same coordinate system as engraving. Pointer coordinates are resolved before moving focus, and programmatic focus uses `preventScroll`: otherwise focusing a large SVG can scroll the viewport during pointerdown and invalidate the event's original client coordinates.

Mouse x positions snap to a duration-based grid using actual formatter tick anchors. Unwritten positions interpolate between neighboring anchors. Hover displays a pending note/rest and its pitch/beat. Clicking writes into the target staff; clicking an existing notehead/rest selects it. The caret advances by duration and skips occupied time, continuing into the next measure. Each operation specifies part ID, staff ID, and absolute tick position. Entries cannot overlap another event in the same staff or cross a barline; simultaneous events in different staves are valid.

Keyboard entry uses the same insertion command. Letter keys enter pitches; duration shortcuts change future entries; arrows move the pending pitch or tick. Shortcuts are scoped to the score workspace and ignore metadata inputs. Selection/deletion does not retime later music. The popover supports keyboard focus, Escape dismissal, outside-click dismissal, and focus return to the score. SVG hit targets expose measure/note/rest names and selected state to assistive technology.

## File format and compatibility

New saves use UTF-8 JSON with `.notation` extension and `schemaVersion: 2`:

| Field | Representation |
| --- | --- |
| Identity | Unique IDs for document, instrument parts, staves, and events |
| Time | Absolute integer `startTick`, 480 ticks per quarter (`PPQ`) |
| Duration | `durationTicks`: 1920, 960, 480, 240, 120 |
| Pitch | Diatonic step, octave, accidental; preserves spelling and converts to MIDI |
| Dynamics | Velocity 1–127, stored but not played |
| Instrument part | Name, General MIDI program (zero-based), one or two staves |
| Staff | Stable ID, treble/bass clef, sorted non-overlapping events |
| Meter/key | 3/4 or 4/4, C major; UI creates 4/4 |
| Rests | Explicit entered events; implicit engraving rests are not persisted |

Version 1 migration preserves original document/part/event IDs, pitches, velocities, durations, and tick positions on the original clef. Legacy General MIDI program 0 piano parts receive an empty companion staff; other parts stay single-staff. Added staff IDs are deterministic and avoid collisions with existing IDs. Migration does not overwrite disk files. A subsequent explicit save writes version 2; the Milestone 1 app cannot open that new format. Unknown versions are rejected.

Limits remain 16 parts, 64 measures, 4096 events per staff, 30–240 BPM, and 2 MB per file. Two-staff parts must be ordered treble then bass. Each staff currently holds one monophonic voice. Chords, multiple voices in one staff, cross-staff notation, ties, tuplets, and dotted durations remain out of scope.

## Future integration points

MIDI recording can convert device timestamps into ticks and quantize into the shared model through an explicit service/IPC boundary. A piano roll can edit the same part/staff/event IDs without depending on VexFlow. Add command history when implementing undo/redo. Future playback schedules a part's merged staff events by ticks/tempo; an isolated native VST3 host belongs outside the renderer. Offline WAV/MP3 export should consume immutable score/instrument snapshots and report progress via typed IPC. None of these engines or the remainder of Milestone 2 is implemented here.

The Electron window keeps sandboxing and context isolation enabled with Node integration disabled. Main handlers check the trusted application frame and validate score data. Permissions, new windows, and renderer navigation remain denied. Production CSP permits bundled scripts/fonts; only development relaxes inline script policy for Vite Fast Refresh. Development binds to loopback.

## Validation

Model tests cover independent staff entry, non-overlap within a staff, bar/score boundaries, migration, and preservation of timing/identity. Geometry tests check line/space pitches in both clefs, tick snapping, and contiguous system packing. Browser tests inspect the actual VexFlow staff paths for continuity/alignment, check braces and responsive wrapping, exercise previews/direct entry/deletion, and verify keyboard duration/advancement behavior. Electron tests save/reopen independently entered grand staff music, migrate a version 1 file, reject unsupported input without losing the document, and retain the isolated bridge checks.

CI runs build/tests on Ubuntu and Windows. Local cloud validation uses Linux; it does not establish a Windows CI pass or replace manual Windows 11 evaluation. Native file dialog destinations are substituted in automated tests; the OS dialog UI itself is a manual check. No audio/MIDI hardware tests or installer packaging is included.
