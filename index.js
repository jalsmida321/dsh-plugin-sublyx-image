import Schema from '@deepseek-ai/schemastery'
import { defaultConfigPath } from './src/config.js'
import { FACTORY_DEFAULT_MODEL } from './src/models.js'
import { registerTools } from './src/tools.js'

export const name = 'sublyx-image'
export const inject = ['tools']

export const Config = Schema.object({
  apiBaseUrl: Schema.string().default('https://api.sublyx.org'),
  allowInsecureApiBaseUrl: Schema.boolean().default(false),
  configPath: Schema.string().default(defaultConfigPath()),
  outputDir: Schema.string().default(''),
  factoryDefaultModel: Schema.string().default(FACTORY_DEFAULT_MODEL),
  factoryDefaultSize: Schema.string().default('1024x1024'),
  requestTimeoutMs: Schema.number().default(600_000),
  toolTimeoutMs: Schema.number().default(1_260_000),
  maxResponseBytes: Schema.number().default(128 * 1024 * 1024),
  maxReferenceBytes: Schema.number().default(20 * 1024 * 1024),
  maxCount: Schema.number().default(4),
  maxBatchRequests: Schema.number().default(20),
  maxImagesPerResponse: Schema.number().default(4),
  attachResults: Schema.boolean().default(true),
})

export function apply(ctx, config) {
  registerTools(ctx, config)
}
