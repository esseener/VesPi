import { app, ipcMain } from 'electron'
import { IPC_CHANNELS, type InstalledSkill, type SkillMutationResult } from '../../shared/ipc-contracts'
import { readdir, readFile } from 'fs/promises'
import { join } from 'path'
import { existsSync } from 'fs'
import { execFile } from 'child_process'
import { promisify } from 'util'
import type { IpcContext } from './context'
import { VESPI_PROFILE } from '../../shared/vespi'
import { resolvePrivateOpenspacePython, vespiOpenspaceProcessEnv } from '../vespi-runtime'

const execFileAsync = promisify(execFile)

function resourceScript(name: string): string | null {
  const candidates = [
    join(app.getAppPath(), 'resources', name),
    join(process.cwd(), 'resources', name),
  ]
  if (typeof process.resourcesPath === 'string' && process.resourcesPath.length > 0) {
    candidates.unshift(join(process.resourcesPath, 'resources', name))
  }
  return candidates.find((path) => existsSync(path)) ?? null
}

function openspaceManageScript(): string | null {
  return resourceScript('openspace-manage-skills.py')
}

function openspaceListScript(): string | null {
  return openspaceManageScript() ?? resourceScript('openspace-list-skills.py')
}

export function registerSkillsMcpHandlers(ctx: IpcContext): void {
  const { workspaceManager } = ctx

  // ─── Skills ─────────────────────────────────────────────────────────────

  ipcMain.handle(IPC_CHANNELS.SKILLS_LIST, async () => {
    const ws = workspaceManager.getActiveWorkspace()
    const cwd = ws?.path ?? process.cwd()
    return listSkills(cwd)
  })

  ipcMain.handle(IPC_CHANNELS.SKILLS_CREATE, async (_event, name: unknown, description: unknown) => {
    if (typeof name !== 'string' || typeof description !== 'string') {
      return { ok: false, error: 'invalid arguments' } satisfies SkillMutationResult
    }
    const cwd = workspaceManager.getActiveWorkspace()?.path ?? process.cwd()
    return runSkillMutation(['create', '--cwd', cwd, '--name', name, '--description', description], cwd)
  })

  ipcMain.handle(IPC_CHANNELS.SKILLS_DELETE, async (_event, path: unknown) => {
    if (typeof path !== 'string') {
      return { ok: false, error: 'invalid arguments' } satisfies SkillMutationResult
    }
    const cwd = workspaceManager.getActiveWorkspace()?.path ?? process.cwd()
    return runSkillMutation(['delete', '--cwd', cwd, '--path', path], cwd)
  })

  ipcMain.handle(IPC_CHANNELS.SKILLS_EVOLVE, async (_event, path: unknown, direction: unknown) => {
    if (typeof path !== 'string' || typeof direction !== 'string') {
      return { ok: false, error: 'invalid arguments' } satisfies SkillMutationResult
    }
    const cwd = workspaceManager.getActiveWorkspace()?.path ?? process.cwd()
    return runSkillMutation(['evolve', '--cwd', cwd, '--path', path, '--direction', direction], cwd, 180_000)
  })

  ipcMain.handle(IPC_CHANNELS.COMMANDS_LIST, async () => {
    const pi = workspaceManager.getActivePiManager()
    if (!pi || pi.getStatus().status !== 'running') return []
    try {
      const command = pi.getEngineKind() === 'omp' ? 'get_available_commands' : 'get_commands'
      const response = await pi.sendCommand({ type: command }) as { success?: boolean; data?: { commands?: unknown[] } } | null
      if (response?.success && response.data?.commands) {
        return response.data.commands
      }
      return []
    } catch {
      return []
    }
  })

  ipcMain.handle(IPC_CHANNELS.MCP_SERVERS_LIST, async () => {
    const ws = workspaceManager.getActiveWorkspace()
    return listMcpServers(ws?.path)
  })
}

// ─── Skills Listing ──────────────────────────────────────────────────────────

async function listSkills(cwd: string): Promise<InstalledSkill[]> {
  const fromRegistry = await listSkillsFromOpenspace(cwd)
  if (fromRegistry !== null) return fromRegistry
  return listSkillsFromDisk(cwd)
}

async function listSkillsFromOpenspace(cwd: string): Promise<InstalledSkill[] | null> {
  const python = resolvePrivateOpenspacePython()
  const script = openspaceListScript()
  if (!python || !script) return null
  try {
    const args = script.endsWith('openspace-manage-skills.py') ? [script, 'list', '--cwd', cwd] : [script, cwd]
    const { stdout } = await execFileAsync(python, args, {
      timeout: 15_000,
      windowsHide: true,
      env: {
        ...process.env,
        ...vespiOpenspaceProcessEnv(cwd),
      },
    })
    const parsed = JSON.parse(extractJsonPayload(stdout, '[')) as unknown
    if (!Array.isArray(parsed)) return null
    return parsed.filter(isInstalledSkill)
  } catch {
    return null
  }
}

async function runSkillMutation(args: string[], cwd: string, timeout = 15_000): Promise<SkillMutationResult> {
  const python = resolvePrivateOpenspacePython()
  const script = openspaceManageScript()
  if (!python || !script) return { ok: false, error: 'OpenSpace runtime is not packaged' }
  try {
    const { stdout } = await execFileAsync(python, [script, ...args], {
      timeout,
      windowsHide: true,
      env: {
        ...process.env,
        ...vespiOpenspaceProcessEnv(cwd),
      },
    })
    return parseMutationResult(stdout) ?? { ok: false, error: 'invalid manager output' }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (err && typeof err === 'object' && 'stdout' in err && typeof err.stdout === 'string') {
      const parsed = parseMutationResult(err.stdout)
      if (parsed) return parsed
    }
    return { ok: false, error: message }
  }
}

function parseMutationResult(stdout: string): SkillMutationResult | null {
  try {
    const parsed: unknown = JSON.parse(extractJsonPayload(stdout, '{'))
    if (!parsed || typeof parsed !== 'object' || !('ok' in parsed) || typeof parsed.ok !== 'boolean') {
      return null
    }
    const error = 'error' in parsed && typeof parsed.error === 'string' ? parsed.error : undefined
    const path = 'path' in parsed && typeof parsed.path === 'string' ? parsed.path : undefined
    const name = 'name' in parsed && typeof parsed.name === 'string' ? parsed.name : undefined
    const skillId = 'skillId' in parsed && typeof parsed.skillId === 'string' ? parsed.skillId : undefined
    const jobs = 'jobs' in parsed && typeof parsed.jobs === 'number' ? parsed.jobs : undefined
    const outcomes = 'outcomes' in parsed && typeof parsed.outcomes === 'number' ? parsed.outcomes : undefined
    const statuses =
      'statuses' in parsed && Array.isArray(parsed.statuses)
        ? parsed.statuses.filter((item): item is string => typeof item === 'string')
        : undefined
    return { ok: parsed.ok, error, path, name, skillId, jobs, outcomes, statuses }
  } catch {
    return null
  }
}


function extractJsonPayload(stdout: string, startChar: '[' | '{' = '['): string {
  const start = stdout.indexOf(startChar)
  const end = stdout.lastIndexOf(startChar === '[' ? ']' : '}')
  if (start >= 0 && end > start) return stdout.slice(start, end + 1)
  return stdout.trim()
}

function isInstalledSkill(value: unknown): value is InstalledSkill {
  if (typeof value !== 'object' || value === null) return false
  const row = value as Record<string, unknown>
  return (
    typeof row.name === 'string' &&
    typeof row.description === 'string' &&
    typeof row.path === 'string' &&
    (row.source === 'vespi' || row.source === 'project' || row.source === 'openspace' || row.source === 'bundled') &&
    row.enabled === true
  )
}

async function listSkillsFromDisk(cwd: string): Promise<InstalledSkill[]> {
  const skills: InstalledSkill[] = []
  const homeDir = process.env.HOME ?? process.env.USERPROFILE ?? ''
  const vespiPaths: Array<{ dir: string; source: InstalledSkill['source'] }> = [
    { dir: join(homeDir, '.omp', 'profiles', VESPI_PROFILE, 'agent', 'skills'), source: 'vespi' },
    { dir: join(homeDir, '.vespi', 'skills'), source: 'vespi' },
    { dir: join(homeDir, '.openspace', 'skills'), source: 'openspace' },
    { dir: join(cwd, '.vespi', 'skills'), source: 'project' },
    { dir: join(cwd, '.openspace', 'skills'), source: 'project' },
  ]
  for (const { dir, source } of vespiPaths) {
    await collectSkills(dir, skills, source)
  }
  return skills
}

async function collectSkills(
  dir: string,
  skills: InstalledSkill[],
  source: InstalledSkill['source']
): Promise<void> {
  try {
    if (!existsSync(dir)) return

    const items = await readdir(dir, { withFileTypes: true })

    for (const item of items) {
      const fullPath = join(dir, item.name)

      if (item.isFile() && item.name.endsWith('.md') && item.name !== 'SKILL.md') {
        // Root .md file as individual skill
        try {
          const content = await readFile(fullPath, 'utf-8')
          const parsed = parseSkillFrontmatter(content)
          if (parsed) {
            skills.push({
              name: parsed.name,
              description: parsed.description,
              path: fullPath,
              source,
              enabled: true,
              managed: source === 'vespi',
            })
          }
        } catch {
          // Skip unreadable files
        }
      } else if (item.isDirectory()) {
        // Directory with SKILL.md
        const skillFile = join(fullPath, 'SKILL.md')
        if (existsSync(skillFile)) {
          try {
            const content = await readFile(skillFile, 'utf-8')
            const parsed = parseSkillFrontmatter(content)
            if (parsed) {
              skills.push({
                name: parsed.name,
                description: parsed.description,
                path: skillFile,
                source,
                enabled: true,
                managed: source === 'vespi',
              })
            }
          } catch {
            // Skip unreadable files
          }
        }

        // Recurse into subdirectories
        await collectSkills(fullPath, skills, source)
      }
    }
  } catch {
    // Directory doesn't exist or isn't readable
  }
}

function parseSkillFrontmatter(content: string): { name: string; description: string } | null {
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/)
  if (!frontmatterMatch) return null

  const frontmatter = frontmatterMatch[1]
  const nameMatch = frontmatter.match(/^name:\s*(.+)$/m)
  const descMatch = frontmatter.match(/^description:\s*(.+)$/m)

  if (!nameMatch || !descMatch) return null

  return {
    name: nameMatch[1].trim(),
    description: descMatch[1].trim(),
  }
}

// ─── MCP Server Discovery ────────────────────────────────────────────────────

interface McpServerInfo {
  name: string
  command: string
  args: string[]
  env: Record<string, string>
  source: 'global' | 'project'
  status: 'configured' | 'unknown'
}

async function listMcpServers(wsPath?: string): Promise<McpServerInfo[]> {
  const servers: McpServerInfo[] = []
  const homeDir = process.env.HOME ?? process.env.USERPROFILE ?? ''
  const vespiPaths = [
    join(homeDir, '.omp', 'profiles', VESPI_PROFILE, 'agent', 'mcp.json'),
    join(homeDir, '.omp', 'profiles', VESPI_PROFILE, 'agent', '.mcp.json'),
    join(homeDir, '.vespi', 'mcp.json'),
  ]
  for (const settingsPath of vespiPaths) {
    await collectMcpServers(settingsPath, servers, 'global')
  }

  if (wsPath) {
    const projectSettingsPaths = [
      join(wsPath, '.vespi', 'mcp.json'),
      join(wsPath, '.vespi', '.mcp.json'),
    ]
    for (const settingsPath of projectSettingsPaths) {
      await collectMcpServers(settingsPath, servers, 'project')
    }
  }

  const unique = new Map<string, McpServerInfo>()
  for (const server of servers) {
    unique.set(server.name, server)
  }
  return [...unique.values()]
}

async function collectMcpServers(
  settingsPath: string,
  servers: McpServerInfo[],
  source: 'global' | 'project'
): Promise<void> {
  try {
    if (!existsSync(settingsPath)) return
    const content = await readFile(settingsPath, 'utf-8')
    const settings = JSON.parse(content)

    // Pi settings may have mcpServers under various keys
    const mcpServers = settings.mcpServers ?? settings.mcp?.servers ?? {}

    for (const [name, config] of Object.entries(mcpServers)) {
      if (typeof config === 'object' && config !== null) {
        const cfg = config as Record<string, unknown>
        servers.push({
          name,
          command: String(cfg.command ?? ''),
          args: Array.isArray(cfg.args) ? cfg.args.map(String) : [],
          env: typeof cfg.env === 'object' && cfg.env !== null ? cfg.env as Record<string, string> : {},
          source,
          status: 'configured',
        })
      }
    }
  } catch {
    // Skip unreadable files
  }
}

