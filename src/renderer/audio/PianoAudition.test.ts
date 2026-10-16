import { describe, expect, it, vi } from 'vitest'
import { PianoAudition } from './PianoAudition'

function audio(state = 'running') {
  const oscillators: {
    frequency: { setValueAtTime: ReturnType<typeof vi.fn> }
    stop: ReturnType<typeof vi.fn>
  }[] = []
  const context = {
    state,
    currentTime: 4,
    destination: {},
    createPeriodicWave: vi.fn(),
    resume: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    createOscillator: () => {
      const oscillator = {
        frequency: { setValueAtTime: vi.fn() },
        setPeriodicWave: vi.fn(),
        connect: vi.fn(),
        disconnect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
        onended: null,
      }
      oscillators.push(oscillator)
      return oscillator
    },
    createGain: () => ({
      gain: {
        setValueAtTime: vi.fn(),
        cancelScheduledValues: vi.fn(),
        setTargetAtTime: vi.fn(),
        exponentialRampToValueAtTime: vi.fn(),
      },
      connect: vi.fn(),
      disconnect: vi.fn(),
    }),
  }
  return { context: context as unknown as AudioContext, oscillators }
}

describe('short piano audition', () => {
  it('schedules MIDI pitch as the correct oscillator frequency and releases older previews', () => {
    const { context, oscillators } = audio()
    const piano = new PianoAudition(() => context)
    piano.play(69)
    expect(oscillators[0]!.frequency.setValueAtTime).toHaveBeenCalledWith(440, 4)
    piano.play(60)
    expect(oscillators[1]!.frequency.setValueAtTime.mock.calls[0]![0]).toBeCloseTo(261.625565)
    expect(oscillators[0]!.stop).toHaveBeenCalledWith(4.018)
    for (let pitch = 61; pitch < 80; pitch++) piano.play(pitch)
    expect(oscillators[0]!.stop).toHaveBeenCalledWith()
    piano.dispose()
    expect(context.close).toHaveBeenCalledOnce()
    piano.play(60)
    expect(oscillators).toHaveLength(21)
  })
  it('plays only the latest request after asynchronous audio activation; stop cancels pending audio', async () => {
    const { context, oscillators } = audio('suspended')
    const piano = new PianoAudition(() => context)
    piano.play(60)
    piano.play(64)
    piano.play(67)
    await Promise.resolve()
    expect(oscillators).toHaveLength(1)
    expect(oscillators[0]!.frequency.setValueAtTime.mock.calls[0]![0]).toBeCloseTo(391.995436)
    piano.play(72)
    piano.stop()
    await Promise.resolve()
    expect(oscillators).toHaveLength(1)
    piano.dispose()
  })
  it('reports unavailable audio without breaking document editing and ignores invalid MIDI', () => {
    const unavailable = vi.fn()
    const piano = new PianoAudition(() => {
      throw new Error('No audio device')
    }, unavailable)
    piano.play(-1)
    piano.play(128)
    piano.play(60.2)
    expect(unavailable).not.toHaveBeenCalled()
    expect(() => piano.play(60)).not.toThrow()
    expect(unavailable).toHaveBeenCalledOnce()
  })
})
