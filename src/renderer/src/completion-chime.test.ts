import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'
import { CHIME_REFERENCE_VOLUME, CHIME_TONE_GAINS, chimeGains } from './completion-chime'

const originalPeak = Math.max(...CHIME_TONE_GAINS)

describe('chimeGains', () => {
  it('is silent at zero and below', () => {
    assert.deepEqual(chimeGains(0), [0, 0, 0])
    assert.deepEqual(chimeGains(-1), [0, 0, 0])
  })

  it('is silent for values that are not a number', () => {
    assert.deepEqual(chimeGains(Number.NaN), [0, 0, 0])
    assert.deepEqual(chimeGains(Number.POSITIVE_INFINITY), [0, 0, 0])
  })

  // The complaint this exists for: the original chime was hard-coded quiet, so
  // the default setting has to be audibly louder than it was.
  it('is louder than the original hard-coded chime at the default volume', () => {
    const peak = Math.max(...chimeGains(CHIME_REFERENCE_VOLUME))
    assert.ok(peak > originalPeak * 2, `expected > ${originalPeak * 2}, got ${peak}`)
  })

  it('keeps the relative shape of the three tones', () => {
    const gains = chimeGains(CHIME_REFERENCE_VOLUME)
    const ratio = (index: number): number => gains[index]! / gains[0]!
    assert.ok(Math.abs(ratio(1) - CHIME_TONE_GAINS[1] / CHIME_TONE_GAINS[0]) < 1e-9)
    assert.ok(Math.abs(ratio(2) - CHIME_TONE_GAINS[2] / CHIME_TONE_GAINS[0]) < 1e-9)
  })

  it('rises with the volume', () => {
    const low = Math.max(...chimeGains(0.25))
    const mid = Math.max(...chimeGains(0.5))
    const high = Math.max(...chimeGains(0.75))
    assert.ok(low < mid, `${low} < ${mid}`)
    assert.ok(mid < high, `${mid} < ${high}`)
  })

  // Web Audio hard-clips past 1.0; a clipped chime is a crackle, not a louder one.
  it('never exceeds the ceiling, even above full volume', () => {
    for (const volume of [0.8, 1, 1.5, 100]) {
      const peak = Math.max(...chimeGains(volume))
      assert.ok(peak <= 0.8, `volume ${volume} produced ${peak}`)
    }
  })

  it('returns one gain per tone', () => {
    assert.equal(chimeGains(0.5).length, CHIME_TONE_GAINS.length)
  })
})
