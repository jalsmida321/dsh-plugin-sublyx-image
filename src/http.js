import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])

function combinedSignal(signal, timeoutMs) {
  const timeout = AbortSignal.timeout(timeoutMs)
  return signal ? AbortSignal.any([signal, timeout]) : timeout
}

export async function readResponseBuffer(response, maxBytes) {
  const declared = Number(response.headers.get('content-length') || 0)
  if (declared > maxBytes) throw new Error(`HTTP response exceeds the ${Math.round(maxBytes / 1024 / 1024)} MB safety limit`)
  if (!response.body) return Buffer.alloc(0)
  const chunks = []
  let total = 0
  for await (const chunk of response.body) {
    const buffer = Buffer.from(chunk)
    total += buffer.length
    if (total > maxBytes) throw new Error(`HTTP response exceeded the ${Math.round(maxBytes / 1024 / 1024)} MB safety limit`)
    chunks.push(buffer)
  }
  return Buffer.concat(chunks, total)
}

function safeErrorBody(buffer) {
  const text = buffer.toString('utf8').replace(/data:image\/[^;]+;base64,[a-z0-9+/=_-]+/gi, '<image omitted>')
  try {
    const parsed = JSON.parse(text)
    return String(parsed?.error?.message || parsed?.message || parsed?.error || text).slice(0, 2000)
  } catch {
    return text.slice(0, 2000)
  }
}

export async function requestJson({ url, apiKey, body, signal, timeoutMs, maxResponseBytes }) {
  signal?.throwIfAborted()
  let response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Accept-Encoding': 'identity',
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: combinedSignal(signal, timeoutMs),
    })
  } catch (error) {
    throw new Error(`[NO-AUTO-RETRY] Request state is unknown after the Sublyx submission started: ${error?.message || String(error)}`, { cause: error })
  }
  const raw = await readResponseBuffer(response, maxResponseBytes)
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${safeErrorBody(raw)}`)
  try {
    return raw.length ? JSON.parse(raw.toString('utf8')) : {}
  } catch (error) {
    throw new Error(`[NO-AUTO-RETRY] Sublyx returned a successful status with invalid JSON: ${error?.message || String(error)}`, { cause: error })
  }
}

export async function requestMultipart({ url, apiKey, form, signal, timeoutMs, maxResponseBytes }) {
  signal?.throwIfAborted()
  let response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Accept-Encoding': 'identity',
        Authorization: `Bearer ${apiKey}`,
      },
      body: form,
      signal: combinedSignal(signal, timeoutMs),
    })
  } catch (error) {
    throw new Error(`[NO-AUTO-RETRY] Request state is unknown after the Sublyx submission started: ${error?.message || String(error)}`, { cause: error })
  }
  const raw = await readResponseBuffer(response, maxResponseBytes)
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${safeErrorBody(raw)}`)
  try {
    return raw.length ? JSON.parse(raw.toString('utf8')) : {}
  } catch (error) {
    throw new Error(`[NO-AUTO-RETRY] Sublyx returned a successful status with invalid JSON: ${error?.message || String(error)}`, { cause: error })
  }
}

function isPrivateIpv4(address) {
  const parts = address.split('.').map(Number)
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true
  const [a, b] = parts
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224
}

function isPrivateIpv6(address) {
  const normalized = address.toLowerCase()
  return normalized === '::' || normalized === '::1' || normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe8') || normalized.startsWith('fe9') || normalized.startsWith('fea') || normalized.startsWith('feb')
}

async function assertPublicHttpsUrl(value) {
  const url = new URL(value)
  if (url.protocol !== 'https:') throw new Error(`Refusing non-HTTPS image URL returned by Sublyx: ${url.protocol}`)
  const literalKind = isIP(url.hostname)
  const addresses = literalKind ? [{ address: url.hostname, family: literalKind }] : await lookup(url.hostname, { all: true, verbatim: true })
  if (!addresses.length) throw new Error(`Image URL host did not resolve: ${url.hostname}`)
  for (const entry of addresses) {
    if ((entry.family === 4 && isPrivateIpv4(entry.address)) || (entry.family === 6 && isPrivateIpv6(entry.address))) {
      throw new Error(`Refusing private or local image URL returned by Sublyx: ${url.hostname}`)
    }
  }
  return url
}

export async function downloadRemoteImage({ url, apiKey, apiBaseUrl, signal, timeoutMs, maxBytes, maxRedirects = 3 }) {
  let current = await assertPublicHttpsUrl(url)
  const apiOrigin = new URL(apiBaseUrl).origin
  for (let redirect = 0; redirect <= maxRedirects; redirect += 1) {
    const headers = { Accept: 'image/png,image/jpeg,image/webp,image/gif', 'Accept-Encoding': 'identity' }
    if (current.origin === apiOrigin) headers.Authorization = `Bearer ${apiKey}`
    const response = await fetch(current, {
      method: 'GET',
      headers,
      redirect: 'manual',
      signal: combinedSignal(signal, timeoutMs),
    })
    if (REDIRECT_STATUSES.has(response.status)) {
      if (redirect === maxRedirects) throw new Error('Image download exceeded the redirect limit')
      const location = response.headers.get('location')
      if (!location) throw new Error(`Image download redirect ${response.status} had no Location header`)
      current = await assertPublicHttpsUrl(new URL(location, current).href)
      continue
    }
    const body = await readResponseBuffer(response, maxBytes)
    if (!response.ok) throw new Error(`Image download failed with HTTP ${response.status}: ${safeErrorBody(body)}`)
    return { buffer: body, mediaType: response.headers.get('content-type') || 'image/png', sourceUrl: current.href }
  }
  throw new Error('Image download failed')
}

