import { existsSync, readFileSync, renameSync, statSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { ModelsConfig } from '../shared/models-config'
import { buildModelsYml } from '../shared/models-yml'
import { vespiProfileAgentDir } from './vespi-runtime'

/**
 * Rebuild OMP's `models.yml` from `models.json` when the json is newer.
 *
 * Builds before 1.0.13 only wrote models.json, while OMP treats models.yml as
 * authoritative and ignores the json whenever the yml exists — so providers
 * saved there never reached the kernel's model list. The save-time sync added
 * in 1.0.13 fires only on new saves; this startup reconciliation repairs
 * profiles that are still sitting on that stale state.
 *
 * Returns true when the yml was (re)written. tmp+rename keeps a crash from
 * leaving a half-written yml for OMP to read.
 */
/** A save crash often cuts the file at the last `models:` with no model rows. */
export function modelsYmlLooksTruncated(yml: string): boolean {
  const marker = '\n    models:'
  const lastModels = yml.lastIndexOf(marker)
  if (lastModels < 0) return false
  return !/\n\s+- id:/.test(yml.slice(lastModels))
}

export function reconcileModelsYml(agentDir = vespiProfileAgentDir()): boolean {
  const jsonPath = join(agentDir, 'models.json')
  const ymlPath = join(agentDir, 'models.yml')
  try {
    if (!existsSync(jsonPath)) return false
    const jsonMtime = statSync(jsonPath).mtimeMs
    const ymlLooksTruncated = existsSync(ymlPath) && modelsYmlLooksTruncated(readFileSync(ymlPath, 'utf-8'))
    if (existsSync(ymlPath) && statSync(ymlPath).mtimeMs >= jsonMtime && !ymlLooksTruncated) return false
    const parsed: unknown = JSON.parse(readFileSync(jsonPath, 'utf-8'))
    if (!parsed || typeof parsed !== 'object' || !('providers' in parsed)) return false
    writeFileSync(`${ymlPath}.tmp`, buildModelsYml(parsed as ModelsConfig), 'utf-8')
    renameSync(`${ymlPath}.tmp`, ymlPath)
    return true
  } catch {
    // Never block startup on this; the save-time sync will retry next save.
    return false
  }
}
