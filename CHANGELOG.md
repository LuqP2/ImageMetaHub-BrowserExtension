# Changelog

## 0.1.1

- replaced the floating global button with discreet inline actions per assistant message
- added `Quick Save` as the primary action and kept `Edit` as a manual metadata fallback
- simplified the edit modal to metadata fields that fit LLM image chats
- added ChatGPT and Grok prompt/model autodetection heuristics
- added richer PNG metadata via `imagemetahub_data` iTXt payload plus richer JSON sidecars
- added extension settings for provider/model fallback, filename prefix, sidecar fallback, and rich metadata embedding

## Unreleased

- changed Grok inline save to open the metadata modal directly instead of using quick save
- expanded Grok prompt autodetection to also inspect nearby prompt inputs and prompt-like blocks
- added `*.grok.com` and `*.x.ai` host permissions for image fetches served from subdomains
