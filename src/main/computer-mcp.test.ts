import { strict as assert } from 'node:assert'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'

import {
  COMPUTER_MCP_NAME,
  agentComputerAppsIn,
  agentComputerEnabledIn,
  computerBridgePath,
  computerMcpEntry,
  computerSidecarPath,
  readComputerSettings,
} from './computer-mcp'

/**
 * Desktop control is the one feature whose default matters most: getting it wrong
 * means every user silently has an agent that can drive their machine. These tests
 * pin the default as *off*, and pin the allow-list parsing that backs it up.
 */

describe('computer settings: the switch', () => {
  it('is off when there is no settings object at all', () => {
    assert.equal(agentComputerEnabledIn(undefined), false)
    assert.equal(agentComputerEnabledIn(null), false)
  })

  it('is off for an empty settings file', () => {
    assert.equal(agentComputerEnabledIn({}), false)
  })

  it('is off for anything that is not literally true', () => {
    assert.equal(agentComputerEnabledIn({ agentComputerEnabled: 'true' }), false)
    assert.equal(agentComputerEnabledIn({ agentComputerEnabled: 1 }), false)
    assert.equal(agentComputerEnabledIn({ agentComputerEnabled: false }), false)
  })

  it('is on only when explicitly enabled', () => {
    assert.equal(agentComputerEnabledIn({ agentComputerEnabled: true }), true)
  })
})

describe('computer settings: the allow-list', () => {
  it('is empty when absent or not an array', () => {
    assert.deepEqual(agentComputerAppsIn({}), [])
    assert.deepEqual(agentComputerAppsIn({ agentComputerApps: 'notepad.exe' }), [])
  })

  it('drops non-string entries and blanks', () => {
    assert.deepEqual(agentComputerAppsIn({ agentComputerApps: ['notepad.exe', 7, '', '  chrome.exe  '] }), [
      'notepad.exe',
      'chrome.exe',
    ])
  })
})

describe('computer settings: reading files', () => {
  it('is off when no settings file exists', () => {
    const settings = readComputerSettings([join(tmpdir(), 'vespi-does-not-exist', 'settings.json')])
    assert.deepEqual(settings, { enabled: false, allowedApps: [] })
  })

  it('reads the first file that exists', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vespi-computer-'))
    try {
      const primary = join(dir, 'settings.json')
      writeFileSync(primary, JSON.stringify({ agentComputerEnabled: true, agentComputerApps: ['notepad.exe'] }))
      const settings = readComputerSettings([primary])
      assert.deepEqual(settings, { enabled: true, allowedApps: ['notepad.exe'] })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('fails closed on a truncated file rather than guessing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vespi-computer-'))
    try {
      const primary = join(dir, 'settings.json')
      writeFileSync(primary, '{"agentComputerEnabled": tru')
      assert.deepEqual(readComputerSettings([primary]), { enabled: false, allowedApps: [] })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('computer MCP entry', () => {
  it('is a stdio server run by the app executable with the pipe and token in env', () => {
    const entry = computerMcpEntry({
      nodeExecutable: 'C:\\app\\VesPi.exe',
      serverPath: 'C:\\app\\resources\\vespi-computer-mcp.mjs',
      pipePath: '\\\\.\\pipe\\vespi-computer-abc123',
      token: 'secret-token',
    }) as { type: string; command: string; args: string[]; env: Record<string, string> }

    assert.equal(entry.type, 'stdio')
    assert.equal(entry.command, 'C:\\app\\VesPi.exe')
    assert.deepEqual(entry.args, ['C:\\app\\resources\\vespi-computer-mcp.mjs'])
    assert.equal(entry.env.ELECTRON_RUN_AS_NODE, '1')
    assert.equal(entry.env.VESPI_COMPUTER_PIPE, '\\\\.\\pipe\\vespi-computer-abc123')
    assert.equal(entry.env.VESPI_COMPUTER_TOKEN, 'secret-token')
  })

  it('registers under its own name, beside the browser and panel servers', () => {
    assert.equal(COMPUTER_MCP_NAME, 'computer')
  })
})

describe('computer paths', () => {
  it('resolves the helper inside the packaged resources directory', () => {
    const path = computerSidecarPath('C:\\app\\resources', true, 'C:\\app\\resources\\app.asar')
    assert.equal(path, join('C:\\app\\resources', 'resources', 'vespi-cua.exe'))
  })

  it('resolves the helper from the project directory when running unpackaged', () => {
    const path = computerSidecarPath('C:\\unused', false, 'D:\\VesPi\\desktop')
    assert.equal(path, join('D:\\VesPi\\desktop', 'resources', 'vespi-cua.exe'))
  })

  it('resolves the bridge beside the helper', () => {
    const path = computerBridgePath('C:\\app\\resources', true, 'C:\\app\\resources\\app.asar')
    assert.equal(path, join('C:\\app\\resources', 'resources', 'vespi-computer-mcp.mjs'))
  })
})
