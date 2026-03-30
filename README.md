# Image MetaHub Browser (MVP)

A minimal MV3 browser extension that saves online AI images with embedded MetaHub-compatible PNG metadata.

## What it does

- Adds a discreet `Save` action to assistant messages that contain generated images
- `Save` performs a quick save with autodetected metadata and stored defaults
- `Edit` opens a lightweight metadata form when you want to review fields before download
- Lets you save the main image from that message and download:
  - `imh-<provider>-<timestamp>.png` with embedded `tEXt` metadata
- Uses a simplified metadata form focused on fields that make sense for LLM image chats
- Embeds richer `imagemetahub_data` JSON metadata in PNGs when enabled in settings

## Supported sites (initial)

- chatgpt.com
- gemini.google.com
- grok.com
- x.ai

## How to load (Chrome/Edge)

1. Open `chrome://extensions`
2. Enable Developer mode
3. Click "Load unpacked"
4. Select the `D:\IMH_BROWSER` folder

## Notes

- This MVP embeds metadata into PNGs (tEXt `parameters` chunk).
- If the image is not PNG, the extension tries to convert to PNG. If conversion fails, it saves without metadata.
- Clicking the extension icon opens the settings page.

## Next steps

- Tighten per-site selectors for model autodetection as the UIs evolve
- Support choosing among multiple images in the same assistant message
- Expand richer metadata coverage for more providers beyond ChatGPT and Grok
