import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { saveStoredConfig } from '../src/config.js'
import { resolvePromptTasks, runImageGeneration } from '../src/run.js'

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z5ZkAAAAASUVORK5CYII='

function pluginConfig(root, apiBaseUrl) {
  return {
    apiBaseUrl,
    allowInsecureApiBaseUrl: apiBaseUrl.startsWith('http://'),
    configPath: join(root, 'config.json'),
    outputDir: join(root, 'out'),
    factoryDefaultModel: 'gpt-image-2',
    factoryDefaultSize: '1024x1024',
    requestTimeoutMs: 5_000,
    toolTimeoutMs: 20_000,
    maxResponseBytes: 2 * 1024 * 1024,
    maxReferenceBytes: 1024 * 1024,
    maxCount: 4,
    maxBatchRequests: 20,
    maxImagesPerResponse: 4,
    attachResults: false,
  }
}

function fakeRuntime() {
  return {
    ctx: { get: () => undefined },
    exec: { signal: new AbortController().signal, agent: undefined },
  }
}

test('prompt task resolution makes paid request cardinality explicit', () => {
  assert.deepEqual(resolvePromptTasks({ prompt: 'one', count: 2 }), ['one', 'one'])
  assert.deepEqual(resolvePromptTasks({ prompts: ['one', 'two'] }), ['one', 'two'])
  assert.throws(() => resolvePromptTasks({ prompt: 'one', prompts: ['two'] }), /exactly one/)
  assert.throws(() => resolvePromptTasks({ prompts: ['one'], count: 2 }), /cannot be combined/)
})

test('dry-run uses the saved default without a Key or network call', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sublyx-image-dry-run-'))
  try {
    await saveStoredConfig({ defaultModel: 'gpt-image-2' }, join(root, 'config.json'))
    const { ctx, exec } = fakeRuntime()
    const result = await runImageGeneration(ctx, { prompt: 'test', size: '1024x1024', dry_run: true }, exec, pluginConfig(root, 'https://api.sublyx.org'))
    assert.equal(result.status, 'dry-run')
    assert.equal(result.model, 'gpt-image-2')
    assert.equal(result.provider, 'sublyx')
    assert.equal(result.paidRequestsStarted, 0)
    assert.equal(result.dryRunPlan[0].endpoint, 'https://api.sublyx.org/v1/images/generations')
    assert.ok(!JSON.stringify(result).match(/Authorization|Bearer sk-/))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a full generation request against a local mock saves the returned image', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sublyx-image-request-'))
  const requests = []
  const server = createServer(async (request, response) => {
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    requests.push({ url: request.url, authorization: request.headers.authorization, body: Buffer.concat(chunks).toString('utf8') })
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ data: [{ b64_json: PNG }] }))
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const address = server.address()
    const apiBaseUrl = `http://127.0.0.1:${address.port}`
    await saveStoredConfig({ apiKey: 'unit-test-key-local-only', defaultModel: 'gpt-image-2' }, join(root, 'config.json'))
    const { ctx, exec } = fakeRuntime()
    const result = await runImageGeneration(ctx, { prompt: 'a mock image' }, exec, pluginConfig(root, apiBaseUrl))
    assert.equal(result.status, 'completed')
    assert.equal(result.images.length, 1)
    assert.deepEqual(await readFile(result.images[0].path), Buffer.from(PNG, 'base64'))
    assert.equal(requests[0].url, '/v1/images/generations')
    assert.equal(requests[0].authorization, 'Bearer unit-test-key-local-only')
    assert.equal(JSON.parse(requests[0].body).size, '1024x1024')
  } finally {
    await new Promise((resolve) => server.close(resolve))
    await rm(root, { recursive: true, force: true })
  }
})

test('edit dry-run uses image and mask fields and rejects a mask without input_image', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sublyx-image-edit-'))
  try {
    const imagePath = join(root, 'input.png')
    const maskPath = join(root, 'mask.png')
    await writeFile(imagePath, Buffer.from(PNG, 'base64'))
    await writeFile(maskPath, Buffer.from(PNG, 'base64'))
    const { ctx, exec } = fakeRuntime()
    const config = pluginConfig(root, 'https://api.sublyx.org')
    const result = await runImageGeneration(ctx, {
      prompt: 'edit',
      input_image: imagePath,
      mask: maskPath,
      dry_run: true,
    }, exec, config)
    assert.equal(result.mode, 'edit')
    assert.equal(result.dryRunPlan[0].endpoint, 'https://api.sublyx.org/v1/images/edits')
    assert.equal(result.dryRunPlan[0].body.image.name, 'input.png')
    assert.equal(result.dryRunPlan[0].body.mask.name, 'mask.png')
    await assert.rejects(
      () => runImageGeneration(ctx, { prompt: 'edit', mask: maskPath, dry_run: true }, exec, config),
      /mask requires input_image/,
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('insecure API base URLs require an explicit deployment opt-in', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sublyx-image-insecure-url-'))
  try {
    const { ctx, exec } = fakeRuntime()
    const config = pluginConfig(root, 'http://example.test')
    config.allowInsecureApiBaseUrl = false
    await assert.rejects(
      () => runImageGeneration(ctx, { prompt: 'test', dry_run: true }, exec, config),
      /must use HTTPS/,
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
