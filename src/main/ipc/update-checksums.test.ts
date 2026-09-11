import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'
import { createHash } from 'node:crypto'
import { parseSha256Sum, checksumUrlForAsset } from './update-handlers'

/** The two-spaces + filename line our release script writes. */
function textModeLine(hash: string, name: string): string {
  return `${hash}  ${name}`
}

describe('release checksum contract', () => {
  const installer = 'VesPi-Setup-1.0.23-win-x64.exe'
  const hash = 'a'.repeat(64)

  it('parses the text-mode line written by write-release-checksums.mjs', () => {
    assert.equal(parseSha256Sum(textModeLine(hash, installer), installer), hash)
  })

  it('parses sha256sum binary-mode lines (asterisk marker)', () => {
    assert.equal(parseSha256Sum(`${hash} *${installer}`, installer), hash)
  })

  it('parses a multi-line SHA256SUMS.txt containing other assets', () => {
    const text = [
      `${'b'.repeat(64)}  some-other-asset.zip`,
      textModeLine(hash, installer),
      `${'c'.repeat(64)}  LICENSE`,
    ].join('\n')
    assert.equal(parseSha256Sum(text, installer), hash)
  })

  it('handles CRLF line endings (file written on Windows)', () => {
    const text = `${'b'.repeat(64)}  other.exe\r\n${hash}  ${installer}\r\n`
    assert.equal(parseSha256Sum(text, installer), hash)
  })

  it('returns null when the requested asset is absent', () => {
    assert.equal(parseSha256Sum(textModeLine(hash, 'Something-Else.exe'), installer), null)
  })

  it('lowercases an uppercase digest so it matches our hex hash', () => {
    assert.equal(parseSha256Sum(textModeLine('A'.repeat(64), installer), installer), 'a'.repeat(64))
  })

  it('resolves the checksum URL to a sibling asset of the installer', () => {
    const url = 'https://github.com/esseener/VesPi/releases/download/v1.0.23/VesPi-Setup-1.0.23-win-x64.exe'
    assert.equal(
      checksumUrlForAsset(url),
      'https://github.com/esseener/VesPi/releases/download/v1.0.23/SHA256SUMS.txt',
    )
  })

  it('drops query and hash when resolving the checksum URL', () => {
    const url = 'https://github.com/o/r/releases/download/v1/x.exe?token=abc#frag'
    assert.equal(checksumUrlForAsset(url), 'https://github.com/o/r/releases/download/v1/SHA256SUMS.txt')
  })

  it('matches the digest algorithm the updater compares against', () => {
    // Guards the shared assumption: the release script and the updater both
    // use SHA-256 over the raw file bytes.
    const digest = createHash('sha256').update('payload').digest('hex')
    assert.equal(parseSha256Sum(`${digest}  f.bin`, 'f.bin'), digest)
  })
})
