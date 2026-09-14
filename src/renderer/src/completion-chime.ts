let audioContext: AudioContext | null = null
let lastPlayedAt = 0

const MIN_GAP_MS = 800

/**
 * Peak gain per tone of the C6 → E6 → G6 chime, at the reference volume.
 *
 * These were the original hard-coded values, and they were quiet — the chime was
 * easy to miss over music or a fan. They are now a *base* that the user's volume
 * setting scales (see `chimeGains`).
 */
export const CHIME_TONE_GAINS = [0.16, 0.18, 0.15] as const

/** The volume the default setting sits at, and what the base gains describe. */
export const CHIME_REFERENCE_VOLUME = 0.5

/** How much louder the reference volume is than the original hard-coded chime. */
const CHIME_REFERENCE_LIFT = 2.5

/**
 * Ceiling for a single tone. Overlapping tones sum, and Web Audio hard-clips past
 * 1.0 — which sounds like a crackle, not like volume. This keeps the loudest
 * setting loud without turning the chime into noise.
 */
const CHIME_MAX_GAIN = 0.8

export function chimeGains(volume: number): number[] {
  if (!Number.isFinite(volume) || volume <= 0) return CHIME_TONE_GAINS.map(() => 0)
  const scale = (Math.min(volume, 1) / CHIME_REFERENCE_VOLUME) * CHIME_REFERENCE_LIFT
  return CHIME_TONE_GAINS.map((base) => Math.min(base * scale, CHIME_MAX_GAIN))
}

function context(): AudioContext | null {
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Ctor) return null
  if (!audioContext || audioContext.state === 'closed') {
    audioContext = new Ctor()
  }
  return audioContext
}

function tone(ctx: AudioContext, frequency: number, start: number, duration: number, gain: number): void {
  if (gain <= 0) return
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

/**
 * Brighter C6 → E6 → G6 chime when a model turn finishes.
 *
 * `volume` comes from the `completionChimeVolume` setting (0-1).
 */
export function playCompletionChime(volume: number = CHIME_REFERENCE_VOLUME): void {
  const gains = chimeGains(volume)
  if (gains.every((gain) => gain <= 0)) return
  const now = Date.now()
  if (now - lastPlayedAt < MIN_GAP_MS) return
  lastPlayedAt = now
  const ctx = context()
  if (!ctx) return
  void ctx.resume().then(() => {
    const t = ctx.currentTime
    tone(ctx, 1046.5, t, 0.12, gains[0]!)
    tone(ctx, 1318.5, t + 0.09, 0.13, gains[1]!)
    tone(ctx, 1568.0, t + 0.18, 0.22, gains[2]!)
  }).catch(() => {
    // Autoplay may be blocked until a user gesture; ignore.
  })
}
