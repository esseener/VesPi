import assert from 'node:assert/strict'
import { test } from 'node:test'
import { join } from 'node:path'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { defaultOmpExecutablePath, removeVespiOpenspaceMcp, resolvePrivateOmpPath, vespiProfileArgs } from './vespi-runtime'
import { VESPI_PROFILE, VESPI_RPC_MODE } from '../shared/vespi'


test('vespi profile args are the official OMP isolation flags', () => {
  assert.deepEqual(vespiProfileArgs(), ['--profile', VESPI_PROFILE])
  assert.equal(VESPI_RPC_MODE, 'rpc-ui')
})

test('resolvePrivateOmpPath finds omp.exe next to the app binary', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vespi-runtime-'))
  const ompDir = join(root, 'runtime', 'omp')
  await mkdir(ompDir, { recursive: true })
  const omp = join(ompDir, 'omp.exe')
  await writeFile(omp, '')
  assert.equal(resolvePrivateOmpPath(join(root, 'VesPi.exe')), omp)
})

test('resolvePrivateOmpPath prefers Electron resourcesPath over next-to-exe', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vespi-packaged-'))
  const appDir = join(root, 'app')
  const resourcesDir = join(root, 'resources')
  const nextToExe = join(appDir, 'runtime', 'omp')
  const packaged = join(resourcesDir, 'runtime', 'omp')
  await mkdir(nextToExe, { recursive: true })
  await mkdir(packaged, { recursive: true })
  await writeFile(join(nextToExe, 'omp.exe'), 'wrong')
  const omp = join(packaged, 'omp.exe')
  await writeFile(omp, 'right')
  assert.equal(resolvePrivateOmpPath(join(appDir, 'VesPi.exe'), resourcesDir), omp)
})

test('resolvePrivateOmpPath finds omp.exe under app/resources when resourcesPath is absent', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vespi-app-resources-'))
  const packaged = join(root, 'resources', 'runtime', 'omp')
  await mkdir(packaged, { recursive: true })
  const omp = join(packaged, 'omp.exe')
  await writeFile(omp, '')
  assert.equal(resolvePrivateOmpPath(join(root, 'VesPi.exe'), ''), omp)
})

test('defaultOmpExecutablePath always names omp.exe', () => {
  const resolved = defaultOmpExecutablePath()
  assert.match(resolved.replaceAll('\\', '/'), /omp\.exe$/)
})

test('removeVespiOpenspaceMcp drops only the openspace entry', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vespi-mcp-'))
  const file = join(root, 'mcp.json')
  await writeFile(file, JSON.stringify({ mcpServers: { openspace: { command: 'gone' }, mine: { command: 'keep' } } }))
  removeVespiOpenspaceMcp(file)
  const parsed = JSON.parse(await readFile(file, 'utf-8')) as { mcpServers: Record<string, unknown> }
  assert.deepEqual(Object.keys(parsed.mcpServers), ['mine'])
})

test('removeVespiOpenspaceMcp tolerates a missing or malformed file', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vespi-mcp-'))
  assert.doesNotThrow(() => removeVespiOpenspaceMcp(join(root, 'missing.json')))
  const bad = join(root, 'bad.json')
  await writeFile(bad, 'not json')
  assert.doesNotThrow(() => removeVespiOpenspaceMcp(bad))
})
