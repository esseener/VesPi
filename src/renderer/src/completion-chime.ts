let audioContext: AudioContext | null = null
let lastPlayedAt = 0

const MIN_GAP_MS = 800

function context(): AudioContext | null {
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Ctor) return null
  if (!audioContext || audioContext.state === 'closed') {
    audioContext = new Ctor()
  }
  return audioContext
}

function tone(ctx: AudioContext, frequency: number, start: number, duration: number, gain: number): void {
  const oscillator = ctx.createOscillator()
  const amp = ctx.createGain()
  oscillator.type = 'triangle'
  oscillator.frequency.setValueAtTime(frequency, start)
  amp.gain.setValueAtTime(0.0001, start)
  amp.gain.exponentialRampToValueAtTime(gain, start + 0.012)
  amp.gain.exponentialRampToValueAtTime(0.0001, start + duration)
  oscillator.connect(amp)
  amp.connect(ctx.destination)
  oscillator.start(start)
  oscillator.stop(start + duration + 0.02)
}

/** Brighter C6 → E6 → G6 chime when a model turn finishes. */
export function playCompletionChime(): void {
  const now = Date.now()
  if (now - lastPlayedAt < MIN_GAP_MS) return
  lastPlayedAt = now
  const ctx = context()
  if (!ctx) return
  void ctx.resume().then(() => {
    const t = ctx.currentTime
    tone(ctx, 1046.5, t, 0.12, 0.16)
    tone(ctx, 1318.5, t + 0.09, 0.13, 0.18)
    tone(ctx, 1568.0, t + 0.18, 0.22, 0.15)
  }).catch(() => {
    // Autoplay may be blocked until a user gesture; ignore.
  })
}
