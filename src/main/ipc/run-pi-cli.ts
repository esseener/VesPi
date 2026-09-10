import { execFile } from 'child_process'
import { promisify } from 'util'
import { buildPiInvocation, getPiCli, getPiCliForEngine } from '../pi-rpc-manager'
import type { AgentEngineKind } from '../../shared/ipc-contracts'
import { VESPI_PROFILE } from '../../shared/vespi'

const execFileAsync = promisify(execFile)

export async function runPiCli(
  args: string[],
  cwd: string,
  timeout: number,
  engine?: AgentEngineKind,
): Promise<{ success: boolean; output: string }> {
  try {
    const cli = engine ? getPiCliForEngine(engine) : getPiCli()
    const cliArgs = engine === 'omp' && args[0] !== '--profile'
      ? ['--profile', VESPI_PROFILE, ...args]
      : args
    const invocation = buildPiInvocation(cli, cliArgs)
    const { stdout, stderr } = await execFileAsync(invocation.file, invocation.args, {
      cwd,
      timeout,
      env: { ...process.env },
      shell: cli.needsShell,
    })
    return { success: true, output: stdout + stderr }
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message?: string }
    const output = [e.stdout, e.stderr, e.message].filter(Boolean).join('\n').trim()
    return {
      success: false,
      output: output || 'Command failed',
    }
  }
}
