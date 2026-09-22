import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, writeFile } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { BINARY_SNIFF_BYTES, imageMimeTypeForPath, looksBinary, readAttachment } from './attachment-reader'

// ─── Extension -> MIME mapping ──────────────────────────────────────────────

test('imageMimeTypeForPath maps supported image extensions case-insensitively', () => {
  assert.equal(imageMimeTypeForPath('/a/b/shot.png'), 'image/png')
  assert.equal(imageMimeTypeForPath('/a/b/shot.JPG'), 'image/jpeg')
  assert.equal(imageMimeTypeForPath('photo.jpeg'), 'image/jpeg')
  assert.equal(imageMimeTypeForPath('anim.GIF'), 'image/gif')
  assert.equal(imageMimeTypeForPath('pic.webp'), 'image/webp')
})

test('imageMimeTypeForPath returns null for non-image and extensionless paths', () => {
  assert.equal(imageMimeTypeForPath('notes.txt'), null)
  assert.equal(imageMimeTypeForPath('archive.tar.gz'), null)
  assert.equal(imageMimeTypeForPath('Makefile'), null)
  assert.equal(imageMimeTypeForPath('image.svg'), null) // not in Pi's supported set
})

// ─── readAttachment ─────────────────────────────────────────────────────────

test('readAttachment returns base64 image payload for an image file', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pi-attach-img-'))
  const file = join(dir, 'pixel.png')
  const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  await writeFile(file, bytes)

  const result = await readAttachment(file)
  assert.equal(result.kind, 'image')
  if (result.kind !== 'image') return
  assert.equal(result.name, 'pixel.png')
  assert.equal(result.image.type, 'image')
  assert.equal(result.image.mimeType, 'image/png')
  assert.equal(result.image.data, bytes.toString('base64'))
})

test('readAttachment returns UTF-8 text for a non-image file', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pi-attach-txt-'))
  const file = join(dir, 'notes.md')
  await writeFile(file, '# Hello\nworld')

  const result = await readAttachment(file)
  assert.equal(result.kind, 'text')
  if (result.kind !== 'text') return
  assert.equal(result.name, 'notes.md')
  assert.equal(result.content, '# Hello\nworld')
})

test('readAttachment rejects a missing path', async () => {
  await assert.rejects(() => readAttachment('/no/such/file-xyz.png'))
})

test('a binary file comes back as a path reference, not as mojibake', async () => {
  // A PDF/ZIP/executable has no text in it. Decoding one as UTF-8 used to send a
  // stream of replacement characters into the prompt — invisible once the
  // transcript started collapsing attachments into cards — and refusing it
  // outright threw away work the agent could do with the path.
  const dir = await mkdtemp(join(tmpdir(), 'pi-attach-bin-'))
  const file = join(dir, 'archive.zip')
  await writeFile(file, Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00, 0x08, 0x00, 0xff, 0xfe]))

  const result = await readAttachment(file)

  assert.equal(result.kind, 'reference')
  if (result.kind !== 'reference') return
  assert.equal(result.name, 'archive.zip')
  assert.equal(result.reason, 'binary')
  assert.ok(result.sizeBytes > 0, 'the size is what the card shows instead of a line count')
})

test('a file too large to inline is referenced rather than refused', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pi-attach-big-'))
  const file = join(dir, 'huge.log')
  // Sparse-ish: only the length matters, and `stat` is what the reader checks.
  await writeFile(file, Buffer.alloc(26 * 1024 * 1024, 0x61))

  const result = await readAttachment(file)

  assert.equal(result.kind, 'reference')
  if (result.kind !== 'reference') return
  assert.equal(result.reason, 'too-large')
})

test('a NUL byte is only a binary signal inside the sniffed head', () => {
  // Binary formats declare themselves in the first bytes; a long text file with
  // a stray NUL far past that is still text as far as a prompt is concerned.
  assert.equal(looksBinary(Buffer.from('plain text, no NULs')), false)
  assert.equal(looksBinary(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00])), true)
  const far = Buffer.concat([Buffer.from('x'.repeat(BINARY_SNIFF_BYTES)), Buffer.from([0])])
  assert.equal(looksBinary(far), false)
})
