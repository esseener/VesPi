import { app } from 'electron'
import { join } from 'path'
import { existsSync } from 'fs'
import type { AppSettings } from '../../shared/ipc-contracts'
import type { TerminalRuntimeOptions } from '../terminal-service'
import { withHarnessDoc } from './harness-doc'
import { browserCdpKernelEnv } from '../browser-cdp'
import { workspaceTrustStore } from '../workspace-trust'
import { getGuiDataPath } from '../app-data-paths'

/** TUI startup gets its own truthful context and native OMP flags. */
export function terminalRuntimeOptions(settings: AppSettings, cwd: string): TerminalRuntimeOptions {
  const resources = app.isPackaged ? join(process.resourcesPath, 'resources') : join(app.getAppPath(), 'resources')
  const args = withHarnessDoc([], join(resources, 'vespi-tui-context.md'), existsSync)
  const stateExtension = join(resources, 'vespi-tui-state.ts')
  if (existsSync(stateExtension)) args.push('-e', stateExtension)
  const permissions = join(resources, 'pi-desktop-permissions.ts')
  if (existsSync(permissions)) args.push('-e', permissions)
  if (settings.permissionMode === 'plan-readonly') args.push('--tools', 'read,grep,glob')
  return {
    executable: settings.piExecutablePath,
    args,
    env: {
      ...browserCdpKernelEnv(),
      VESPI_TUI_STATE_FILE: getGuiDataPath(`tui-state-${process.pid}.json`),
      PI_DESKTOP_PERMISSION_MODE: settings.permissionMode,
      PI_DESKTOP_AGENT_LABEL: 'OMP',
      PI_DESKTOP_PERMISSION_RULES_PATH: getGuiDataPath('permission-rules.json'),
      PI_DESKTOP_WORKSPACE_TRUSTED: workspaceTrustStore.isTrusted(cwd) ? '1' : '0',
    },
    model: settings.defaultProvider && settings.defaultModel ? `${settings.defaultProvider}/${settings.defaultModel}` : undefined,
  }
}
