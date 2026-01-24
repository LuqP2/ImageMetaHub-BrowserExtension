# Image MetaHub Browser (MVP)

A minimal MV3 browser extension that saves online AI images alongside a MetaHub-compatible sidecar JSON.

## What it does

- Adds a "Save to MetaHub" button on supported sites
- Lets you click an image, fill prompt/model fields, and download:
  - `imh-<provider>-<timestamp>.png`
  - `imh-<provider>-<timestamp>.json`
- The JSON format matches the Easy Diffusion sidecar parser in Image MetaHub

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

- This MVP stores metadata in a `.json` sidecar, not inside the PNG.
- The app will read it in the Electron build when the image and JSON are in the same folder.
- If the image download fails, the script falls back to downloading the image URL directly.

## Next steps

- Auto-capture prompt/model from each site
- Optional: embed metadata into PNG tEXt/iTXt chunks
- Add settings (default provider/model, default folder name)
