import assert from 'node:assert/strict'
import { test } from 'node:test'
import { join } from 'path'
import { ompPluginArgs, ompPluginDirectory, parseOmpPluginList } from './omp-plugins'

test('ompPluginArgs targets the VesPi profile and native plugin verbs', () => {
  assert.deepEqual(ompPluginArgs('list'), ['--profile', 'vespi', 'plugin', 'list', '--json'])
  assert.deepEqual(ompPluginArgs('install', 'npm:demo'), [
    '--profile', 'vespi', 'plugin', 'install', 'npm:demo', '--scope=user',
  ])
  assert.deepEqual(ompPluginArgs('uninstall', 'demo'), ['--profile', 'vespi', 'plugin', 'uninstall', 'demo'])
  assert.deepEqual(ompPluginArgs('upgrade'), ['--profile', 'vespi', 'plugin', 'upgrade'])
})

test('ompPluginDirectory uses the isolated VesPi profile', () => {
  assert.equal(ompPluginDirectory('/home/tester'), join('/home/tester', '.omp', 'profiles', 'vespi', 'plugins'))
})

test('parseOmpPluginList accepts source buckets and metadata entries', () => {
  const packages = parseOmpPluginList(JSON.stringify({
    npm: [
      { name: 'demo-plugin', version: '1.2.3', source: 'npm:demo-plugin@1.2.3' },
      'npm:plain-plugin@2.0.0',
    ],
    marketplace: [],
  }), '/plugins')

  assert.deepEqual(packages, [
    { name: 'demo-plugin', source: 'npm:demo-plugin@1.2.3', type: 'extension', version: '1.2.3', path: '/plugins' },
    { name: 'plain-plugin', source: 'npm:plain-plugin@2.0.0', type: 'extension', version: '2.0.0', path: '/plugins' },
  ])
})

test('parseOmpPluginList returns an empty list for non-JSON output', () => {
  assert.deepEqual(parseOmpPluginList('No plugins installed', '/plugins'), [])
})
