import test from 'node:test'
import assert from 'node:assert/strict'
import { extractImageCandidates, sanitizedResponseText } from '../src/responses.js'
import { decodeBase64Image } from '../src/files.js'

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z5ZkAAAAASUVORK5CYII='

test('response parser accepts Sublyx image fields, inline data, and markdown fallbacks', () => {
  assert.deepEqual(extractImageCandidates({ data: [{ b64_json: PNG }] })[0], {
    kind: 'base64', data: PNG, mediaType: 'image/png', source: 'data[0]:b64_json',
  })
  const inline = extractImageCandidates({ choices: [{ message: { content: [{ inline_data: { mime_type: 'image/webp', data: PNG } }] } }] })
  assert.equal(inline[0].mediaType, 'image/webp')
  assert.equal(extractImageCandidates({ data: [{ image: PNG }] })[0].source, 'data[0]:image')
  assert.equal(extractImageCandidates({ data: [{ base64: PNG }] })[0].source, 'data[0]:base64')
  const markdown = extractImageCandidates({ choices: [{ message: { content: `![result](data:image/png;base64,${PNG})` } }] })
  assert.equal(markdown[0].kind, 'base64')
})

test('response summaries remove embedded image bytes', () => {
  const summary = sanitizedResponseText({ choices: [{ message: { content: `data:image/png;base64,${PNG}` } }] })
  assert.match(summary, /omitted/)
  assert.ok(!summary.includes(PNG))
})

test('non-image Base64 is rejected before it can be saved as an image', () => {
  assert.throws(() => decodeBase64Image(Buffer.from('not an image').toString('base64')), /not a supported/)
})
