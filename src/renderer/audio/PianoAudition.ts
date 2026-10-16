/** Short, local piano-like previews. No playback transport, samples, or audio IPC. */
export class PianoAudition {
  private context?: AudioContext
  private voices: { oscillator: OscillatorNode; gain: GainNode }[] = []
  private request = 0
  private disposed = false

  constructor(
    private readonly createContext: () => AudioContext = () => new AudioContext(),
    private readonly unavailable: () => void = () => {},
  ) {}

  play(midi: number): void {
    if (this.disposed || !Number.isInteger(midi) || midi < 0 || midi > 127) return
    const request = ++this.request
    try {
      const context = (this.context ??= this.createContext())
      const sound = (): void => {
        if (this.disposed || request !== this.request) return
        try {
          this.sound(context, midi)
        } catch {
          this.unavailable()
        }
      }
      if (context.state === 'suspended') void context.resume().then(sound, this.unavailable)
      else sound()
    } catch {
      this.unavailable()
    }
  }

  private sound(context: AudioContext, midi: number): void {
    const now = context.currentTime
    // Release the previous preview quickly; keep at most two oscillators alive.
    for (const voice of this.voices) {
      voice.gain.gain.cancelScheduledValues(now)
      voice.gain.gain.setTargetAtTime(0.0001, now, 0.004)
      voice.oscillator.stop(now + 0.018)
    }
    while (this.voices.length >= 2) {
      const voice = this.voices.shift()!
      voice.oscillator.stop()
      voice.oscillator.disconnect()
      voice.gain.disconnect()
    }
    const oscillator = context.createOscillator()
    const gain = context.createGain()
    // Decaying harmonics give a small built-in piano sound without downloads.
    oscillator.setPeriodicWave(
      context.createPeriodicWave(new Float32Array(5), new Float32Array([0, 1, 0.36, 0.16, 0.06])),
    )
    oscillator.frequency.setValueAtTime(440 * 2 ** ((midi - 69) / 12), now)
    gain.gain.setValueAtTime(0.0001, now)
    gain.gain.exponentialRampToValueAtTime(0.18, now + 0.005)
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.32)
    oscillator.connect(gain)
    gain.connect(context.destination)
    const voice = { oscillator, gain }
    this.voices.push(voice)
    oscillator.onended = () => {
      this.voices = this.voices.filter((item) => item !== voice)
      oscillator.disconnect()
      gain.disconnect()
    }
    oscillator.start(now)
    oscillator.stop(now + 0.34)
  }

  stop(): void {
    ++this.request
    for (const voice of this.voices) {
      voice.oscillator.stop()
      voice.oscillator.disconnect()
      voice.gain.disconnect()
    }
    this.voices = []
  }

  dispose(): void {
    this.disposed = true
    this.stop()
    void this.context?.close().catch(() => {})
  }
}
