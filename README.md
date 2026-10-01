# Image MetaHub Browser (MVP)

A minimal MV3 browser extension that saves online AI images with embedded MetaHub-compatible PNG metadata.

## What it does

- Adds a discreet `Save to MetaHub` action to each generated image in ChatGPT and Gemini
- `Save` performs a quick save with autodetected metadata and stored defaults
- `Edit` opens a lightweight metadata form when you want to review fields before download
- On Grok, `Save to MetaHub` opens the metadata form directly so the prompt can be reviewed before export
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
4. Select this extension's repository folder

After updating an unpacked extension, click **Reload** on its extension card and refresh existing ChatGPT/Gemini tabs. Existing tabs otherwise keep the previously injected script.

## Notes

- This MVP embeds metadata into PNGs (tEXt `parameters` chunk).
- If the image is not PNG, the extension tries to convert to PNG. If conversion fails, it saves without metadata.
- Clicking the extension icon opens the settings page.
- ChatGPT and Gemini prompts come from the request associated with that image. If it cannot be identified, the prompt stays empty for manual review rather than using another request.
- Speaker labels are removed structurally; paragraphs and lists are preserved.
- The chat-model selector does not identify the image-generation model. Set the model manually or configure a fallback if needed.
- Download status is confirmed by the browser. A blocked image fetch can fall back to a remote download, with a separate metadata sidecar when enabled.

## Development checks

Run `npm ci --ignore-scripts` and `npm test`. Tests use invented DOM fixtures and mocked extension APIs; they do not open a browser or read a user's conversations/images.

The first compatibility delivery requires manual acceptance in Brave before implementing the remaining context, desktop-reader, batch-download, context-menu, and CivitAI deliveries. Check image actions, correct request association, Gemini speaker-label removal, and saved-image metadata. Grok-specific changes are deferred.

## Next steps

- Tighten per-site selectors for model autodetection as the UIs evolve
- Support choosing among multiple images in the same assistant message
- Expand richer metadata coverage for more providers beyond ChatGPT and Grok
