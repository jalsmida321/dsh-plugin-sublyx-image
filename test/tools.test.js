import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { registerTools } from '../src/tools.js'

test('plugin registers generation, model, and explicit Key tools', () => {
  const registered = []
  const ctx = { tools: { register: (tool) => registered.push(tool) } }
  registerTools(ctx, {
    toolTimeoutMs: 60_000,
    configPath: 'unused-in-registration-test',
    factoryDefaultModel: 'gpt-image-2',
  })
  assert.deepEqual(registered.map((tool) => tool.name), ['image_generate_sublyx', 'image_model_sublyx', 'image_key_sublyx'])
  assert.match(registered[0].description, /OpenAI Images API/)
  assert.match(registered[1].description, /explicitly asks/i)
  assert.match(registered[2].description, /run the whole command unchanged/)
  assert.match(registered[2].description, /conversation and tool-call history/)
})

test('Agent Key configuration returns only a masked preview', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sublyx-image-key-tool-'))
  const registered = []
  const ctx = { tools: { register: (tool) => registered.push(tool) } }
  const configPath = join(root, 'config.json')
  try {
    registerTools(ctx, {
      toolTimeoutMs: 60_000,
      configPath,
      factoryDefaultModel: 'gpt-image-2',
    })
    const keyTool = registered.find((tool) => tool.name === 'image_key_sublyx')
    const secret = 'unit-test-agent-key-1234567890-secret'
    const result = await keyTool.execute({ action: 'set', key: secret })
    assert.equal(result.hasApiKey, true)
    assert.equal(result.changed, true)
    assert.ok(!JSON.stringify(result).includes(secret))
    assert.match(result.apiKeyPreview, /\.\.\./)
    assert.match(result.securityNotice, /Do not repeat the complete Key/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
