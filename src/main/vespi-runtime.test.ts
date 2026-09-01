import assert from 'node:assert/strict'
import { test } from 'node:test'
import { join } from 'node:path'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { defaultOmpExecutablePath, defaultOpenspacePythonPath, resolvePrivateOmpPath, resolvePrivateOpenspacePython, vespiProfileArgs } from './vespi-runtime'
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

test('resolvePrivateOpenspacePython finds python.exe next to the app binary', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vespi-openspace-'))
  const pyDir = join(root, 'runtime', 'openspace')
  await mkdir(pyDir, { recursive: true })
  const python = join(pyDir, 'python.exe')
  await writeFile(python, '')
  assert.equal(resolvePrivateOpenspacePython(join(root, 'VesPi.exe')), python)
})

test('defaultOpenspacePythonPath always names python.exe', () => {
  const resolved = defaultOpenspacePythonPath()
  assert.match(resolved.replaceAll('\\', '/'), /python\.exe$/)
})
