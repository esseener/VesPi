import assert from 'node:assert/strict'
import {
  DEFAULT_PERMISSION_MODE,
  PERMISSION_MODE_OPTIONS,
  getPermissionModeLabel,
  isPermissionMode,
} from './permission-mode'

assert.equal(DEFAULT_PERMISSION_MODE, 'ask-edits')

assert.deepEqual(
  PERMISSION_MODE_OPTIONS.map((option) => option.value),
  ['plan-readonly', 'ask-edits', 'ask-commands', 'trusted']
)

assert.equal(getPermissionModeLabel('plan-readonly', 'zh'), '只读规划')
assert.equal(getPermissionModeLabel('ask-edits', 'zh'), '改文件前询问')
assert.equal(getPermissionModeLabel('ask-commands', 'zh'), '运行命令前询问')
assert.equal(getPermissionModeLabel('trusted', 'zh'), '完全信任')
assert.equal(getPermissionModeLabel('ask-edits', 'en'), 'Ask before edits')

assert.equal(isPermissionMode('ask-edits'), true)
assert.equal(isPermissionMode('bad-mode'), false)
