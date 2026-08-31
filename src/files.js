import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { basename, extname, join, resolve } from 'node:path'

export const SUPPORTED_IMAGE_MEDIA_TYPES = Object.freeze([
  'image/png', 'image/jpeg', 'image/webp', 'image/gif',
])

export function normalizeImageMediaType(value) {
  const input = String(value || '').toLowerCase()
  if (input.includes('jpeg') || input.includes('jpg')) return 'image/jpeg'
  if (input.includes('webp')) return 'image/webp'
  if (input.includes('gif')) return 'image/gif'
  return 'image/png'
}

export function extensionForMediaType(mediaType) {
  if (mediaType === 'image/jpeg') return 'jpg'
  if (mediaType === 'image/webp') return 'webp'
  if (mediaType === 'image/gif') return 'gif'
  return 'png'
}

export function mediaTypeFromPath(filePath) {
  const extension = extname(filePath).toLowerCase()
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg'
  if (extension === '.webp') return 'image/webp'
  if (extension === '.gif') return 'image/gif'
  if (extension === '.png') return 'image/png'
  throw new Error(`Unsupported reference image extension "${extension || '(none)'}" for ${filePath}`)
}

export function sniffImageMediaType(buffer) {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png'
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg'
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp'
  if (buffer.length >= 6 && ['GIF87a', 'GIF89a'].includes(buffer.subarray(0, 6).toString('ascii'))) return 'image/gif'
  return null
}

export function detectImageMediaType(buffer, fallback = 'image/png') {
  return sniffImageMediaType(buffer) || normalizeImageMediaType(fallback)
}

export async function loadReferenceImages(paths, { maxCount = 10, maxBytes = 20 * 1024 * 1024 } = {}) {
  const inputs = Array.isArray(paths) ? paths : []
  if (inputs.length > maxCount) throw new Error(`At most ${maxCount} reference images are supported`)
  const references = []
  let totalBytes = 0
  for (const input of inputs) {
    const path = resolve(String(input))
    const info = await stat(path).catch(() => null)
    if (!info?.isFile()) throw new Error(`Reference image does not exist or is not a regular file: ${path}`)
    const declaredMediaType = mediaTypeFromPath(path)
    const data = await readFile(path)
    totalBytes += data.length
    if (totalBytes > maxBytes) throw new Error(`Reference images exceed the ${Math.round(maxBytes / 1024 / 1024)} MB aggregate limit`)
    const detectedMediaType = sniffImageMediaType(data)
    if (!detectedMediaType) throw new Error(`Reference image bytes are not a supported PNG/JPEG/WebP/GIF file: ${path}`)
    if (detectedMediaType !== declaredMediaType) {
      throw new Error(`Reference image extension and content disagree: ${path} declares ${declaredMediaType}, bytes are ${detectedMediaType}`)
    }
    references.push({ path, name: basename(path), mediaType: detectedMediaType, data, bytes: data.length })
  }
  return references
}

export function referenceAsDataUri(reference, { redact = false } = {}) {
  const encoded = redact ? `<omitted ${reference.bytes} bytes>` : reference.data.toString('base64')
  return `data:${reference.mediaType};base64,${encoded}`
}

export function decodeBase64Image(data, mediaType = 'image/png') {
  const normalized = String(data || '').replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/')
  if (!normalized || normalized.length > 128 * 1024 * 1024) throw new Error('Image Base64 payload is empty or exceeds the local safety limit')
  const buffer = Buffer.from(normalized, 'base64')
  if (!buffer.length) throw new Error('Image Base64 payload decoded to an empty file')
  const detectedMediaType = sniffImageMediaType(buffer)
  if (!detectedMediaType) throw new Error('Image Base64 payload is not a supported PNG/JPEG/WebP/GIF file')
  return { buffer, mediaType: detectedMediaType }
}

export function parseImageDataUri(value) {
  const match = /^data:(image\/(?:png|jpeg|jpg|webp|gif));base64,([a-z0-9+/=_\s-]+)$/i.exec(String(value || '').trim())
  if (!match) return null
  const decoded = decodeBase64Image(match[2], normalizeImageMediaType(match[1]))
  return { ...decoded, source: 'data-uri' }
}

export function imageHash(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

function safeModelFragment(model) {
  return String(model || 'image').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'image'
}

export async function saveImageBuffer(buffer, mediaType, outputDir, { model, requestIndex = 1, imageIndex = 1 } = {}) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw new Error('Cannot save an empty image')
  const actualMediaType = sniffImageMediaType(buffer)
  if (!actualMediaType) throw new Error('Refusing to save bytes that are not a supported PNG/JPEG/WebP/GIF image')
  const directory = resolve(outputDir)
  await mkdir(directory, { recursive: true })
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
  const extension = extensionForMediaType(actualMediaType)
  const filename = `${stamp}_${safeModelFragment(model)}_${requestIndex}-${imageIndex}_${randomUUID().slice(0, 8)}.${extension}`
  const finalPath = join(directory, filename)
  const temporaryPath = join(directory, `.${filename}.${process.pid}.tmp`)
  await writeFile(temporaryPath, buffer, { flag: 'wx' })
  await rename(temporaryPath, finalPath)
  return {
    path: finalPath,
    mediaType: actualMediaType,
    bytes: buffer.length,
    sha256: imageHash(buffer),
  }
}

export function sanitizedReferenceSummary(references) {
  return references.map(({ path, name, mediaType, bytes }) => ({ path, name, mediaType, bytes, content: '<binary omitted>' }))
}
