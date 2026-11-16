import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'
import { isWebviewAttachAllowed, isWebviewNavigationAllowed } from './webview-policy'
import { VESPI_BROWSER_PARTITION } from '../shared/vespi'

// The browser panel's partition is the ONLY guest allowed off the local disk.
// These cases exist to keep it that way: a future edit that widens the browser
// exemption, or narrows the preview one, fails here.
describe('isWebviewAttachAllowed — browser panel partition', () => {
  it('allows https pages', () => {
    assert.equal(isWebviewAttachAllowed(VESPI_BROWSER_PARTITION, 'https://example.com/'), true)
  })

  it('allows plain http pages', () => {
    assert.equal(isWebviewAttachAllowed(VESPI_BROWSER_PARTITION, 'http://example.com/'), true)
  })

  it('refuses file:// so the panel cannot read the local disk', () => {
    assert.equal(isWebviewAttachAllowed(VESPI_BROWSER_PARTITION, 'file:///C:/Windows/win.ini'), false)
  })

  it('refuses javascript: URLs', () => {
    assert.equal(isWebviewAttachAllowed(VESPI_BROWSER_PARTITION, 'javascript:alert(1)'), false)
  })

  it('refuses about: URLs', () => {
    assert.equal(isWebviewAttachAllowed(VESPI_BROWSER_PARTITION, 'about:blank'), false)
  })

  it('refuses malformed URLs', () => {
    assert.equal(isWebviewAttachAllowed(VESPI_BROWSER_PARTITION, 'not a url'), false)
  })
})

describe('isWebviewAttachAllowed — file preview partitions', () => {
  it('allows local file:// previews', () => {
    assert.equal(isWebviewAttachAllowed(undefined, 'file:///D:/proj/index.html'), true)
  })

  it('allows file:// previews on a named partition', () => {
    assert.equal(isWebviewAttachAllowed('preview', 'file:///D:/proj/readme.pdf'), true)
  })

  it('refuses remote pages on a preview partition', () => {
    assert.equal(isWebviewAttachAllowed('preview', 'https://example.com/'), false)
  })

  it('refuses remote pages when no partition is given', () => {
    assert.equal(isWebviewAttachAllowed(undefined, 'https://example.com/'), false)
  })

  it('refuses data: URLs on a preview partition', () => {
    assert.equal(isWebviewAttachAllowed('preview', 'data:text/html,<script>1</script>'), false)
  })

  it('does not treat a lookalike partition as the browser panel', () => {
    // Guards against a prefix/loose comparison sneaking in later.
    assert.equal(isWebviewAttachAllowed('persist:vespi-browser-2', 'https://example.com/'), false)
  })
})

describe('webview navigation keeps browser and preview policies separate', () => {
  it('lets an untrusted workspace browse web links and redirects', () => {
    assert.equal(isWebviewNavigationAllowed(true, 'https://example.com/next', false), true)
    assert.equal(isWebviewNavigationAllowed(true, 'http://localhost:3000/', false), true)
  })
  it('never lets the browser navigate to local or executable URLs', () => {
    for (const trusted of [true, false]) {
      for (const url of ['file:///C:/Windows/win.ini', 'javascript:alert(1)', 'data:text/html,test']) {
        assert.equal(isWebviewNavigationAllowed(true, url, trusted), false)
      }
    }
  })
  it('retains the workspace trust gate for file previews', () => {
    assert.equal(isWebviewNavigationAllowed(false, 'https://example.com/', false), false)
    assert.equal(isWebviewNavigationAllowed(false, 'https://example.com/', true), true)
    assert.equal(isWebviewNavigationAllowed(false, 'file:///D:/project/index.html', false), true)
  })
})
