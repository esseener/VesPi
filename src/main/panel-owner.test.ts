import assert from 'node:assert/strict'
import { PANEL_OWNER_TTL_MS, createPanelOwnerTracker, isPanelToolName } from './panel-owner'

// The eight operations the panel MCP server exposes, named the way the kernel
// may hand them over: bare, or namespaced by the MCP server it came from.
for (const op of ['open', 'state', 'reload', 'back', 'forward', 'eval', 'text', 'screenshot']) {
  assert.equal(isPanelToolName(`panel_${op}`), true, `panel_${op}`)
  assert.equal(isPanelToolName(`mcp__vespi-panel__panel_${op}`), true, `mcp__vespi-panel__panel_${op}`)
  assert.equal(isPanelToolName(`vespi-panel.panel_${op}`), true, `vespi-panel.panel_${op}`)
  assert.equal(isPanelToolName(`PANEL_${op.toUpperCase()}`), true, `PANEL_${op.toUpperCase()}`)
}

// Names that merely contain the letters must not be attributed to the panel.
assert.equal(isPanelToolName('panel_opens'), false)
assert.equal(isPanelToolName('panel_opened_file'), false)
assert.equal(isPanelToolName('show_panel'), false)
assert.equal(isPanelToolName('browser_navigate'), false)
assert.equal(isPanelToolName('panel_'), false)
assert.equal(isPanelToolName(''), false)

let clock = 1_000
const tracker = createPanelOwnerTracker(PANEL_OWNER_TTL_MS, () => clock)

assert.equal(tracker.current(), null)

tracker.note('ws-b')
assert.equal(tracker.current(), 'ws-b')

// A later call from another workspace takes the record: each panel operation
// starts its own tool call, so the most recent one is the one driving the pipe.
clock += 5_000
tracker.note('ws-a')
assert.equal(tracker.current(), 'ws-a')

// Within the window the record stands, so the request that arrives right after
// the tool call is attributed to it.
clock += PANEL_OWNER_TTL_MS - 1
assert.equal(tracker.current(), 'ws-a')

// Past the window it is forgotten rather than reused: a stale attribution would
// put another project's panel in front of the user, which is the bug this
// exists to prevent.
clock += 2
assert.equal(tracker.current(), null)

// A manager with no workspace id clears the record instead of leaving the last
// one to be picked up by the next request.
tracker.note('ws-a')
tracker.note(null)
assert.equal(tracker.current(), null)
