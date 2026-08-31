import test from 'node:test'
import assert from 'node:assert/strict'
import { buildImagesDryRun, buildImagesEditForm, buildImagesGenerationBody } from '../src/providers/images.js'

const image = {
  name: 'input.png',
  mediaType: 'image/png',
  data: Buffer.from('89504e470d0a1a0a', 'hex'),
  bytes: 8,
}

const mask = {
  name: 'mask.png',
  mediaType: 'image/png',
  data: Buffer.from('89504e470d0a1a0a', 'hex'),
  bytes: 8,
}

test('generation builder uses the Sublyx OpenAI Images contract', () => {
  const body = buildImagesGenerationBody({ model: 'gpt-image-2', prompt: 'A city', size: '1024x1024' })
  assert.deepEqual(body, { model: 'gpt-image-2', prompt: 'A city', size: '1024x1024', n: 1 })
})

test('edit builder uses one image field and an optional mask', () => {
  const form = buildImagesEditForm({ model: 'gpt-image-2', prompt: 'Edit it', size: '1024x1024' }, image, mask)
  assert.equal(form.get('model'), 'gpt-image-2')
  assert.equal(form.get('size'), '1024x1024')
  assert.equal(form.getAll('image').length, 1)
  assert.equal(form.getAll('mask').length, 1)
  assert.equal(form.getAll('image[]').length, 0)
})

test('dry-run redacts local image bytes', () => {
  const plan = buildImagesDryRun({
    apiBaseUrl: 'https://api.sublyx.org',
    model: 'gpt-image-2',
    prompt: 'Edit it',
    size: '1024x1024',
  }, image, mask)
  assert.equal(plan.endpoint, 'https://api.sublyx.org/v1/images/edits')
  assert.equal(plan.body.image.content, '<binary omitted>')
  assert.equal(plan.body.mask.content, '<binary omitted>')
  assert.ok(!JSON.stringify(plan).includes(image.data.toString('base64')))
})
