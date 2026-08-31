import { defaultOutputDir, loadStoredConfig, resolveApiKey } from './config.js'
import { decodeBase64Image, loadReferenceImages, saveImageBuffer } from './files.js'
import { downloadRemoteImage } from './http.js'
import { FACTORY_DEFAULT_MODEL, FACTORY_DEFAULT_SIZE, resolveModelOptions } from './models.js'
import { buildImagesDryRun, requestImagesProvider } from './providers/images.js'
import { sanitizedResponseText } from './responses.js'

function integerWithin(value, minimum, maximum, fallback, label) {
  if (value === undefined || value === null) return fallback
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${label} must be an integer from ${minimum} to ${maximum}`)
  }
  return parsed
}

export function resolvePromptTasks(args, { maxCount = 4, maxBatchRequests = 20 } = {}) {
  const hasPrompt = typeof args.prompt === 'string' && args.prompt.trim().length > 0
  const hasPrompts = Array.isArray(args.prompts) && args.prompts.length > 0
  if (hasPrompt === hasPrompts) throw new Error('Provide exactly one of prompt or prompts')
  if (hasPrompt) {
    const count = integerWithin(args.count, 1, maxCount, 1, 'count')
    return Array.from({ length: count }, () => args.prompt.trim())
  }
  if (args.count !== undefined) throw new Error('count cannot be combined with prompts; list each paid request explicitly in prompts')
  if (args.prompts.length > maxBatchRequests) throw new Error(`prompts supports at most ${maxBatchRequests} requests`)
  return args.prompts.map((prompt, index) => {
    const normalized = String(prompt || '').trim()
    if (!normalized) throw new Error(`prompts[${index}] must be a non-empty string`)
    return normalized
  })
}

async function materializeCandidate(candidate, options) {
  if (candidate.kind === 'base64') return decodeBase64Image(candidate.data, candidate.mediaType)
  if (candidate.kind === 'url') {
    return downloadRemoteImage({
      url: candidate.url,
      apiKey: options.apiKey,
      apiBaseUrl: options.apiBaseUrl,
      signal: options.signal,
      timeoutMs: options.timeoutMs,
      maxBytes: options.maxResponseBytes,
    })
  }
  throw new Error(`Unsupported image response candidate: ${candidate.kind}`)
}

async function currentRouteSupportsImages(ctx, exec) {
  try {
    const routed = exec.agent?.session.requestHeader()?.config
    const provider = routed?.provider ?? exec.agent?.options.provider
    const model = routed?.model ?? exec.agent?.options.model
    const llm = ctx.get('llm')
    if (!provider || !model || !llm) return false
    const info = await llm.resolveModelInfo(provider, model, exec.signal)
    return Array.isArray(info?.inputModalities) && info.inputModalities.includes('image')
  } catch {
    return false
  }
}

async function attachSavedImage(ctx, exec, saved, inlineAllowed) {
  const attachments = ctx.get('attachments')
  if (!attachments) return { ...saved, inline: false, attachmentError: 'No DSH attachment service is mounted' }
  if (!attachments.imageLimits?.mediaTypes?.includes(saved.mediaType)) {
    return { ...saved, inline: false, attachmentError: `DSH attachment service does not accept ${saved.mediaType}` }
  }
  try {
    const data = await import('node:fs/promises').then(({ readFile }) => readFile(saved.path))
    const ref = await attachments.saveImage({ data, mediaType: saved.mediaType, name: saved.path.split(/[\\/]/).at(-1) })
    return {
      ...saved,
      inline: inlineAllowed,
      attachmentId: String(ref.attachmentId),
      width: ref.width,
      height: ref.height,
      ...(ref.originalDimensions ? { originalDimensions: { ...ref.originalDimensions } } : {}),
    }
  } catch (error) {
    return { ...saved, inline: false, attachmentError: error?.message || String(error) }
  }
}

export async function runImageGeneration(ctx, args, exec, pluginConfig) {
  let parsedApiBaseUrl
  try {
    parsedApiBaseUrl = new URL(pluginConfig.apiBaseUrl)
  } catch (error) {
    throw new Error(`apiBaseUrl is not a valid absolute URL: ${pluginConfig.apiBaseUrl}`, { cause: error })
  }
  if (parsedApiBaseUrl.protocol !== 'https:' && pluginConfig.allowInsecureApiBaseUrl !== true) {
    throw new Error('apiBaseUrl must use HTTPS unless the deployment explicitly enables allowInsecureApiBaseUrl')
  }
  const stored = await loadStoredConfig(pluginConfig.configPath)
  const factoryDefaultModel = pluginConfig.factoryDefaultModel || FACTORY_DEFAULT_MODEL
  const savedDefaultModel = stored.defaultModel || factoryDefaultModel
  const resolved = resolveModelOptions({
    model: args.model,
    defaultModel: savedDefaultModel,
    size: args.size,
    defaultSize: pluginConfig.factoryDefaultSize || FACTORY_DEFAULT_SIZE,
  })
  const prompts = resolvePromptTasks(args, pluginConfig)
  if (args.mask && !args.input_image) throw new Error('mask requires input_image')
  const references = await loadReferenceImages([args.input_image, args.mask].filter(Boolean), {
    maxCount: 2,
    maxBytes: pluginConfig.maxReferenceBytes,
  })
  const inputImage = args.input_image ? references[0] : null
  const mask = args.mask ? references.at(-1) : null
  const outputDir = args.output_dir || pluginConfig.outputDir || defaultOutputDir()
  const common = {
    apiBaseUrl: pluginConfig.apiBaseUrl,
    model: resolved.model,
    size: resolved.size,
    timeoutMs: pluginConfig.requestTimeoutMs,
    maxResponseBytes: pluginConfig.maxResponseBytes,
    signal: exec.signal,
  }

  if (args.dry_run === true) {
    return {
      status: 'dry-run',
      mode: inputImage ? 'edit' : 'generation',
      model: resolved.model,
      provider: 'sublyx',
      protocol: 'OpenAI Images API',
      usedSavedDefault: resolved.usedSavedDefault,
      savedDefaultModel,
      size: resolved.size,
      outputDir,
      paidRequestsPlanned: prompts.length,
      paidRequestsStarted: 0,
      images: [],
      failure: null,
      dryRunPlan: prompts.map((prompt, index) => ({
        request: index + 1,
        ...buildImagesDryRun({ ...common, prompt }, inputImage, mask),
      })),
    }
  }

  const apiKey = resolveApiKey(stored)
  if (!apiKey) {
    throw new Error(
      'No Sublyx API Key is configured. Explain all three setup steps; do not show only a bare command. '
      + 'Step 1: run the complete command `dsh plugin --profile <profile> exec sublyx-image set-key` unchanged. '
      + 'No part of that command is the Key, and the user must not replace `sublyx-image` or `set-key` with the Key. '
      + 'Step 2: press Enter and wait until the terminal separately displays `Sublyx API Key:`. '
      + 'Step 3: only then paste the real Key and press Enter again; the input is hidden. '
      + 'Beginner method: the user may explicitly send the Key to the Agent and ask it to call image_key_sublyx with action=set, '
      + 'but the Key may then remain in conversation and tool-call history.',
    )
  }
  const inlineAllowed = pluginConfig.attachResults && args.attach_results !== false
    ? await currentRouteSupportsImages(ctx, exec)
    : false
  const shouldAttach = pluginConfig.attachResults && args.attach_results !== false
  const images = []
  let paidRequestsStarted = 0
  let failure = null

  for (const [requestOffset, prompt] of prompts.entries()) {
    exec.signal.throwIfAborted()
    const requestIndex = requestOffset + 1
    paidRequestsStarted += 1
    try {
      const result = await requestImagesProvider({ ...common, apiKey, prompt }, inputImage, mask)
      if (!result.candidates.length) {
        throw new Error(`[NO-AUTO-RETRY] Sublyx accepted request ${requestIndex}, but no image was found in the response: ${sanitizedResponseText(result.payload)}`)
      }
      const requestCandidates = result.candidates.slice(0, pluginConfig.maxImagesPerResponse)
      for (const [imageOffset, candidate] of requestCandidates.entries()) {
        try {
          const materialized = await materializeCandidate(candidate, { ...common, apiKey })
          const saved = await saveImageBuffer(materialized.buffer, materialized.mediaType, outputDir, {
            model: resolved.model,
            requestIndex,
            imageIndex: imageOffset + 1,
          })
          const complete = shouldAttach ? await attachSavedImage(ctx, exec, saved, inlineAllowed) : { ...saved, inline: false }
          images.push({ ...complete, requestIndex, source: candidate.source })
        } catch (error) {
          const message = error?.message || String(error)
          if (/\[NO-(?:AUTO-)?RETRY\]/i.test(message)) throw error
          throw new Error(`[NO-AUTO-RETRY] Sublyx returned an image for request ${requestIndex}, but it could not be saved safely: ${message}`, { cause: error })
        }
      }
    } catch (error) {
      failure = {
        requestIndex,
        message: error?.message || String(error),
        noAutoRetry: /\[NO-(?:AUTO-)?RETRY\]/i.test(error?.message || String(error)),
      }
      if (images.length === 0) throw error
      break
    }
  }

  return {
    status: failure ? 'partial' : 'completed',
    mode: inputImage ? 'edit' : 'generation',
    model: resolved.model,
    provider: 'sublyx',
    protocol: 'OpenAI Images API',
    usedSavedDefault: resolved.usedSavedDefault,
    savedDefaultModel,
    size: resolved.size,
    outputDir,
    paidRequestsPlanned: prompts.length,
    paidRequestsStarted,
    images,
    failure,
    dryRunPlan: null,
  }
}
