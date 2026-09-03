import assert from 'node:assert/strict'
import { test } from 'node:test'
import { join } from 'node:path'
import { mkdtemp, writeFile, readFile, utimes } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { reconcileModelsYml } from './models-reconcile'

const CONFIG = {
  providers: {
    demo: {
      baseUrl: 'https://api.example.com/v1',
      api: 'openai-completions',
      apiKey: 'sk-test',
      models: [{ id: 'm1', name: 'm1', reasoning: true, contextWindow: 1000, maxTokens: 100, input: ['text', 'image'] }],
    },
  },
}

async function tempAgentDir(): Promise<string> {
  return await mkdtemp(join(tmpdir(), 'vespi-reconcile-'))
}

test('reconcileModelsYml rebuilds the yml when the json is newer', async () => {
  const dir = await tempAgentDir()
  await writeFile(join(dir, 'models.yml'), 'providers: {}\n')
  await writeFile(join(dir, 'models.json'), JSON.stringify(CONFIG))
  // Make the yml look a day old relative to the json.
  const old = new Date(Date.now() - 86_400_000)
  await utimes(join(dir, 'models.yml'), old, old)
  assert.equal(reconcileModelsYml(dir), true)
  const yml = await readFile(join(dir, 'models.yml'), 'utf-8')
  assert.match(yml, /"demo"/)
  assert.match(yml, /- id: "m1"/)
  assert.match(yml, /- image/)
})

test('reconcileModelsYml creates the yml when it is missing', async () => {
  const dir = await tempAgentDir()
  await writeFile(join(dir, 'models.json'), JSON.stringify(CONFIG))
  assert.equal(reconcileModelsYml(dir), true)
  assert.match(await readFile(join(dir, 'models.yml'), 'utf-8'), /"demo"/)
})

test('reconcileModelsYml leaves a fresher yml alone', async () => {
  const dir = await tempAgentDir()
  await writeFile(join(dir, 'models.json'), JSON.stringify(CONFIG))
  await new Promise((r) => setTimeout(r, 50))
  await writeFile(join(dir, 'models.yml'), 'providers:\n  newer: {}\n')
  assert.equal(reconcileModelsYml(dir), false)
  assert.equal(await readFile(join(dir, 'models.yml'), 'utf-8'), 'providers:\n  newer: {}\n')
})

test('reconcileModelsYml tolerates missing or corrupt json', async () => {
  const dir = await tempAgentDir()
  assert.equal(reconcileModelsYml(dir), false)
  await writeFile(join(dir, 'models.json'), 'not json')
  assert.equal(reconcileModelsYml(dir), false)
  await writeFile(join(dir, 'models.json'), '[]')
  assert.equal(reconcileModelsYml(dir), false)
})

test('reconcileModelsYml writes atomically (no .tmp left behind)', async () => {
  const dir = await tempAgentDir()
  await writeFile(join(dir, 'models.json'), JSON.stringify(CONFIG))
  assert.equal(reconcileModelsYml(dir), true)
  await assert.rejects(() => readFile(join(dir, 'models.yml.tmp'), 'utf-8'))
})
