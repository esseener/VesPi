#!/usr/bin/env node

/**
 * vespi — CLI launcher for the VesPi desktop client
 *
 * Usage:
 *   vespi              # Launch the app
 *   vespi --help       # Show help
 *   vespi --version    # Show version
 *   vespi /path/to/dir # Launch with workspace
 */

const { spawn } = require('child_process')
const { existsSync } = require('fs')
const { join, resolve } = require('path')

const VERSION = require('../package.json').version

// ─── Parse args ──────────────────────────────────────────────────────────────

const args = process.argv.slice(2)

if (args.includes('--help') || args.includes('-h')) {
  console.log(`
  vespi v${VERSION} — Desktop GUI for private OMP

  Usage:
    vespi                  Launch the app
    vespi <path>           Launch with workspace directory
    vespi --help           Show this help
    vespi --version        Show version

  Examples:
    vespi                  # Launch with default workspace
    vespi ~/my-project     # Launch with specific project
    vespi .                # Launch with current directory

  Runtime:
    Uses the private OMP binary at runtime/omp/omp.exe
    with --profile vespi --mode rpc-ui.
`)
  process.exit(0)
}

if (args.includes('--version') || args.includes('-v')) {
  console.log(VERSION)
  process.exit(0)
}

// ─── Find Electron binary ────────────────────────────────────────────────────

function findElectron() {
  // Try to find electron from the package's own node_modules
  const candidates = [
    join(__dirname, '..', 'node_modules', 'electron', 'dist', 'electron'),
    join(__dirname, '..', 'node_modules', '.bin', 'electron'),
  ]

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate
    }
  }

  // Try to find globally installed electron
  try {
    const { execSync } = require('child_process')
    const electronPath = execSync('which electron', { encoding: 'utf8', timeout: 5000 }).trim()
    if (existsSync(electronPath)) {
      return electronPath
    }
  } catch {
    // Not found
  }

  console.error('Error: Electron not found. Please install dependencies:')
  console.error('  cd ' + join(__dirname, '..') + ' && npm install')
  process.exit(1)
}

// ─── Find app resources ─────────────────────────────────────────────────────

function findAppResources() {
  // Packaged app: resources are in app.asar or app directory
  const packagedPaths = [
    join(__dirname, '..', 'app.asar'),
    join(__dirname, '..', 'app'),
    join(__dirname, '..', 'resources', 'app.asar'),
    join(__dirname, '..', 'resources', 'app'),
  ]

  for (const p of packagedPaths) {
    if (existsSync(p)) {
      return p
    }
  }

  // Development: use the project root (electron-vite builds to out/)
  const devPath = join(__dirname, '..')
  if (existsSync(join(devPath, 'out', 'main', 'index.js'))) {
    return devPath
  }

  // Build first
  console.error('Error: App not built. Run "npm run build" first.')
  process.exit(1)
}

// ─── Launch ──────────────────────────────────────────────────────────────────

function launch() {
  const electronPath = findElectron()
  const appPath = findAppResources()

  // Resolve workspace path if provided
  let workspacePath = null
  if (args.length > 0 && !args[0].startsWith('-')) {
    workspacePath = resolve(args[0])
    if (!existsSync(workspacePath)) {
      console.error(`Error: Path does not exist: ${workspacePath}`)
      process.exit(1)
    }
  }

  // Build electron args.
  // --no-sandbox is required so Pi subprocesses can spawn.
  // --disable-gpu is intentionally NOT passed by default — it breaks window
  // creation on some Wayland + AMD setups. If the GPU process crashes on your
  // system, re-add it locally as an escape hatch.
  const electronArgs = [
    appPath,
    '--no-sandbox',
  ]

  // Pass workspace path via environment variable
  const env = { ...process.env }
  if (workspacePath) {
    env.VESPI_WORKSPACE = workspacePath
  }

  // Launch Electron
  const child = spawn(electronPath, electronArgs, {
    stdio: 'inherit',
    env,
    detached: false,
  })

  child.on('error', (err) => {
    console.error('Failed to start VesPi:', err.message)
    process.exit(1)
  })

  child.on('exit', (code) => {
    process.exit(code ?? 0)
  })

  // Forward signals
  process.on('SIGINT', () => child.kill('SIGINT'))
  process.on('SIGTERM', () => child.kill('SIGTERM'))
}

launch()
