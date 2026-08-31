import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { FACTORY_DEFAULT_MODEL, normalizeModelId } from './models.js'

export const CONFIG_SCHEMA_VERSION = 1

export function defaultConfigPath() {
  const overridden = String(process.env.DSH_SUBLYX_IMAGE_CONFIG_PATH || '').trim()
  return overridden ? resolve(overridden) : join(homedir(), '.dsh', 'sublyx-image', 'config.json')
}

export function defaultOutputDir() {
  const overridden = String(process.env.DSH_SUBLYX_IMAGE_OUTPUT_DIR || '').trim()
  return overridden ? resolve(overridden) : join(homedir(), 'Pictures', 'sublyx-image')
}

function normalizeStoredConfig(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {}
  let defaultModel
  try {
    defaultModel = source.defaultModel ? normalizeModelId(source.defaultModel) : undefined
  } catch {
    defaultModel = undefined
  }
  return {
    schemaVersion: CONFIG_SCHEMA_VERSION,
    apiKey: typeof source.apiKey === 'string' ? source.apiKey.trim() : '',
    ...(defaultModel ? { defaultModel } : {}),
    ...(typeof source.updatedAt === 'string' ? { updatedAt: source.updatedAt } : {}),
  }
}

export async function loadStoredConfig(configPath = defaultConfigPath()) {
  try {
    const raw = await readFile(configPath, 'utf8')
    return normalizeStoredConfig(JSON.parse(raw))
  } catch (error) {
    if (error?.code === 'ENOENT') return normalizeStoredConfig({})
    throw new Error(`Cannot read Sublyx image configuration at ${configPath}: ${error?.message || String(error)}`, { cause: error })
  }
}

export async function saveStoredConfig(config, configPath = defaultConfigPath()) {
  const normalized = normalizeStoredConfig({ ...config, updatedAt: new Date().toISOString() })
  const parent = dirname(configPath)
  await mkdir(parent, { recursive: true })
  const temporary = join(parent, `.config-${process.pid}-${randomUUID()}.tmp`)
  try {
    await writeFile(temporary, `${JSON.stringify(normalized, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
    await rename(temporary, configPath)
    await chmod(configPath, 0o600).catch(() => {})
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => {})
    throw error
  }
  return normalized
}

export function resolveApiKey(config) {
  return String(process.env.SUBLYX_API_KEY || process.env.SUBLYX_IMAGE_API_KEY || config?.apiKey || '').trim()
}

export async function setApiKey(apiKey, configPath = defaultConfigPath()) {
  const key = String(apiKey || '').trim()
  if (key.length < 10) throw new Error('Sublyx API Key is empty or unexpectedly short')
  const current = await loadStoredConfig(configPath)
  return saveStoredConfig({ ...current, apiKey: key }, configPath)
}

export async function clearApiKey(configPath = defaultConfigPath()) {
  const current = await loadStoredConfig(configPath)
  return saveStoredConfig({ ...current, apiKey: '' }, configPath)
}

export async function setDefaultModel(model, configPath = defaultConfigPath()) {
  const current = await loadStoredConfig(configPath)
  return saveStoredConfig({ ...current, defaultModel: normalizeModelId(model) }, configPath)
}

export function maskApiKey(key) {
  const value = String(key || '')
  if (!value) return null
  if (value.length <= 10) return `${value.slice(0, 2)}***`
  return `${value.slice(0, 6)}...${value.slice(-4)}`
}

export function configSummary(config, {
  configPath = defaultConfigPath(),
  factoryDefaultModel = FACTORY_DEFAULT_MODEL,
} = {}) {
  const key = resolveApiKey(config)
  const savedDefaultModel = config?.defaultModel ? normalizeModelId(config.defaultModel) : null
  return {
    configPath,
    hasApiKey: Boolean(key),
    apiKeyPreview: maskApiKey(key),
    apiKeySource: process.env.SUBLYX_API_KEY
      ? 'SUBLYX_API_KEY environment variable'
      : (process.env.SUBLYX_IMAGE_API_KEY ? 'SUBLYX_IMAGE_API_KEY environment variable' : (config?.apiKey ? 'config file' : 'not configured')),
    defaultModel: savedDefaultModel || normalizeModelId(factoryDefaultModel),
    savedDefaultModel,
    factoryDefaultModel: normalizeModelId(factoryDefaultModel),
  }
}
