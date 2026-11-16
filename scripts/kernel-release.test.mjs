import assert from 'node:assert/strict'
import { test } from 'node:test'
import { latestKernelRelease } from './kernel-release.mjs'

test('uses the API release when available', async () => {
  const release = { tag_name: 'v18.20.2', assets: [] }
  assert.deepEqual(await latestKernelRelease('can1357/oh-my-pi', async () => Response.json(release)), release)
})

test('rate limit fallback accepts only the same repository stable release redirect', async () => {
  const calls = []
  const release = await latestKernelRelease('can1357/oh-my-pi', async (url, options) => {
    calls.push({ url, options })
    return calls.length === 1 ? new Response('', { status: 403 }) : new Response(null, {
      status: 302, headers: { location: 'https://github.com/can1357/oh-my-pi/releases/tag/v18.20.2' },
    })
  })
  assert.equal(release.tag_name, 'v18.20.2')
  assert.equal(calls[1].options.headers, undefined)
  assert.equal(calls[1].options.redirect, 'manual')
  assert.match(release.assets[0].browser_download_url, /v18\.20\.2\/SHA256SUMS.txt$/)
})

test('unrelated redirects and network errors remain unknown, never current', async () => {
  for (const location of ['https://example.com/releases/tag/v1.0.0', 'https://github.com/can1357/oh-my-pi/releases/tag/v1.0.0-beta']) {
    let count = 0
    await assert.rejects(latestKernelRelease('can1357/oh-my-pi', async () => ++count === 1
      ? new Response('', { status: 429 })
      : new Response(null, { status: 302, headers: { location } })))
  }
  await assert.rejects(latestKernelRelease('can1357/oh-my-pi', async () => new Response('', { status: 500 })), /500/)
})
