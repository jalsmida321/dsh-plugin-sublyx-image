import { normalizeImageMediaType } from './files.js'

const MAX_CANDIDATES = 8

function fingerprint(candidate) {
  if (candidate.kind === 'url') return `url:${candidate.url}`
  const data = candidate.data || ''
  return `base64:${candidate.mediaType}:${data.length}:${data.slice(0, 64)}:${data.slice(-64)}`
}

function addCandidate(target, candidate) {
  if (!candidate || target.length >= MAX_CANDIDATES) return
  const key = fingerprint(candidate)
  if (target.some((item) => fingerprint(item) === key)) return
  target.push(candidate)
}

function addUrlOrData(target, value, source) {
  if (typeof value !== 'string') return
  const trimmed = value.trim()
  const dataMatch = /^data:(image\/(?:png|jpeg|jpg|webp|gif));base64,([a-z0-9+/=_\s-]+)$/i.exec(trimmed)
  if (dataMatch) {
    addCandidate(target, { kind: 'base64', data: dataMatch[2], mediaType: normalizeImageMediaType(dataMatch[1]), source })
    return
  }
  if (/^https:\/\//i.test(trimmed)) addCandidate(target, { kind: 'url', url: trimmed, source })
}

function collectObject(target, value, source, depth, seen) {
  if (target.length >= MAX_CANDIDATES || depth > 9 || value === null || value === undefined) return
  if (typeof value === 'string') {
    const direct = value.trim()
    addUrlOrData(target, direct, source)
    if (direct.length <= 128 * 1024 * 1024) {
      const dataUri = /data:image\/(?:png|jpeg|jpg|webp|gif);base64,[a-z0-9+/=_\s-]+/gi
      for (const match of direct.matchAll(dataUri)) addUrlOrData(target, match[0], `${source}:text-data-uri`)
      const markdown = /!\[[^\]]*\]\((https:\/\/[^\s)]+)\)/gi
      for (const match of direct.matchAll(markdown)) addUrlOrData(target, match[1], `${source}:markdown`)
    }
    return
  }
  if (typeof value !== 'object') return
  if (seen.has(value)) return
  seen.add(value)
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) collectObject(target, item, `${source}[${index}]`, depth + 1, seen)
    return
  }

  if (typeof value.b64_json === 'string') addCandidate(target, { kind: 'base64', data: value.b64_json, mediaType: 'image/png', source: `${source}:b64_json` })
  for (const key of ['image', 'base64']) {
    if (typeof value[key] !== 'string') continue
    const parsed = value[key].trim()
    const before = target.length
    addUrlOrData(target, parsed, `${source}:${key}`)
    if (target.length === before && /^[a-z0-9+/=_\s-]+$/i.test(parsed)) {
      addCandidate(target, { kind: 'base64', data: parsed, mediaType: 'image/png', source: `${source}:${key}` })
    }
  }
  const inline = value.inline_data || value.inlineData
  if (inline && typeof inline.data === 'string') {
    addCandidate(target, {
      kind: 'base64',
      data: inline.data,
      mediaType: normalizeImageMediaType(inline.mime_type || inline.mimeType),
      source: `${source}:inline_data`,
    })
  }
  addUrlOrData(target, value.image_url?.url || value.imageUrl?.url, `${source}:image_url`)
  if ((value.type === 'image_url' || value.type === 'image') && typeof value.url === 'string') addUrlOrData(target, value.url, `${source}:url`)

  for (const [key, item] of Object.entries(value)) {
    if (key === 'b64_json' || key === 'image' || key === 'base64' || key === 'inline_data' || key === 'inlineData' || key === 'image_url' || key === 'imageUrl') continue
    collectObject(target, item, `${source}.${key}`, depth + 1, seen)
  }
}

export function extractImageCandidates(payload) {
  const candidates = []
  const entries = Array.isArray(payload?.data) ? payload.data : []
  for (const [index, entry] of entries.entries()) collectObject(candidates, entry, `data[${index}]`, 0, new Set())
  if (candidates.length > 0) return candidates
  collectObject(candidates, payload, 'response', 0, new Set())
  return candidates
}

export function sanitizedResponseText(payload, maxChars = 2000) {
  const text = JSON.stringify(payload, (key, value) => {
    if (key === 'b64_json' || key === 'data' && typeof value === 'string' && value.length > 4096) return '<binary omitted>'
    if (typeof value === 'string' && value.startsWith('data:image/')) return '<image data URI omitted>'
    return value
  })
  return String(text || '').slice(0, maxChars)
}
