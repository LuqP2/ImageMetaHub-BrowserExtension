(() => {
  const BUTTON_ID = 'imh-save-button';
  const OVERLAY_ID = 'imh-overlay';

  let pickMode = false;
  let overlayEl = null;
  let modalEl = null;

  function ensureButton() {
    if (document.getElementById(BUTTON_ID)) {
      return;
    }

    const button = document.createElement('button');
    button.id = BUTTON_ID;
    button.type = 'button';
    button.textContent = 'Save to MetaHub';
    button.addEventListener('click', startPickMode);
    (document.documentElement || document.body || document).appendChild(button);
  }

  function startPickMode() {
    if (pickMode) {
      return;
    }
    pickMode = true;
    showOverlay('Click an image to save');
    document.addEventListener('click', handlePickClick, true);
  }

  function stopPickMode() {
    pickMode = false;
    hideOverlay();
    document.removeEventListener('click', handlePickClick, true);
  }

  function showOverlay(message) {
    if (!overlayEl) {
      overlayEl = document.createElement('div');
      overlayEl.id = OVERLAY_ID;
      document.documentElement.appendChild(overlayEl);
    }
    overlayEl.textContent = message;
  }

  function hideOverlay() {
    if (overlayEl) {
      overlayEl.remove();
      overlayEl = null;
    }
  }

  function handlePickClick(event) {
    if (!pickMode) {
      return;
    }

    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }

    if (target.closest('#' + BUTTON_ID) || target.closest('.imh-modal')) {
      return;
    }

    const imageContext = findImageContext(event);
    if (!imageContext) {
      showOverlay('Not an image. Click an image to save.');
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    stopPickMode();
    openMetadataModal(imageContext);
  }

  function findImageContext(event) {
    const target = event.target;
    const path = typeof event.composedPath === 'function' ? event.composedPath() : [];

    for (const entry of path) {
      if (entry instanceof HTMLImageElement) {
        return buildImageContextFromImg(entry);
      }
    }

    if (target instanceof HTMLImageElement) {
      return buildImageContextFromImg(target);
    }

    const elements = document.elementsFromPoint(event.clientX, event.clientY);
    for (const el of elements) {
      if (el instanceof HTMLImageElement) {
        return buildImageContextFromImg(el);
      }
    }

    for (const el of elements) {
      if (!(el instanceof Element)) {
        continue;
      }
      const bgUrl = extractBackgroundImageUrl(el);
      if (bgUrl) {
        const rect = el.getBoundingClientRect();
        return {
          imageUrl: bgUrl,
          width: Math.round(rect.width || 0),
          height: Math.round(rect.height || 0),
          sourceElement: el
        };
      }
    }

    return null;
  }

  function buildImageContextFromImg(img) {
    const url = img.currentSrc || img.src;
    return {
      imageUrl: url,
      width: img.naturalWidth || img.width || 0,
      height: img.naturalHeight || img.height || 0,
      sourceElement: img
    };
  }

  function extractBackgroundImageUrl(element) {
    const style = window.getComputedStyle(element);
    const bg = style.backgroundImage;
    if (!bg || bg === 'none') {
      return '';
    }
    const match = bg.match(/url\\(["']?(.*?)["']?\\)/i);
    return match ? match[1] : '';
  }

  function openMetadataModal(imageContext) {
    closeModal();

    const imageUrl = imageContext.imageUrl;
    const width = imageContext.width || 0;
    const height = imageContext.height || 0;
    const promptPrefill = guessPromptText(imageContext.sourceElement || null);
    const promptPrefillEscaped = promptPrefill ? escapeHtml(promptPrefill) : '';

    modalEl = document.createElement('div');
    modalEl.className = 'imh-modal';

    const provider = inferProvider();

    modalEl.innerHTML = `
      <div class="imh-modal__panel">
        <div class="imh-modal__title">Save to MetaHub</div>
        <div class="imh-modal__grid">
          <div class="imh-modal__field">
            <label>Provider</label>
            <input type="text" name="provider" value="${escapeHtml(provider)}" />
          </div>
          <div class="imh-modal__field">
            <label>Model</label>
            <input type="text" name="model" placeholder="e.g. DALL-E 3" />
          </div>
          <div class="imh-modal__field">
            <label>Steps</label>
            <input type="number" name="steps" min="1" placeholder="30" />
          </div>
          <div class="imh-modal__field">
            <label>CFG Scale</label>
            <input type="number" name="cfg" step="0.1" placeholder="7.5" />
          </div>
          <div class="imh-modal__field">
            <label>Seed</label>
            <input type="number" name="seed" placeholder="123456" />
          </div>
          <div class="imh-modal__field">
            <label>Sampler</label>
            <input type="text" name="sampler" placeholder="Euler a" />
          </div>
          <div class="imh-modal__field">
            <label>Width</label>
            <input type="number" name="width" value="${width}" />
          </div>
          <div class="imh-modal__field">
            <label>Height</label>
            <input type="number" name="height" value="${height}" />
          </div>
          <div class="imh-modal__field" style="grid-column: 1 / -1;">
            <label>Prompt</label>
            <textarea name="prompt" placeholder="Describe the prompt...">${promptPrefillEscaped}</textarea>
          </div>
          <div class="imh-modal__field" style="grid-column: 1 / -1;">
            <label>Negative Prompt</label>
            <textarea name="negativePrompt" placeholder="Optional"></textarea>
          </div>
        </div>
        <div class="imh-modal__field" style="grid-column: 1 / -1;">
          <label>
            <input type="checkbox" name="sidecarFallback" checked />
            Save .json sidecar if embed fails
          </label>
        </div>
        <div class="imh-modal__actions">
          <button class="imh-button" type="button" data-action="cancel">Cancel</button>
          <button class="imh-button imh-button--primary" type="button" data-action="save">Save</button>
        </div>
      </div>
    `;

    modalEl.addEventListener('click', (event) => {
      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }

      if (target.dataset.action === 'cancel') {
        closeModal();
      }

      if (target.dataset.action === 'save') {
        handleSave(imageUrl, modalEl);
      }
    });

    document.documentElement.appendChild(modalEl);
  }

  function closeModal() {
    if (modalEl) {
      modalEl.remove();
      modalEl = null;
    }
  }

  function handleSave(imageUrl, modalRoot) {
    const form = modalRoot;
    const promptValue = getFieldValue(form, 'prompt');
    const negativePromptValue = getFieldValue(form, 'negativePrompt');
    const metadata = {
      prompt: promptValue,
      negative_prompt: negativePromptValue,
      steps: parseNumber(getFieldValue(form, 'steps')),
      cfg_scale: parseNumber(getFieldValue(form, 'cfg')),
      sampler: getFieldValue(form, 'sampler'),
      seed: parseNumber(getFieldValue(form, 'seed')),
      model: getFieldValue(form, 'model'),
      width: parseNumber(getFieldValue(form, 'width')),
      height: parseNumber(getFieldValue(form, 'height')),
      provider: getFieldValue(form, 'provider'),
      source_url: window.location.href,
      image_url: imageUrl,
      captured_at: new Date().toISOString()
    };

    const sidecarFallback = isChecked(form, 'sidecarFallback');
    closeModal();
    downloadWithMetadata(imageUrl, metadata, sidecarFallback);
  }

  function getFieldValue(root, name) {
    const field = root.querySelector(`[name="${name}"]`);
    if (!field) {
      return '';
    }
    return field.value.trim();
  }

  function parseNumber(value) {
    if (!value) {
      return undefined;
    }
    const num = Number(value);
    return Number.isFinite(num) ? num : undefined;
  }

  function isChecked(root, name) {
    const field = root.querySelector(`[name="${name}"]`);
    if (!field) {
      return false;
    }
    return Boolean(field.checked);
  }

  async function downloadWithMetadata(imageUrl, metadata, sidecarFallback) {
    try {
      const baseName = buildBaseName(metadata);
      const imageResult = await fetchImageBlob(imageUrl);
      const extension = inferExtension(imageResult && imageResult.type, imageUrl);

      if (!imageResult || !imageResult.blob) {
        downloadRemoteUrl(imageUrl, `${baseName}.${extension}`);
        if (sidecarFallback) {
          saveSidecar(baseName, metadata);
        }
        showToast('Saved image (metadata unavailable: fetch blocked)');
        return;
      }

      let blob = imageResult.blob;
      let outputExtension = extension;

      if (!isPngBlob(blob)) {
        const converted = await convertToPngBlob(blob);
        if (converted) {
          blob = converted;
          outputExtension = 'png';
        }
      }

      if (isPngBlob(blob)) {
        const buffer = await blob.arrayBuffer();
        const parameters = buildParametersString(metadata);
        const embedded = embedPngTextChunk(buffer, 'parameters', parameters);
        const outBlob = new Blob([embedded], { type: 'image/png' });
        triggerDownload(URL.createObjectURL(outBlob), `${baseName}.png`, true);
        showToast('Saved PNG with embedded metadata');
        return;
      }

      triggerDownload(URL.createObjectURL(blob), `${baseName}.${outputExtension}`, true);
      if (sidecarFallback) {
        saveSidecar(baseName, metadata);
      }
      showToast('Saved image (non-PNG, metadata not embedded)');
    } catch (error) {
      console.warn('[IMH] Failed to save image', error);
      if (sidecarFallback) {
        saveSidecar(buildBaseName(metadata), metadata);
      }
      showToast('Failed to save image');
    }
  }

  function triggerDownload(url, filename, revoke) {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.style.display = 'none';
    const parent = document.body || document.documentElement;
    if (!parent) {
      return;
    }
    parent.appendChild(anchor);
    anchor.click();
    anchor.remove();

    if (revoke) {
      setTimeout(() => URL.revokeObjectURL(url), 1500);
    }
  }

  function downloadRemoteUrl(url, filename) {
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
      chrome.runtime.sendMessage({ type: 'download-url', url, filename }, () => {
        if (chrome.runtime.lastError) {
          console.warn('[IMH] download failed', chrome.runtime.lastError.message);
          triggerDownload(url, filename, false);
        }
      });
      return;
    }
    triggerDownload(url, filename, false);
  }

  async function fetchImageBlob(imageUrl) {
    const attempts = [
      { credentials: 'omit' },
      { credentials: 'include' }
    ];

    for (const attempt of attempts) {
      try {
        const response = await fetch(imageUrl, {
          credentials: attempt.credentials
        });
        if (!response.ok) {
          continue;
        }
        const blob = await response.blob();
        return { blob, type: blob.type };
      } catch {
        // Try next credential mode.
      }
    }

    const backgroundResult = await fetchImageBlobViaBackground(imageUrl);
    if (backgroundResult) {
      return backgroundResult;
    }

    return null;
  }

  function inferExtension(mimeType, imageUrl) {
    if (mimeType === 'image/jpeg') {
      return 'jpg';
    }
    if (mimeType === 'image/webp') {
      return 'webp';
    }
    if (mimeType === 'image/png') {
      return 'png';
    }

    const match = imageUrl.match(/\.(png|jpe?g|webp)(\?|#|$)/i);
    if (match) {
      const ext = match[1].toLowerCase();
      return ext === 'jpeg' ? 'jpg' : ext;
    }

    return 'png';
  }

  function guessPromptText(sourceElement) {
    if (!sourceElement || !(sourceElement instanceof Element)) {
      return '';
    }

    const provider = inferProvider();
    if (provider === 'ChatGPT') {
      const prompt = findChatGptPrompt(sourceElement);
      if (prompt) {
        return prompt;
      }
    }

    if (provider === 'Gemini') {
      const prompt = findGeminiPrompt(sourceElement);
      if (prompt) {
        return prompt;
      }
    }

    return findGenericPrompt(sourceElement);
  }

  function findChatGptPrompt(sourceElement) {
    const message = sourceElement.closest('[data-message-author-role]');
    if (message) {
      const role = message.getAttribute('data-message-author-role');
      if (role === 'assistant') {
        const previous = findPreviousSiblingMessage(message, 'user');
        const text = extractReadableText(previous);
        if (text) {
          return text;
        }
      }
      if (role === 'user') {
        const text = extractReadableText(message);
        if (text) {
          return text;
        }
      }
    }

    const allUser = Array.from(document.querySelectorAll('[data-message-author-role="user"]'));
    const lastUser = allUser[allUser.length - 1];
    return extractReadableText(lastUser);
  }

  function findGeminiPrompt(sourceElement) {
    const selector = '.user-query-bubble-with-background .query-text';
    const promptFromThread = findPreviousSelectorText(sourceElement, selector);
    if (promptFromThread) {
      return promptFromThread;
    }

    const promptFromAncestor = findPreviousSelectorText(
      sourceElement.closest('article') || sourceElement,
      selector
    );
    if (promptFromAncestor) {
      return promptFromAncestor;
    }

    const all = document.querySelectorAll(selector);
    const last = all[all.length - 1];
    return extractReadableText(last);
  }

  function findGenericPrompt(sourceElement) {
    return findPreviousTextBlock(sourceElement);
  }

  function findPreviousSiblingMessage(messageEl, role) {
    let current = messageEl.previousElementSibling;
    while (current) {
      if (current.getAttribute && current.getAttribute('data-message-author-role') === role) {
        return current;
      }
      current = current.previousElementSibling;
    }
    return null;
  }

  function findPreviousTextBlock(startElement) {
    let current = startElement;
    for (let depth = 0; depth < 6; depth += 1) {
      let sibling = current.previousElementSibling;
      while (sibling) {
        const text = extractReadableText(sibling);
        if (text) {
          return text;
        }
        sibling = sibling.previousElementSibling;
      }
      if (!current.parentElement) {
        break;
      }
      current = current.parentElement;
    }
    return '';
  }

  function findPreviousSelectorText(startElement, selector) {
    let current = startElement;
    for (let depth = 0; depth < 6; depth += 1) {
      let sibling = current.previousElementSibling;
      while (sibling) {
        const match = sibling.matches(selector) ? sibling : sibling.querySelector(selector);
        const text = extractReadableText(match || sibling);
        if (text) {
          return text;
        }
        sibling = sibling.previousElementSibling;
      }
      if (!current.parentElement) {
        break;
      }
      current = current.parentElement;
    }
    return '';
  }

  function extractReadableText(element) {
    if (!element || !(element instanceof Element)) {
      return '';
    }
    const text = (element.innerText || '').trim();
    if (!text || text.length < 8) {
      return '';
    }
    const cleaned = text.replace(/\s+/g, ' ');
    if (isLikelyUiText(cleaned)) {
      return '';
    }
    return cleaned;
  }

  async function fetchImageBlobViaBackground(imageUrl) {
    if (!chrome.runtime || !chrome.runtime.sendMessage) {
      return null;
    }

    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'fetch-image', url: imageUrl }, (response) => {
        if (chrome.runtime.lastError || !response || !response.ok || !response.buffer) {
          resolve(null);
          return;
        }
        const mimeType = response.type || inferMimeTypeFromUrl(imageUrl);
        const blob = new Blob([response.buffer], { type: mimeType || undefined });
        resolve({ blob, type: mimeType || blob.type });
      });
    });
  }

  function inferMimeTypeFromUrl(url) {
    const lower = url.toLowerCase();
    if (lower.includes('.png')) {
      return 'image/png';
    }
    if (lower.includes('.webp')) {
      return 'image/webp';
    }
    if (lower.includes('.jpg') || lower.includes('.jpeg')) {
      return 'image/jpeg';
    }
    return '';
  }

  function isLikelyUiText(text) {
    const lower = text.toLowerCase();
    const badFragments = [
      'save to metahub',
      'copy',
      'regenerate',
      'share',
      'report',
      'edit',
      'like',
      'dislike',
      'download'
    ];
    return badFragments.some((fragment) => lower.includes(fragment));
  }

  function saveSidecar(baseName, metadata) {
    const jsonFilename = `${baseName}.json`;
    const jsonPayload = JSON.stringify(metadata, null, 2);
    const jsonBlob = new Blob([jsonPayload], { type: 'application/json' });
    triggerDownload(URL.createObjectURL(jsonBlob), jsonFilename, true);
  }

  function isPngBlob(blob) {
    return blob && blob.type === 'image/png';
  }

  async function convertToPngBlob(blob) {
    try {
      const bitmap = await createImageBitmap(blob);
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        return null;
      }
      ctx.drawImage(bitmap, 0, 0);
      return await new Promise((resolve) => {
        canvas.toBlob((pngBlob) => resolve(pngBlob || null), 'image/png');
      });
    } catch {
      return null;
    }
  }

  function buildParametersString(metadata) {
    const prompt = metadata.prompt || '';
    const negative = metadata.negative_prompt || '';
    const params = [];

    if (metadata.steps) {
      params.push(`Steps: ${metadata.steps}`);
    }
    if (metadata.sampler) {
      params.push(`Sampler: ${metadata.sampler}`);
    }
    if (metadata.cfg_scale) {
      params.push(`CFG scale: ${metadata.cfg_scale}`);
    }
    if (metadata.seed !== undefined) {
      params.push(`Seed: ${metadata.seed}`);
    }
    if (metadata.width && metadata.height) {
      params.push(`Size: ${metadata.width}x${metadata.height}`);
    }
    if (metadata.model) {
      params.push(`Model: ${metadata.model}`);
    }
    if (metadata.provider) {
      params.push(`Generator: ${metadata.provider}`);
    }

    const lines = [prompt.trim()];
    if (negative.trim()) {
      lines.push(`Negative prompt: ${negative.trim()}`);
    }
    if (params.length) {
      lines.push(params.join(', '));
    }
    return lines.filter(Boolean).join('\n');
  }

  function embedPngTextChunk(buffer, keyword, text) {
    const bytes = new Uint8Array(buffer);
    const data = new TextEncoder().encode(`${keyword}\0${text}`);
    const type = toBytes('tEXt');
    const chunk = buildPngChunk(type, data);

    let offset = 8;
    while (offset + 8 <= bytes.length) {
      const length = readUint32(bytes, offset);
      const chunkType = readChunkType(bytes, offset);
      const totalLength = 12 + length;
      if (chunkType === 'IEND') {
        return concatUint8(bytes.slice(0, offset), chunk, bytes.slice(offset));
      }
      offset += totalLength;
    }
    return bytes;
  }

  function buildPngChunk(typeBytes, dataBytes) {
    const length = dataBytes.length;
    const chunk = new Uint8Array(12 + length);
    writeUint32(chunk, 0, length);
    chunk.set(typeBytes, 4);
    chunk.set(dataBytes, 8);
    const crc = crc32(concatUint8(typeBytes, dataBytes));
    writeUint32(chunk, 8 + length, crc);
    return chunk;
  }

  function readChunkType(bytes, offset) {
    return String.fromCharCode(
      bytes[offset + 4],
      bytes[offset + 5],
      bytes[offset + 6],
      bytes[offset + 7]
    );
  }

  function readUint32(bytes, offset) {
    return (
      (bytes[offset] << 24) |
      (bytes[offset + 1] << 16) |
      (bytes[offset + 2] << 8) |
      bytes[offset + 3]
    ) >>> 0;
  }

  function writeUint32(bytes, offset, value) {
    bytes[offset] = (value >>> 24) & 0xff;
    bytes[offset + 1] = (value >>> 16) & 0xff;
    bytes[offset + 2] = (value >>> 8) & 0xff;
    bytes[offset + 3] = value & 0xff;
  }

  function toBytes(text) {
    const bytes = new Uint8Array(text.length);
    for (let i = 0; i < text.length; i += 1) {
      bytes[i] = text.charCodeAt(i);
    }
    return bytes;
  }

  function concatUint8(...arrays) {
    let total = 0;
    arrays.forEach((arr) => {
      total += arr.length;
    });
    const merged = new Uint8Array(total);
    let offset = 0;
    arrays.forEach((arr) => {
      merged.set(arr, offset);
      offset += arr.length;
    });
    return merged;
  }

  function crc32(bytes) {
    let crc = 0xffffffff;
    for (let i = 0; i < bytes.length; i += 1) {
      crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  const CRC_TABLE = (() => {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i += 1) {
      let c = i;
      for (let k = 0; k < 8; k += 1) {
        c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      }
      table[i] = c >>> 0;
    }
    return table;
  })();

  function buildBaseName(metadata) {
    const provider = metadata.provider || 'online';
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const safeProvider = slugify(provider);
    return `imh-${safeProvider}-${timestamp}`;
  }

  function slugify(value) {
    return value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 32) || 'online';
  }

  function inferProvider() {
    const host = window.location.hostname.toLowerCase();
    if (host.includes('chatgpt') || host.includes('openai')) {
      return 'ChatGPT';
    }
    if (host.includes('gemini')) {
      return 'Gemini';
    }
    if (host.includes('grok') || host.includes('x.ai')) {
      return 'Grok';
    }
    return 'Online';
  }

  function escapeHtml(value) {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function showToast(message) {
    const toast = document.createElement('div');
    toast.className = 'imh-toast';
    toast.textContent = message;
    document.documentElement.appendChild(toast);
    setTimeout(() => {
      toast.remove();
    }, 2400);
  }

  function boot() {
    ensureButton();
    const observer = new MutationObserver(() => ensureButton());
    observer.observe(document.documentElement || document.body, {
      childList: true,
      subtree: true
    });
    window.addEventListener('pageshow', ensureButton);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
