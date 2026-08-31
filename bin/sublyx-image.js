#!/usr/bin/env node

import { clearApiKey, configSummary, defaultConfigPath, loadStoredConfig, setApiKey, setDefaultModel } from '../src/config.js'
import { FACTORY_DEFAULT_MODEL, FACTORY_DEFAULT_SIZE, publicModelCatalog } from '../src/models.js'
import { buildImagesGenerationBody } from '../src/providers/images.js'

function help() {
  console.log(`Sublyx Image for DeepSeek Harness

Usage:
  sublyx-image config
  sublyx-image models
  sublyx-image set-key [--stdin]
  sublyx-image clear-key
  sublyx-image set-default <model>
  sublyx-image self-test

The Key is never accepted as a command-line value. Run set-key interactively,
or pipe it to set-key --stdin. SUBLYX_API_KEY and SUBLYX_IMAGE_API_KEY override
the saved Key without writing it to disk.`)
}

async function readAllStdin() {
  const chunks = []
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks).toString('utf8').trim()
}

async function readHidden(prompt) {
  if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== 'function') {
    throw new Error('Interactive hidden input requires a TTY. Pipe the Key to: sublyx-image set-key --stdin')
  }
  process.stdout.write(prompt)
  process.stdin.setRawMode(true)
  process.stdin.resume()
  process.stdin.setEncoding('utf8')
  let value = ''
  return new Promise((resolve, reject) => {
    const finish = (error) => {
      process.stdin.setRawMode(false)
      process.stdin.pause()
      process.stdin.removeListener('data', onData)
      process.stdout.write('\n')
      if (error) reject(error)
      else resolve(value)
    }
    const onData = (character) => {
      if (character === '\u0003') return finish(new Error('Cancelled'))
      if (character === '\r' || character === '\n') return finish()
      if (character === '\u007f' || character === '\b') {
        value = value.slice(0, -1)
        return
      }
      value += character
      process.stdout.write('*')
    }
    process.stdin.on('data', onData)
  })
}

async function selfTest() {
  const body = buildImagesGenerationBody({
    model: FACTORY_DEFAULT_MODEL,
    prompt: 'test',
    size: FACTORY_DEFAULT_SIZE,
  })
  const models = publicModelCatalog()
  const ok = models.some((model) => model.id === FACTORY_DEFAULT_MODEL)
    && body.model === FACTORY_DEFAULT_MODEL
    && body.size === FACTORY_DEFAULT_SIZE
    && body.n === 1
  if (!ok) throw new Error('Self-test assertion failed')
  console.log(JSON.stringify({
    modelCatalog: 'passed',
    imagesApiRequest: 'passed',
    paidApiCalled: false,
  }, null, 2))
}

async function main() {
  const [command = 'help', ...args] = process.argv.slice(2)
  const configPath = defaultConfigPath()
  if (command === 'help' || command === '--help' || command === '-h') return help()
  if (command === 'models') return console.log(JSON.stringify(publicModelCatalog(), null, 2))
  if (command === 'config') {
    const stored = await loadStoredConfig(configPath)
    return console.log(JSON.stringify(configSummary(stored, { configPath, factoryDefaultModel: FACTORY_DEFAULT_MODEL }), null, 2))
  }
  if (command === 'set-default') {
    if (args.length !== 1) throw new Error('Usage: sublyx-image set-default <model>')
    const saved = await setDefaultModel(args[0], configPath)
    return console.log(`Default model saved: ${saved.defaultModel}\nConfig: ${configPath}`)
  }
  if (command === 'set-key') {
    if (args.some((arg) => arg !== '--stdin')) throw new Error('The Key must not be passed as a command-line value. Use set-key or set-key --stdin.')
    const key = args.includes('--stdin') ? await readAllStdin() : await readHidden('Sublyx API Key: ')
    const saved = await setApiKey(key, configPath)
    const summary = configSummary(saved, { configPath, factoryDefaultModel: FACTORY_DEFAULT_MODEL })
    return console.log(`Sublyx API Key saved: ${summary.apiKeyPreview}\nConfig: ${configPath}`)
  }
  if (command === 'clear-key') {
    await clearApiKey(configPath)
    return console.log(`Saved Sublyx API Key cleared.\nConfig: ${configPath}`)
  }
  if (command === 'self-test') return selfTest()
  throw new Error(`Unknown command: ${command}`)
}

main().catch((error) => {
  console.error(`ERROR: ${error?.message || String(error)}`)
  process.exitCode = 1
})
