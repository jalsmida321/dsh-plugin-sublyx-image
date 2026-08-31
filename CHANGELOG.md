# Changelog

## 0.1.0

- Add DSH tools for Sublyx image generation, editing, model defaults, and Key management.
- Use `/v1/images/generations` for JSON generation requests.
- Use `/v1/images/edits` with one `image` field and an optional `mask`.
- Support `b64_json`, `image`, `base64`, data URI, and HTTPS URL response shapes.
- Add sequential batches, dry runs, local image validation, attachment-aware output, and retry safety.
- Verify `gpt-image-2` through the authenticated Sublyx model endpoint on 2026-08-31.
