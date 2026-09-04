import assert from 'node:assert/strict'
import { test } from 'node:test'
import { pathToFileURL } from 'url'
import { isTrustedRendererUrl } from './renderer-origin'

const INDEX = '/opt/app/resources/renderer/index.html'
// Build the file URLs through pathToFileURL so the expected pathname matches
// the implementation's on every host (win32 resolves a POSIX-looking path
// against the current drive; a hardcoded file:/// string would not).
const INDEX_URL = pathToFileURL(INDEX).href
const EVIL_URL = pathToFileURL('/opt/app/resources/renderer/evil.html').href
const PASSWD_URL = pathToFileURL('/etc/passwd').href

test('dev: accepts the dev server origin (any path/hash)', () => {
  const opts = { devServerUrl: 'http://localhost:5173', rendererIndexPath: INDEX }
  assert.equal(isTrustedRendererUrl('http://localhost:5173/', opts), true)
  assert.equal(isTrustedRendererUrl('http://localhost:5173/#/chat', opts), true)
})

test('dev: rejects a look-alike host that only shares a prefix', () => {
  const opts = { devServerUrl: 'http://localhost:5173', rendererIndexPath: INDEX }
  assert.equal(isTrustedRendererUrl('http://localhost:5173.evil.com/', opts), false)
  assert.equal(isTrustedRendererUrl('http://evil.com/localhost:5173', opts), false)
})

test('prod: accepts the packaged index file, ignoring hash routing', () => {
  const opts = { rendererIndexPath: INDEX }
  assert.equal(isTrustedRendererUrl(INDEX_URL, opts), true)
  assert.equal(isTrustedRendererUrl(`${INDEX_URL}#/settings`, opts), true)
})

test('prod: rejects any other local file', () => {
  const opts = { rendererIndexPath: INDEX }
  assert.equal(isTrustedRendererUrl(EVIL_URL, opts), false)
  assert.equal(isTrustedRendererUrl(PASSWD_URL, opts), false)
})

test('rejects unparseable input', () => {
  assert.equal(isTrustedRendererUrl('not a url', { rendererIndexPath: INDEX }), false)
})
