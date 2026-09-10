import { ipcMain } from 'electron'
import { IPC_CHANNELS, type InstalledPackage } from '../../shared/ipc-contracts'
import { isValidPackageSpec } from '../../shared/package-spec'
import { fetchPackageCatalog } from '../package-catalog'
import { readFile } from 'fs/promises'
import { join } from 'path'
import { existsSync } from 'fs'
import { assertTrustedSender, isString } from './validation'
import { runPiCli } from './run-pi-cli'
import { getPiCli } from '../pi-rpc-manager'
import type { IpcContext } from './context'
import { ompPluginArgs, ompPluginDirectory, parseOmpPluginList } from '../omp-plugins'

export function registerPackageHandlers(ctx: IpcContext): void {
  const { workspaceManager } = ctx

  // ─── Package Management ─────────────────────────────────────────────────

  const activeEngine = (): 'pi' | 'omp' =>
    workspaceManager.getActivePiManager()?.getEngineKind() ?? getPiCli().kind ?? 'pi'

  ipcMain.handle(IPC_CHANNELS.PACKAGE_LIST_INSTALLED, async () => {
    const ws = workspaceManager.getActiveWorkspace()
    const cwd = ws?.path ?? process.cwd()
    const engine = activeEngine()
    if (engine === 'omp') return listOmpPlugins(cwd)
    return listPiPackages(cwd)
  })

  ipcMain.handle(IPC_CHANNELS.PACKAGE_INSTALL, async (event, packageSpec: unknown) => {
    assertTrustedSender(event)
    if (!isString(packageSpec)) throw new Error('packageSpec must be a string')
    if (!isValidPackageSpec(packageSpec)) throw new Error('Invalid package specification')
    const ws = workspaceManager.getActiveWorkspace()
    const cwd = ws?.path ?? process.cwd()
    return installPackage(packageSpec, cwd, activeEngine())
  })

  ipcMain.handle(IPC_CHANNELS.PACKAGE_REMOVE, async (event, packageSpec: unknown) => {
    assertTrustedSender(event)
    if (!isString(packageSpec)) throw new Error('packageSpec must be a string')
    if (!isValidPackageSpec(packageSpec)) throw new Error('Invalid package specification')
    const ws = workspaceManager.getActiveWorkspace()
    const cwd = ws?.path ?? process.cwd()
    return removePackage(packageSpec, cwd, activeEngine())
  })

  ipcMain.handle(IPC_CHANNELS.PACKAGE_UPDATE, async (event, packageSpec?: unknown) => {
    assertTrustedSender(event)
    if (isString(packageSpec) && !isValidPackageSpec(packageSpec)) {
      throw new Error('Invalid package specification')
    }
    const ws = workspaceManager.getActiveWorkspace()
    const cwd = ws?.path ?? process.cwd()
    return updatePackage(isString(packageSpec) ? packageSpec : undefined, cwd, activeEngine())
  })

  ipcMain.handle(IPC_CHANNELS.PACKAGE_CATALOG_FETCH, async (_event, query?: unknown) => {
    return fetchPackageCatalog(isString(query) ? query : undefined)
  })
}

// ─── Package Management ──────────────────────────────────────────────────────

interface PiInstalledPackage {
  name: string
  source: string
  type: InstalledPackage['type']
  version: string | null
  path: string
}

async function listOmpPlugins(cwd: string): Promise<InstalledPackage[]> {
  const result = await runPiCli(ompPluginArgs('list'), cwd, 30_000, 'omp')
  if (!result.success) return []
  const homeDir = process.env.HOME ?? process.env.USERPROFILE ?? ''
  return parseOmpPluginList(result.output, ompPluginDirectory(homeDir))
}

async function listPiPackages(cwd: string): Promise<InstalledPackage[]> {
  const homeDir = process.env.HOME ?? process.env.USERPROFILE ?? ''
  const globalSettingsPath = join(homeDir, '.pi', 'agent', 'settings.json')
  const projectSettingsPath = join(cwd, '.pi', 'settings.json')
  const packages: InstalledPackage[] = []
  const globalPackages = await readPackagesFromSettings(globalSettingsPath)
  packages.push(...globalPackages.map((p) => ({ ...p, scope: 'global' })))
  const projectPackages = await readPackagesFromSettings(projectSettingsPath)
  packages.push(...projectPackages.map((p) => ({ ...p, scope: 'project' })))
  return packages
}

async function readPackagesFromSettings(settingsPath: string): Promise<PiInstalledPackage[]> {
  try {
    if (!existsSync(settingsPath)) return []
    const content = await readFile(settingsPath, 'utf-8')
    const settings = JSON.parse(content)
    const packageEntries = settings.packages ?? []

    return packageEntries.map((entry: unknown) => {
      if (typeof entry === 'string') {
        return {
          name: extractPackageName(entry),
          source: entry,
          type: 'package',
          version: extractVersion(entry),
          path: settingsPath,
        }
      }
      if (typeof entry === 'object' && entry !== null) {
        const e = entry as Record<string, unknown>
        return {
          name: extractPackageName(String(e.source ?? '')),
          source: String(e.source ?? ''),
          type: 'package',
          version: extractVersion(String(e.source ?? '')),
          path: settingsPath,
        }
      }
      return { name: 'unknown', source: String(entry), type: 'package', version: null, path: settingsPath }
    })
  } catch {
    return []
  }
}

function extractPackageName(source: string): string {
  // npm:@scope/name@1.0.0 -> @scope/name
  // npm:name@1.0.0 -> name
  // git:github.com/user/repo -> user/repo
  const npmMatch = source.match(/^npm:(@?[^@]+)/)
  if (npmMatch) return npmMatch[1]

  const gitMatch = source.match(/github\.com\/([^/]+\/[^/@]+)/)
  if (gitMatch) return gitMatch[1]

  return source.split('/').pop() ?? source
}

function extractVersion(source: string): string | null {
  const match = source.match(/@([^/]+)$/)
  return match ? match[1] : null
}

async function installPackage(spec: string, cwd: string, engine: 'pi' | 'omp'): Promise<{ success: boolean; output: string }> {
  return engine === 'omp'
    ? runPiCli(ompPluginArgs('install', spec), cwd, 120_000, 'omp')
    : runPiCli(['install', spec], cwd, 120_000, 'pi')
}

async function removePackage(spec: string, cwd: string, engine: 'pi' | 'omp'): Promise<{ success: boolean; output: string }> {
  return engine === 'omp'
    ? runPiCli(ompPluginArgs('uninstall', spec), cwd, 30_000, 'omp')
    : runPiCli(['remove', spec], cwd, 30_000, 'pi')
}

async function updatePackage(spec: string | undefined, cwd: string, engine: 'pi' | 'omp'): Promise<{ success: boolean; output: string }> {
  return engine === 'omp'
    ? runPiCli(ompPluginArgs('upgrade', spec), cwd, 120_000, 'omp')
    : runPiCli(spec ? ['update', spec] : ['update'], cwd, 120_000, 'pi')
}
