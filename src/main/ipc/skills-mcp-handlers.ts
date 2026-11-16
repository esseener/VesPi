import { ipcMain } from 'electron'
import { IPC_CHANNELS, type InstalledSkill } from '../../shared/ipc-contracts'
import { readdir, readFile } from 'fs/promises'
import { join } from 'path'
import { existsSync } from 'fs'
import type { IpcContext } from './context'
import { VESPI_PROFILE } from '../../shared/vespi'

export function registerSkillsMcpHandlers(ctx: IpcContext): void {
  const { workspaceManager } = ctx

  // ─── Skills ─────────────────────────────────────────────────────────────

  ipcMain.handle(IPC_CHANNELS.SKILLS_LIST, async () => {
    const ws = workspaceManager.getActiveWorkspace()
    const cwd = ws?.path ?? process.cwd()
    return listSkillsFromDisk(cwd)
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

