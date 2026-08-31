# Sublyx Image for DeepSeek Harness

[中文](README.zh.md) | English

This DSH/Cordis plugin integrates `api.sublyx.org` image generation and editing. 

It exposes three Agent tools:

- `image_generate_sublyx` for generation, single-image editing, optional masks, sequential batches, and dry runs.
- `image_model_sublyx` for inspecting the compatibility baseline and managing the persistent default model.
- `image_key_sublyx` for explicitly requested Key inspection, storage, and clearing.

## Verified API contract

On 2026-08-31, an authenticated `https://api.sublyx.org/v1/models` request returned
`gpt-image-2`. The plugin uses the OpenAI-compatible Images API:

| Operation | Endpoint | Encoding |
| --- | --- | --- |
| Generate | `/v1/images/generations` | JSON |
| Edit | `/v1/images/edits` | multipart/form-data |

The default size is `1024x1024`. Other `WIDTHxHEIGHT` values are forwarded for the
upstream model to validate. Model identifiers are configurable so newly added Sublyx
models do not require an immediate plugin release.

## Build and install

```sh
npm install
npm run check
npm pack
dsh plugin --profile web add ./dsh-plugin-sublyx-image-0.1.0.tgz
dsh --profile web --dump-config
```

The composed config should contain `sublyx-image`. After publishing to GitHub:

```sh
dsh plugin --profile web add github:<owner>/dsh-plugin-sublyx-image#<commit-sha>
```

## Configure the Key

Use hidden terminal input:

```sh
dsh plugin --profile web exec sublyx-image set-key
```

Run the whole command unchanged. No part of the command is the Key. Press Enter, wait
for the separate `Sublyx API Key:` prompt, then paste the Key and press Enter. Input is hidden.

For non-interactive setup:

```sh
printf '%s' "$SUBLYX_API_KEY" | dsh plugin --profile web exec sublyx-image set-key --stdin
```

The default config is `~/.dsh/sublyx-image/config.json`. `SUBLYX_API_KEY` and
`SUBLYX_IMAGE_API_KEY` override the saved value without writing it to disk.

## Behavior and safety

Generated images are saved under `~/Pictures/sublyx-image`. Results are attached to
DSH when the active route accepts image input; otherwise the tool returns absolute paths.

Each `count` or `prompts` item is an independent request and may be billed separately.
Batches run sequentially and stop on the first failure. The plugin does not automatically
retry errors marked `[NO-AUTO-RETRY]`.

The implementation validates local image bytes, limits request and response sizes, rejects
non-HTTPS or private-network image URLs, and sends the Key only to same-origin downloads.

Users must follow the current Sublyx terms, regional restrictions, upstream policies, and
applicable law. The Sublyx site displays terms updated on 2026-05-01 stating that the service
is not offered in mainland China. This plugin does not provide proxying or restriction bypasses.

## Development

```sh
npm install
npm run check
npm run self-test
```

Tests use local mock servers and do not make paid image requests.

This project modifies MIT-licensed code from `dsh-plugin-88api-image`; see [LICENSE](LICENSE).
