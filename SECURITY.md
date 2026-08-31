# Security policy

Do not include API Keys, private prompts, generated private images, or other credentials in a public report.

Please include the plugin version or commit, DSH version, operating system, reproduction boundary,
and whether any paid request reached `api.sublyx.org`.

DSH plugins execute as trusted local Host code. Installing this package is not equivalent to granting
a sandboxed browser-extension permission.

The `image_key_sublyx` convenience tool can save a Key supplied through chat, but the original user
message and tool-call arguments may remain in DSH history. Hidden terminal input through
`sublyx-image set-key` is recommended for sensitive or long-lived Keys.
