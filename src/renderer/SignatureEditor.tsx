import { useEffect, useRef, useState } from 'react'
import type { Composition } from '../shared/composition'
import {
  KEY_SIGNATURES,
  TIME_SIGNATURES,
  signatureAt,
  timeName,
  type KeySignature,
  type TimeSignature,
} from '../shared/signatures'

export function SignatureEditor({
  score,
  measure,
  kind = 'both',
  onChange,
  onClose,
  disabled = false,
}: {
  score: Composition
  measure: number
  kind?: 'key' | 'time' | 'both'
  disabled?: boolean
  onChange(
    measure: number,
    change: { keySignature?: KeySignature; timeSignature?: TimeSignature },
  ): void
  onClose?: () => void
}) {
  const current = signatureAt(score, measure)
  const [key, setKey] = useState(current.keySignature)
  const [time, setTime] = useState(timeName(current.timeSignature))
  const [error, setError] = useState('')
  const ref = useRef<HTMLFormElement>(null)
  useEffect(() => {
    setKey(current.keySignature)
    setTime(timeName(current.timeSignature))
    setError('')
  }, [
    current.keySignature,
    current.timeSignature.numerator,
    current.timeSignature.denominator,
    measure,
  ])
  useEffect(() => {
    if (!onClose) return
    ref.current?.querySelector('select')?.focus({ preventScroll: true })
    const dismiss = (event: PointerEvent): void => {
      if (!ref.current?.contains(event.target as Node)) onClose()
    }
    const escape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        onClose()
      }
    }
    document.addEventListener('pointerdown', dismiss)
    ref.current?.addEventListener('keydown', escape)
    const element = ref.current
    return () => {
      document.removeEventListener('pointerdown', dismiss)
      element?.removeEventListener('keydown', escape)
    }
  }, [onClose])
  return (
    <form
      ref={ref}
      className="signature-editor"
      onSubmit={(event) => {
        event.preventDefault()
        if (disabled) return
        try {
          onChange(measure, {
            ...(kind === 'time' ? {} : { keySignature: key }),
            ...(kind === 'key'
              ? {}
              : { timeSignature: TIME_SIGNATURES.find((item) => timeName(item) === time)! }),
          })
          setError('')
          onClose?.()
        } catch (cause) {
          setError(cause instanceof Error ? cause.message : 'Unable to update signatures.')
        }
      }}
    >
      <p className="signature-caption">From measure {measure + 1}</p>
      {kind !== 'time' && (
        <label>
          Key signature
          <select
            disabled={disabled}
            value={key}
            onChange={(event) => setKey(event.target.value as KeySignature)}
          >
            {KEY_SIGNATURES.map(([value, name]) => (
              <option key={value} value={value}>
                {name}
              </option>
            ))}
          </select>
        </label>
      )}
      {kind !== 'key' && (
        <label>
          Time signature
          <select
            disabled={disabled}
            value={time}
            onChange={(event) => setTime(event.target.value)}
          >
            {TIME_SIGNATURES.map((item) => (
              <option key={timeName(item)}>{timeName(item)}</option>
            ))}
          </select>
        </label>
      )}
      <p className="help">
        Meter edits keep music in its measure and beat. Entries that would overflow must be
        shortened or moved first.
      </p>
      {error && (
        <p className="signature-error" role="alert">
          {error}
        </p>
      )}
      <div className="entry-actions">
        <button disabled={disabled} type="submit">
          Apply {kind === 'both' ? 'signatures' : `${kind} signature`}
        </button>
        {onClose && (
          <button type="button" onClick={onClose}>
            Cancel
          </button>
        )}
      </div>
    </form>
  )
}
