# Milestone 1 architecture

## Process boundaries

```text
Electron main                     Sandboxed React renderer
  native dialogs                    workspace + local selection state
  validated score file I/O          editing commands from shared model
  window lifecycle                  VexFlow SVG engraving adapter
          ↕ narrow typed IPC ↔ context-isolated preload
                  ↕
         shared composition model
```

- `src/shared/composition.ts` contains the canonical model, constructors, editing functions, serialization, and runtime validation. It has no UI or Electron imports. Editing produces new objects; imported documents are reconstructed from validated fields.
- `src/main/` owns OS capabilities. File paths stay in the main process. The user chooses each destination through a native dialog. Saves use a sibling temporary file and rename; validation or a failed write leaves the previous file intact. This protects against partial writes, not every possible power-loss/filesystem failure.
- `src/preload/` exposes only `openScore`, `saveScore`, and `setDocumentDirty` through a typed `DesktopApi`. It does not expose raw IPC, Node, a shell, arbitrary paths, or the filesystem.
- `src/renderer/App.tsx` owns the current document and transient editor state: selected part/measure, note-entry options, dirty flag, and file-operation status. Selection and generated engraving data are never persisted. File operations disable editing until completion. Future command history/state management can replace this component's state without changing the file or engraving interfaces.
- `src/renderer/score/measure.ts` derives a full bar from stored events and fills gaps with display-only rests.
- `src/renderer/score/ScoreView.tsx` translates events into strict VexFlow voices, calculates accidentals/beams, and renders SVG measures. Bravura and Academico fonts are embedded in the dependency bundle and loaded before layout. Rendering errors are visible and never modify the document.
- `electron.vite.config.ts` builds main, CommonJS sandbox-compatible preload, and React renderer separately. `vite.web.config.ts` is only a browser test harness.

## Score format

Documents are UTF-8 JSON with the `.notation` extension. `schemaVersion: 1` is mandatory. Unknown versions are rejected rather than guessed; introduce explicit migrations when the schema changes.

| Data | Representation |
| --- | --- |
| Identity | Stable unique string IDs for score, tracks, and events |
| Musical time | Integer ticks, 480 ticks per quarter note (`PPQ`) |
| Position | `startTick` from the beginning of the composition |
| Duration | `durationTicks`: 1920, 960, 480, 240, or 120 in this milestone |
| Pitch | Diatonic `step`, `octave`, and `accidental`; convertible to MIDI while preserving spelling |
| Dynamics | Note velocity, integer 1–127; not played back yet |
| Instrument | Discriminated `general-midi` descriptor with a zero-based program number |
| Meter and key | 3/4 or 4/4, C major; the UI initially creates 4/4 |
| Part | Name, treble/bass clef, instrument descriptor, sorted event list |
| Rests | Explicit events when entered by the user; implicit rests are derived for engraving |

Every event must align to a sixteenth-note grid and fit within a bar. Each part currently holds a single monophonic voice; overlapping notes and cross-bar events are rejected with an explanatory error. Score limits are 16 parts, 64 measures, 4096 events per part, 120-character titles, 60-character part names, 30–240 BPM, and 2 MB per file. The app is not a general MIDI or MusicXML importer.

## Extension points

| Future feature | Intended integration |
| --- | --- |
| MIDI keyboard recording | A main-process MIDI service captures device events and timestamps behind explicit IPC capabilities. Convert timestamps to ticks and quantize to the score grid; preserve spelling decisions separately. Add a recording/take schema before supporting unquantized input. |
| Piano roll | A second renderer adapter edits the same track IDs, tick positions, pitches, velocities, and durations. Add a shared command/history layer for undo/redo across views. |
| Chords and multiple voices | Version the schema with voice/chord grouping and expand validation and the VexFlow adapter together. Avoid encoding musical state in VexFlow classes. |
| Playback | A transport service schedules immutable score snapshots by tick/tempo. Keep timing and audio work outside React rendering. General MIDI instrument metadata is already stored without pretending an audio engine exists. |
| VST3 | Add a discriminated plugin instrument descriptor and an isolated native host/utility process. Handle scanning, device access, plugin crashes, and audio buffers there. Do not load native plugin code in the renderer. |
| WAV/MP3 export | An offline rendering service consumes a score snapshot and instrument configuration, reports progress/cancellation through typed IPC, and writes the chosen destination in the main process. Select and license an encoder when implementing MP3. |

These are integration directions, not implemented engine APIs. No recording, transport, audio device, plugin, or encoder dependency is installed in Milestone 1.

## Desktop security and lifecycle

The window enables sandboxing and context isolation and disables Node integration. Main handlers accept requests only from the application's main frame, validate score data again before saving, and do not accept renderer-supplied file paths. Permissions and new windows are denied. In-app navigation is prevented. The production Content Security Policy permits bundled scripts and embedded fonts; only the development server relaxes inline scripts for React Fast Refresh. Development binds to loopback on a fixed port.

The main process tracks document dirtiness via the narrow preload API and prompts before closing an unsaved document. The renderer confirms before New, Open, or Load example can replace edits. Scores are not auto-saved; users must save explicitly. Saved documents do not include secrets, absolute file paths, view state, or generated rest events.

## Validation

- Model tests cover identity, file round trips, immutable edits, MIDI pitch conversion, input rejection, overlap, bar boundaries, and 3/4 durations.
- Adapter tests cover empty bars, gaps, rhythmic alignment, explicit rests, and bar selection.
- File integration tests use real temporary files to cover save/reopen/replacement and malformed/oversized input.
- React tests cover metadata, note entry, full bars, unsaved-change cancellation, bridge responses, and browser restrictions.
- Chromium tests render real VexFlow SVGs with external requests blocked, then edit measures and add a bass-clef part.
- Electron tests launch the built application, check the isolated renderer API, save and reopen a real file via substituted dialog destinations, and verify invalid files leave the score intact.

The local cloud environment is Linux. Windows behavior is exercised by the checked-in Windows CI job when it runs; a local Linux pass does not establish a Windows CI pass. Installer packaging, code signing, and physical MIDI/audio hardware tests are outside this milestone.
