import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  clearApiKey,
  configSummary,
  loadStoredConfig,
  saveStoredConfig,
  setApiKey,
  setDefaultModel,
} from '../src/config.js'

test('configuration persists one Key and one user-selected default without exposing the full Key', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sublyx-image-config-'))
  const path = join(root, 'nested', 'config.json')
  try {
    assert.deepEqual(await loadStoredConfig(path), { schemaVersion: 1, apiKey: '' })
    await setApiKey('unit-test-key-1234567890-secret', path)
    await setDefaultModel('gpt-image-future', path)
    const stored = await loadStoredConfig(path)
    assert.equal(stored.defaultModel, 'gpt-image-future')
    assert.equal(stored.apiKey, 'unit-test-key-1234567890-secret')
    const summary = configSummary(stored, { configPath: path, factoryDefaultModel: 'gpt-image-2' })
    assert.equal(summary.defaultModel, 'gpt-image-future')
    assert.equal(summary.hasApiKey, true)
    assert.ok(!JSON.stringify(summary).includes('1234567890-secret'))
    const onDisk = JSON.parse(await readFile(path, 'utf8'))
    assert.equal(onDisk.schemaVersion, 1)
    await clearApiKey(path)
    assert.equal((await loadStoredConfig(path)).apiKey, '')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('invalid legacy model values are discarded and save is normalized', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sublyx-image-normalize-'))
  const path = join(root, 'config.json')
  try {
    const saved = await saveStoredConfig({ apiKey: 'abc', defaultModel: 'invalid model with spaces', ignored: true }, path)
    assert.equal(saved.defaultModel, undefined)
    const raw = JSON.parse(await readFile(path, 'utf8'))
    assert.deepEqual(Object.keys(raw).sort(), ['apiKey', 'schemaVersion', 'updatedAt'])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
