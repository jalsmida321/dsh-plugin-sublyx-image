import test from 'node:test'
import assert from 'node:assert/strict'
import {
  FACTORY_DEFAULT_MODEL,
  FACTORY_DEFAULT_SIZE,
  normalizeModelId,
  normalizeSize,
  publicModelCatalog,
  resolveModelOptions,
} from '../src/models.js'

test('catalog exposes the Sublyx model verified on 2026-08-31', () => {
  assert.equal(FACTORY_DEFAULT_MODEL, 'gpt-image-2')
  assert.equal(FACTORY_DEFAULT_SIZE, '1024x1024')
  assert.deepEqual(publicModelCatalog().map((model) => model.id), ['gpt-image-2'])
})

test('model identifiers remain future-compatible but reject unsafe values', () => {
  assert.equal(normalizeModelId('gpt-image-2'), 'gpt-image-2')
  assert.equal(normalizeModelId('future/image:model-1'), 'future/image:model-1')
  assert.throws(() => normalizeModelId('bad model'), /Invalid model/)
})

test('model and size defaults resolve deterministically', () => {
  const defaults = resolveModelOptions({ defaultModel: 'gpt-image-2' })
  assert.equal(defaults.model, 'gpt-image-2')
  assert.equal(defaults.size, '1024x1024')
  assert.equal(defaults.usedSavedDefault, true)

  const explicit = resolveModelOptions({
    model: 'gpt-image-future',
    defaultModel: 'gpt-image-2',
    size: '1536x1024',
  })
  assert.equal(explicit.model, 'gpt-image-future')
  assert.equal(explicit.size, '1536x1024')
  assert.equal(explicit.usedSavedDefault, false)
  assert.equal(normalizeSize('01024x01024'), '1024x1024')
  assert.throws(() => normalizeSize('square'), /WIDTHxHEIGHT/)
  assert.throws(() => normalizeSize('128x128'), /between 256 and 8192/)
})
