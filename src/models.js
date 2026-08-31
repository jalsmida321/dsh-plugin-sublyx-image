export const FACTORY_DEFAULT_MODEL = 'gpt-image-2'
export const FACTORY_DEFAULT_SIZE = '1024x1024'
export const VERIFIED_MODEL_IDS = Object.freeze(['gpt-image-2'])
export const COMMON_SIZES = Object.freeze(['1024x1024', '1536x1024', '1024x1536'])

export function normalizeModelId(value) {
  const model = String(value ?? '').trim()
  if (!model) throw new Error('Model must be a non-empty string')
  if (model.length > 128 || !/^[a-z0-9][a-z0-9._:/-]*$/i.test(model)) {
    throw new Error(`Invalid model identifier "${value}"`)
  }
  return model
}

export function normalizeSize(value, fallback = FACTORY_DEFAULT_SIZE) {
  const size = String(value || fallback).trim().toLowerCase()
  const match = /^(\d{2,5})x(\d{2,5})$/.exec(size)
  if (!match) throw new Error(`Invalid image size "${value}". Expected WIDTHxHEIGHT, for example 1024x1024`)
  const width = Number(match[1])
  const height = Number(match[2])
  if (width < 256 || height < 256 || width > 8192 || height > 8192) {
    throw new Error('Image width and height must each be between 256 and 8192 pixels')
  }
  return `${width}x${height}`
}

export function resolveModelOptions({ model, defaultModel, size, defaultSize }) {
  const effectiveModel = normalizeModelId(model || defaultModel || FACTORY_DEFAULT_MODEL)
  return {
    model: effectiveModel,
    size: normalizeSize(size, defaultSize || FACTORY_DEFAULT_SIZE),
    usedSavedDefault: model === undefined || model === null || String(model).trim() === '',
  }
}

export function publicModelCatalog() {
  return [{
    id: 'gpt-image-2',
    provider: 'sublyx',
    protocol: 'OpenAI Images API',
    label: 'GPT Image 2',
    description: 'Image model returned by the authenticated Sublyx /v1/models endpoint on 2026-08-31.',
    verified: true,
    commonSizes: [...COMMON_SIZES],
  }]
}

