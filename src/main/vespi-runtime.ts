import { existsSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join, resolve } from 'path'
import { homedir } from 'os'
import { VESPI_PRIVATE_OMP_REL, VESPI_PROFILE } from '../shared/vespi'

export {
  VESPI_PROFILE,
  VESPI_RPC_MODE,
  VESPI_PROFILE_FLAG,
  VESPI_APP_ID,
  VESPI_PRODUCT_NAME,
  VESPI_USER_DATA_ENV,
  VESPI_WORKSPACE_ENV,
  VESPI_PRIVATE_OMP_REL,
  vespiProfileArgs,
} from '../shared/vespi'

function runtimeCandidates(rel: string, appPath = process.execPath, resourcesPath?: string): string[] {
  const resources =
    resourcesPath ||
    (typeof process.resourcesPath === 'string' && process.resourcesPath.length > 0
      ? process.resourcesPath
      : '')
  const out = [
    ...(resources ? [join(resources, rel)] : []),
    join(dirname(appPath), rel),
    join(dirname(appPath), 'resources', rel),
    resolve(process.cwd(), rel),
    resolve(process.cwd(), '..', rel),
  ]
  return [...new Set(out)]
}

function resolvePrivateRuntime(
  rel: string,
  appPath = process.execPath,
  resourcesPath?: string
): string | null {
  for (const candidate of runtimeCandidates(rel, appPath, resourcesPath)) {
    try {
      if (existsSync(candidate)) return candidate
    } catch {
      // Permission or race: try the next candidate.
    }
  }
  return null
}

/**
 * Absolute path to the private Windows OMP binary shipped with VesPi.
 * Packaged: `{resourcesPath}/runtime/omp/omp.exe`. Dev: repo `runtime/omp/omp.exe`.
 */
export function resolvePrivateOmpPath(
  appPath = process.execPath,
  resourcesPath?: string
): string | null {
  return resolvePrivateRuntime(VESPI_PRIVATE_OMP_REL, appPath, resourcesPath)
}

export function defaultOmpExecutablePath(): string {
  return resolvePrivateOmpPath() ?? VESPI_PRIVATE_OMP_REL
}

export function vespiProfileAgentDir(): string {
  return join(homedir(), '.omp', 'profiles', VESPI_PROFILE, 'agent')
}

/**
 * OpenSpace is not part of the product (ARCHITECTURE.md §7). Builds before the
 * removal wrote an `openspace` entry into the vespi profile's mcp.json, and
 * handed it the user's model API key. Strip that entry once at startup so OMP
 * stops trying to spawn the (no longer shipped) private Python runtime.
 */
export function removeVespiOpenspaceMcp(mcpPath = join(vespiProfileAgentDir(), 'mcp.json')): void {
  try {
    if (!existsSync(mcpPath)) return
    const parsed: unknown = JSON.parse(readFileSync(mcpPath, 'utf-8'))
    if (!parsed || typeof parsed !== 'object') return
    const record = parsed as Record<string, unknown>
    const servers = record.mcpServers
    if (!servers || typeof servers !== 'object' || Array.isArray(servers)) return
    if (!('openspace' in servers)) return
    const rest: Record<string, unknown> = {}
    for (const [name, value] of Object.entries(servers)) {
      if (name !== 'openspace') rest[name] = value
    }
    writeFileSync(mcpPath, `${JSON.stringify({ ...record, mcpServers: rest }, null, 2)}\n`, 'utf-8')
  } catch {
    // Best-effort cleanup. A malformed mcp.json belongs to the user; leave it.
  }
}
