import type { DurationTicks, Pitch } from '../shared/composition'

export interface EntrySettings {
  duration: DurationTicks
  rest: boolean
  accidental: Pitch['accidental']
  mode: 'write' | 'select'
}
export const durationChoices = [
  { ticks: 1920, name: 'Whole', key: '1' },
  { ticks: 960, name: 'Half', key: '2' },
  { ticks: 480, name: 'Quarter', key: '3' },
  { ticks: 240, name: 'Eighth', key: '4' },
  { ticks: 120, name: 'Sixteenth', key: '5' },
] as const

function DurationIcon({ ticks }: { ticks: DurationTicks }) {
  return (
    <svg viewBox="0 0 24 26" width="20" height="25" aria-hidden="true">
      <ellipse
        cx="9"
        cy="19"
        rx="5"
        ry="3.4"
        transform="rotate(-18 9 19)"
        fill={ticks >= 960 ? 'none' : 'currentColor'}
        stroke="currentColor"
        strokeWidth="1.8"
      />
      {ticks < 1920 && <path d="M13 18V3" stroke="currentColor" strokeWidth="1.6" />}
      {ticks <= 240 && <path d="M13 3Q23 8 17 14Q19 8 13 7" fill="currentColor" />}
      {ticks === 120 && <path d="M13 8Q23 13 17 19Q19 13 13 12" fill="currentColor" />}
    </svg>
  )
}

export function NotationToolbar({
  settings,
  onChange,
  disabled = false,
  compact = false,
}: {
  settings: EntrySettings
  onChange(settings: EntrySettings): void
  disabled?: boolean
  compact?: boolean
}) {
  return (
    <div
      className={`notation-toolbar ${compact ? 'compact' : ''}`}
      role="toolbar"
      aria-label={compact ? 'Measure note entry' : 'Notation toolbar'}
    >
      {!compact && (
        <div className="tool-group">
          <button
            aria-pressed={settings.mode === 'write'}
            aria-label="Write notes"
            disabled={disabled}
            onClick={() => onChange({ ...settings, mode: 'write' })}
          >
            Write
          </button>
          <button
            aria-pressed={settings.mode === 'select'}
            aria-label="Select entries"
            disabled={disabled}
            onClick={() => onChange({ ...settings, mode: 'select' })}
          >
            Select
          </button>
        </div>
      )}
      <div className="tool-group" aria-label="Note durations">
        {durationChoices.map(({ ticks, name, key }) => (
          <button
            key={ticks}
            disabled={disabled}
            aria-label={`${name} duration`}
            aria-pressed={settings.duration === ticks}
            title={`${name} (${key})`}
            onClick={() => onChange({ ...settings, duration: ticks, mode: 'write' })}
          >
            <DurationIcon ticks={ticks} />
            <small>{key}</small>
          </button>
        ))}
      </div>
      <div className="tool-group">
        <button
          aria-label="Rest entry"
          title="Toggle rests (R); insert rest (0)"
          disabled={disabled}
          aria-pressed={settings.rest}
          onClick={() => onChange({ ...settings, rest: !settings.rest, mode: 'write' })}
        >
          Rest
        </button>
        {(['', '#', 'b'] as const).map((accidental) => (
          <button
            key={accidental}
            disabled={disabled}
            aria-label={`${accidental === '#' ? 'Sharp' : accidental === 'b' ? 'Flat' : 'Natural'} accidental`}
            aria-pressed={settings.accidental === accidental}
            onClick={() => onChange({ ...settings, accidental })}
          >
            {accidental === '#' ? '♯' : accidental === 'b' ? '♭' : '♮'}
          </button>
        ))}
      </div>
    </div>
  )
}
