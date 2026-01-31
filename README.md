# Image MetaHub Browser (MVP)

A minimal MV3 browser extension that saves online AI images with embedded MetaHub-compatible PNG metadata.

## What it does

- Adds a "Save to MetaHub" button on supported sites
- Lets you click an image, fill prompt/model fields, and download:
  - `imh-<provider>-<timestamp>.png` with embedded `tEXt` metadata
- The metadata format mirrors the A1111/Easy Diffusion `parameters` string

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

## Next steps

- Auto-capture prompt/model from each site
- Add settings (default provider/model, default folder name)
- Embed request URL-
