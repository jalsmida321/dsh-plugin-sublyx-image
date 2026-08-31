import { requestJson, requestMultipart } from '../http.js'
import { extractImageCandidates } from '../responses.js'

function endpoint(apiBaseUrl, editing) {
  return `${String(apiBaseUrl).replace(/\/+$/, '')}/v1/images/${editing ? 'edits' : 'generations'}`
}

export function buildImagesGenerationBody({ model, prompt, size }) {
  return {
    model,
    prompt: prompt.trim(),
    size,
    n: 1,
  }
}

export function buildImagesEditForm({ model, prompt, size }, inputImage, mask, { redact = false } = {}) {
  const form = new FormData()
  form.append('model', model)
  form.append('prompt', prompt.trim())
  form.append('size', size)
  form.append('n', '1')
  const inputData = redact ? Buffer.from(`<omitted ${inputImage.bytes} bytes>`) : inputImage.data
  form.append('image', new Blob([inputData], { type: inputImage.mediaType }), inputImage.name)
  if (mask) {
    const maskData = redact ? Buffer.from(`<omitted ${mask.bytes} bytes>`) : mask.data
    form.append('mask', new Blob([maskData], { type: mask.mediaType }), mask.name)
  }
  return form
}

function fileSummary(reference) {
  return reference
    ? { name: reference.name, mediaType: reference.mediaType, bytes: reference.bytes, content: '<binary omitted>' }
    : undefined
}

export function buildImagesDryRun(options, inputImage, mask) {
  const editing = Boolean(inputImage)
  return {
    method: 'POST',
    protocol: 'OpenAI Images API',
    endpoint: endpoint(options.apiBaseUrl, editing),
    body: editing
      ? {
          model: options.model,
          prompt: options.prompt.trim(),
          size: options.size,
          n: 1,
          image: fileSummary(inputImage),
          ...(mask ? { mask: fileSummary(mask) } : {}),
        }
      : buildImagesGenerationBody(options),
  }
}

export async function requestImagesProvider(options, inputImage, mask) {
  const editing = Boolean(inputImage)
  const url = endpoint(options.apiBaseUrl, editing)
  const payload = editing
    ? await requestMultipart({
        url,
        apiKey: options.apiKey,
        form: buildImagesEditForm(options, inputImage, mask),
        signal: options.signal,
        timeoutMs: options.timeoutMs,
        maxResponseBytes: options.maxResponseBytes,
      })
    : await requestJson({
        url,
        apiKey: options.apiKey,
        body: buildImagesGenerationBody(options),
        signal: options.signal,
        timeoutMs: options.timeoutMs,
        maxResponseBytes: options.maxResponseBytes,
      })
  return { payload, candidates: extractImageCandidates(payload), endpoint: url }
}

