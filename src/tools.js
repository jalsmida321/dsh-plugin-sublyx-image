import { defineTool } from '@deepseek-ai/dsh-tools'
import { clearApiKey, configSummary, loadStoredConfig, setApiKey, setDefaultModel } from './config.js'
import { publicModelCatalog } from './models.js'
import { runImageGeneration } from './run.js'

const IMAGE_RESULT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    path: { type: 'string', required: true },
    mediaType: { type: 'string', required: true },
    bytes: { type: 'integer', required: true },
    sha256: { type: 'string', required: true },
    requestIndex: { type: 'integer', required: true },
    source: { type: 'string', required: true },
    inline: { type: 'boolean', required: true },
    attachmentId: { type: 'string' },
    width: { type: 'integer' },
    height: { type: 'integer' },
    originalDimensions: {
      type: 'object',
      additionalProperties: false,
      properties: {
        width: { type: 'integer', required: true },
        height: { type: 'integer', required: true },
      },
    },
    attachmentError: { type: 'string' },
  },
}

const GENERATION_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    status: { type: 'string', enum: ['dry-run', 'completed', 'partial'], required: true },
    mode: { type: 'string', enum: ['generation', 'edit'], required: true },
    model: { type: 'string', required: true },
    provider: { type: 'string', required: true },
    protocol: { type: 'string', required: true },
    usedSavedDefault: { type: 'boolean', required: true },
    savedDefaultModel: { type: 'string', required: true },
    size: { type: 'string', required: true },
    outputDir: { type: 'string', required: true },
    paidRequestsPlanned: { type: 'integer', required: true },
    paidRequestsStarted: { type: 'integer', required: true },
    images: { type: 'array', required: true, items: IMAGE_RESULT_SCHEMA },
    failure: { type: 'json', required: true },
    dryRunPlan: { type: 'json', required: true },
  },
}

function generationContent(value) {
  const summary = [
    `<status>${value.status}</status>`,
    `<model>${value.model}</model>`,
    `<provider>${value.provider}</provider>`,
    `<mode>${value.mode}</mode>`,
    `<size>${value.size}</size>`,
    `<requests started="${value.paidRequestsStarted}" planned="${value.paidRequestsPlanned}" />`,
  ]
  for (const image of value.images) {
    summary.push(`<image path="${image.path}" mediaType="${image.mediaType}" bytes="${image.bytes}"${image.width ? ` width="${image.width}" height="${image.height}"` : ''} />`)
  }
  if (value.failure) summary.push(`<failure noAutoRetry="${Boolean(value.failure.noAutoRetry)}">${value.failure.message}</failure>`)
  if (value.status === 'dry-run') summary.push(`<dry-run>${JSON.stringify(value.dryRunPlan)}</dry-run>`)
  const content = [{ type: 'text', text: summary.join('\n') }]
  for (const image of value.images) {
    if (!image.inline || !image.attachmentId || !image.width || !image.height) continue
    content.push({
      type: 'image',
      attachment: {
        attachmentId: image.attachmentId,
        mediaType: image.mediaType,
        bytes: image.bytes,
        width: image.width,
        height: image.height,
        name: image.path.split(/[\\/]/).at(-1),
        ...(image.originalDimensions ? { originalDimensions: image.originalDimensions } : {}),
      },
    })
  }
  return content
}

function configContent(value) {
  const lines = [
    `Action: ${value.action}`,
    `Default model: ${value.defaultModel}`,
    `Factory default: ${value.factoryDefaultModel}`,
    `Saved override: ${value.savedDefaultModel || '(none)'}`,
    `Sublyx API Key configured: ${value.hasApiKey ? 'yes' : 'no'}`,
    `Config path: ${value.configPath}`,
  ]
  if (value.changed) lines.push('The persistent default model was updated.')
  if (value.action === 'list') {
    for (const model of value.models) lines.push(`- ${model.id}: ${model.label} (${model.protocol})`)
  }
  return [{ type: 'text', text: lines.join('\n') }]
}

function keyContent(value) {
  return [{
    type: 'text',
    text: [
      `Action: ${value.action}`,
      `Sublyx API Key configured: ${value.hasApiKey ? 'yes' : 'no'}`,
      `Key preview: ${value.apiKeyPreview || '(none)'}`,
      `Config path: ${value.configPath}`,
      value.securityNotice,
    ].join('\n'),
  }]
}

export function registerTools(ctx, pluginConfig) {
  ctx.tools.register(defineTool({
    name: 'image_generate_sublyx',
    description: 'Generate or edit raster images through api.sublyx.org using the OpenAI Images API. '
      + 'The verified model is gpt-image-2. Omit model to use the persistent default exactly. '
      + 'Provide input_image to edit one image and optionally provide a mask. Each count or prompts item is a separate paid request. '
      + 'Use dry_run to validate the sanitized request without a Key or paid API call. Never automatically retry a NO-AUTO-RETRY failure.',
    parameters: {
      prompt: { type: 'string', description: 'One complete generation or edit instruction. Use either prompt or prompts, not both.' },
      prompts: { type: 'array', items: { type: 'string' }, description: 'Different instructions submitted sequentially; each item is a separate paid request.' },
      model: { type: 'string', description: 'One-time model identifier. Omit to use the saved default without changing it.' },
      size: { type: 'string', description: 'Output size as WIDTHxHEIGHT. Defaults to 1024x1024; upstream support is model-dependent.' },
      count: { type: 'integer', description: 'Repeat one prompt 1-4 times. Each output is an independent paid request.' },
      input_image: { type: 'string', description: 'Local PNG/JPEG/WebP/GIF path. When present, the request uses /v1/images/edits.' },
      mask: { type: 'string', description: 'Optional local mask path for editing; requires input_image.' },
      output_dir: { type: 'string', description: 'Absolute or workspace-relative directory for saved images.' },
      attach_results: { type: 'boolean', description: 'Attach generated images when the active DSH model accepts image input.' },
      dry_run: { type: 'boolean', description: 'Build a sanitized request plan without reading the Key or calling the API.' },
    },
    output: {
      schema: GENERATION_OUTPUT_SCHEMA,
      render: (_args, value) => generationContent(value),
    },
    timeoutMs: pluginConfig.toolTimeoutMs,
    async execute(args, exec) {
      return runImageGeneration(ctx, args, exec, pluginConfig)
    },
    presentCall(args) {
      return { card: 'generic', title: `Generate image with ${args.model || 'saved Sublyx default'}`, kind: 'write' }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'image_model_sublyx',
    description: 'Inspect the verified Sublyx image model catalog or persistent default. '
      + 'Call set_default only when the user explicitly asks to change the long-term default. '
      + 'The catalog is a compatibility baseline, while api.sublyx.org may add or remove models over time.',
    parameters: {
      action: { type: 'string', enum: ['get', 'list', 'set_default'], required: true },
      model: { type: 'string', description: 'Required only for set_default.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          action: { type: 'string', required: true },
          configPath: { type: 'string', required: true },
          hasApiKey: { type: 'boolean', required: true },
          apiKeyPreview: { type: 'json', required: true },
          defaultModel: { type: 'string', required: true },
          savedDefaultModel: { type: 'json', required: true },
          factoryDefaultModel: { type: 'string', required: true },
          changed: { type: 'boolean', required: true },
          models: { type: 'array', required: true, items: { type: 'object', additionalProperties: true } },
        },
      },
      render: (_args, value) => configContent(value),
    },
    async execute(args) {
      if (args.action === 'set_default' && !args.model) throw new Error('model is required for set_default')
      if (args.action !== 'set_default' && args.model) throw new Error('model is accepted only with set_default')
      if (args.action === 'set_default') await setDefaultModel(args.model, pluginConfig.configPath)
      const stored = await loadStoredConfig(pluginConfig.configPath)
      const summary = configSummary(stored, {
        configPath: pluginConfig.configPath,
        factoryDefaultModel: pluginConfig.factoryDefaultModel,
      })
      return {
        action: args.action,
        configPath: summary.configPath,
        hasApiKey: summary.hasApiKey,
        apiKeyPreview: summary.apiKeyPreview,
        defaultModel: summary.defaultModel,
        savedDefaultModel: summary.savedDefaultModel,
        factoryDefaultModel: summary.factoryDefaultModel,
        changed: args.action === 'set_default',
        models: args.action === 'list' ? publicModelCatalog() : [],
      }
    },
    presentCall(args) {
      return { card: 'generic', title: args.action === 'set_default' ? `Set Sublyx default to ${args.model}` : 'Inspect Sublyx image models', kind: 'read' }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'image_key_sublyx',
    description: 'Configure the Sublyx API Key only when the user explicitly asks. '
      + 'For action=set, save the supplied Key and never repeat the complete Key; report only the masked preview. '
      + 'Warn that a Key sent through chat may remain in conversation and tool-call history. The safer method is '
      + '`dsh plugin --profile web exec sublyx-image set-key`: run the whole command unchanged, press Enter, '
      + 'wait for the separate `Sublyx API Key:` prompt, then paste the Key and press Enter. Input is hidden. '
      + 'For a Chinese user, say: “整条命令里没有 Key，不要把任何一段替换成 Key。先运行整条命令，看到单独的 Sublyx API Key: 提示后，再粘贴 Key 并按回车。”',
    parameters: {
      action: { type: 'string', enum: ['get', 'set', 'clear'], required: true },
      key: { type: 'string', description: 'Required only for set. Sensitive: it may remain in DSH history.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          action: { type: 'string', required: true },
          configPath: { type: 'string', required: true },
          hasApiKey: { type: 'boolean', required: true },
          apiKeyPreview: { type: 'json', required: true },
          changed: { type: 'boolean', required: true },
          securityNotice: { type: 'string', required: true },
        },
      },
      render: (_args, value) => keyContent(value),
    },
    async execute(args) {
      if (args.action === 'set' && !args.key) throw new Error('key is required for action=set')
      if (args.action !== 'set' && args.key) throw new Error('key is accepted only for action=set')
      if (args.action === 'set') await setApiKey(args.key, pluginConfig.configPath)
      if (args.action === 'clear') await clearApiKey(pluginConfig.configPath)
      const stored = await loadStoredConfig(pluginConfig.configPath)
      const summary = configSummary(stored, {
        configPath: pluginConfig.configPath,
        factoryDefaultModel: pluginConfig.factoryDefaultModel,
      })
      return {
        action: args.action,
        configPath: summary.configPath,
        hasApiKey: summary.hasApiKey,
        apiKeyPreview: summary.apiKeyPreview,
        changed: args.action === 'set' || args.action === 'clear',
        securityNotice: args.action === 'set'
          ? 'Key saved. Do not repeat the complete Key; show only the masked preview. A Key sent through chat may remain in history.'
          : 'The safer setup method uses hidden terminal input through the sublyx-image set-key command.',
      }
    },
    presentCall(args) {
      const title = args.action === 'set' ? 'Save Sublyx API Key' : args.action === 'clear' ? 'Clear Sublyx API Key' : 'Check Sublyx API Key'
      return { card: 'generic', title, kind: args.action === 'get' ? 'read' : 'write' }
    },
  }))
}
