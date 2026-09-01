import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname, join, resolve } from 'path'
import { homedir } from 'os'
import { VESPI_PRIVATE_OMP_REL, VESPI_PRIVATE_OPENSPACE_REL, VESPI_PROFILE } from '../shared/vespi'
import { getGuiDataPath } from './app-data-paths'

export {
  VESPI_PROFILE,
  VESPI_RPC_MODE,
  VESPI_PROFILE_FLAG,
  VESPI_APP_ID,
  VESPI_PRODUCT_NAME,
  VESPI_USER_DATA_ENV,
  VESPI_WORKSPACE_ENV,
  VESPI_PRIVATE_OMP_REL,
  VESPI_PRIVATE_OPENSPACE_REL,
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

/** Private CPython that vendors OpenSpace. */
export function resolvePrivateOpenspacePython(
  appPath = process.execPath,
  resourcesPath?: string
): string | null {
  return resolvePrivateRuntime(VESPI_PRIVATE_OPENSPACE_REL, appPath, resourcesPath)
}

export function defaultOpenspacePythonPath(): string {
  return resolvePrivateOpenspacePython() ?? VESPI_PRIVATE_OPENSPACE_REL
}

export function vespiProfileAgentDir(): string {
  return join(homedir(), '.omp', 'profiles', VESPI_PROFILE, 'agent')
}

export function vespiSkillsDir(): string {
  return join(homedir(), '.vespi', 'skills')
}

function resolveEnvApiKey(apiKey: string): string | null {
  const trimmed = apiKey.trim()
  if (!trimmed) return null
  if (trimmed.startsWith('$')) {
    const value = process.env[trimmed.slice(1)]
    return value && value.trim() ? value.trim() : null
  }
  if (trimmed.startsWith('!')) return null
  return trimmed
}

/**
 * Map VesPi/OMP `models.json` onto OpenSpace's LLM env.
 * Evolution uses the user's selected chat model. No installer key is shipped.
 */
export function vespiOpenspaceLlmEnv(): Record<string, string> {
  const file = join(vespiProfileAgentDir(), 'models.json')
  try {
    if (!existsSync(file)) return {}
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf-8'))
    if (!parsed || typeof parsed !== 'object' || !('providers' in parsed)) return {}
    const providers = parsed.providers
    if (!providers || typeof providers !== 'object' || Array.isArray(providers)) return {}
    const settingsPath = getGuiDataPath('settings.json')
    let preferredProvider = ''
    let preferredModel = ''
    try {
      if (existsSync(settingsPath)) {
        const settings: unknown = JSON.parse(readFileSync(settingsPath, 'utf-8'))
        if (settings && typeof settings === 'object') {
          preferredProvider = 'defaultProvider' in settings && typeof settings.defaultProvider === 'string' ? settings.defaultProvider.trim() : ''
          preferredModel = 'defaultModel' in settings && typeof settings.defaultModel === 'string' ? settings.defaultModel.trim() : ''
        }
      }
    } catch {
      preferredProvider = ''
      preferredModel = ''
    }
    const names = Object.keys(providers)
    const ordered = preferredProvider && names.includes(preferredProvider)
      ? [preferredProvider, ...names.filter((name) => name !== preferredProvider)]
      : names
    const providerMap = providers as Record<string, unknown>
    for (const name of ordered) {
      const provider = providerMap[name]
      if (!provider || typeof provider !== 'object') continue
      const rec = provider as Record<string, unknown>
      const apiKey = typeof rec.apiKey === 'string' ? resolveEnvApiKey(rec.apiKey) : null
      const baseUrl = typeof rec.baseUrl === 'string' ? rec.baseUrl.trim() : ''
      const models = Array.isArray(rec.models) ? rec.models : []
      const matchModel = (model: unknown, want?: string): model is { id: string } =>
        Boolean(model && typeof model === 'object' && 'id' in model && typeof (model as { id: unknown }).id === 'string' && (!want || (model as { id: string }).id.trim() === want) && (model as { id: string }).id.trim())
      const preferred = preferredModel ? models.find((model) => matchModel(model, preferredModel)) : undefined
      const first = preferred ?? models.find((model) => matchModel(model))
      const modelId = first && matchModel(first) ? first.id.trim() : ''
      if (!apiKey || !baseUrl || !modelId) continue
      return {
        OPENSPACE_MODEL: `openai/${modelId}`,
        OPENSPACE_LLM_API_KEY: apiKey,
        OPENSPACE_LLM_API_BASE: baseUrl.replace(/\/+$/, ''),
      }
    }
  } catch {
    return {}
  }
  return {}
}

export function vespiOpenspaceProcessEnv(workspace?: string): Record<string, string> {
  const skills = vespiSkillsDir()
  const env: Record<string, string> = {
    OPENSPACE_CLOUD_MODE: 'off',
    OPENSPACE_CLOUD_TELEMETRY_MODE: 'off',
    OPENSPACE_SKIP_DOTENV: '1',
    OPENSPACE_HOST_SKILL_DIRS: skills,
    PYTHONDONTWRITEBYTECODE: '1',
    ...vespiOpenspaceLlmEnv(),
  }
  if (workspace) {
    env.OPENSPACE_WORKSPACE = workspace
    env.OPENSPACE_CONFIG_HOME = join(workspace, '.openspace')
  }
  return env
}

function openspaceMcpEnv(workspace?: string): Record<string, string> {
  return vespiOpenspaceProcessEnv(workspace)
}

/**
 * Point the vespi OMP profile at the private OpenSpace MCP. Cloud stays off.
 * Existing user MCP servers are kept; only the `openspace` entry is owned here.
 */
export function ensureVespiOpenspaceMcp(workspace?: string): string | null {
  const python = resolvePrivateOpenspacePython()
  if (!python) return null
  const agentDir = vespiProfileAgentDir()
  mkdirSync(agentDir, { recursive: true })
  mkdirSync(vespiSkillsDir(), { recursive: true })
  const mcpPath = join(agentDir, 'mcp.json')
  let parsed: Record<string, unknown> = {}
  try {
    if (existsSync(mcpPath)) {
      parsed = JSON.parse(readFileSync(mcpPath, 'utf-8')) as Record<string, unknown>
    }
  } catch {
    parsed = {}
  }
  const servers =
    parsed.mcpServers && typeof parsed.mcpServers === 'object' && !Array.isArray(parsed.mcpServers)
      ? { ...(parsed.mcpServers as Record<string, unknown>) }
      : {}
  servers.openspace = {
    command: python,
    args: ['-m', 'openspace.entrypoints.mcp.server', '--transport', 'stdio'],
    env: openspaceMcpEnv(workspace),
  }
  writeFileSync(mcpPath, `${JSON.stringify({ ...parsed, mcpServers: servers }, null, 2)}\n`, 'utf-8')
  return mcpPath
}
