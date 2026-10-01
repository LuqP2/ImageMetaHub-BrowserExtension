# Changelog

## 0.1.1

- replaced the floating global button with discreet inline actions per assistant message
- added `Quick Save` as the primary action and kept `Edit` as a manual metadata fallback
- simplified the edit modal to metadata fields that fit LLM image chats
- added ChatGPT and Grok prompt/model autodetection heuristics
- added richer PNG metadata via `imagemetahub_data` iTXt payload plus richer JSON sidecars
- added extension settings for provider/model fallback, filename prefix, sidecar fallback, and rich metadata embedding

## Unreleased

- restored ChatGPT image actions for the current turn/gallery markup, with one action per generated image and compatibility with older conversation turns
- placed ChatGPT controls outside the gallery so its fixed height and clipping cannot hide the buttons
- associated ChatGPT and Gemini prompts with the corresponding response instead of the last request on the page
- removed structural speaker labels from prompts while preserving paragraphs, lists, and short requests
- stopped inferring the image model from ChatGPT's chat-model selector
- kept blob image reads in the owning page and fixed JSON-safe image transfer from the service worker
- confirmed download completion/interruption through the downloads API, including metadata sidecar downloads
- added synthetic DOM and service-worker regression tests for the compatibility delivery
- changed Grok inline save to open the metadata modal directly instead of using quick save
- expanded Grok prompt autodetection to also inspect nearby prompt inputs and prompt-like blocks
- added `*.grok.com` and `*.x.ai` host permissions for image fetches served from subdomains
