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
    document.documentElement.appendChild(button);
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

    const imageEl = findImageElement(target);
    if (!imageEl) {
      showOverlay('Not an image. Click an image to save.');
      return;
    }

    event.preventDefault();
    event.stopPropagation();

    stopPickMode();
    openMetadataModal(imageEl);
  }

  function findImageElement(target) {
    if (target.tagName && target.tagName.toLowerCase() === 'img') {
      return target;
    }

    const img = target.closest('img');
    if (img) {
      return img;
    }

    const nested = target.querySelector && target.querySelector('img');
    if (nested) {
      return nested;
    }

    return null;
  }

  function openMetadataModal(imageEl) {
    closeModal();

    const imageUrl = imageEl.currentSrc || imageEl.src;
    const width = imageEl.naturalWidth || imageEl.width || 0;
    const height = imageEl.naturalHeight || imageEl.height || 0;

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
            <textarea name="prompt" placeholder="Describe the prompt..."></textarea>
          </div>
          <div class="imh-modal__field" style="grid-column: 1 / -1;">
            <label>Negative Prompt</label>
            <textarea name="negativePrompt" placeholder="Optional"></textarea>
          </div>
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

    closeModal();
    downloadWithSidecar(imageUrl, metadata);
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

  async function downloadWithSidecar(imageUrl, metadata) {
    const baseName = buildBaseName(metadata);
    const imageResult = await fetchImageBlob(imageUrl);
    const extension = inferExtension(imageResult && imageResult.type, imageUrl);
    const imageFilename = `${baseName}.${extension}`;
    const jsonFilename = `${baseName}.json`;

    if (imageResult && imageResult.blob) {
      triggerDownload(URL.createObjectURL(imageResult.blob), imageFilename, true);
    } else {
      triggerDownload(imageUrl, imageFilename, false);
    }

    const jsonPayload = JSON.stringify(metadata, null, 2);
    const jsonBlob = new Blob([jsonPayload], { type: 'application/json' });
    triggerDownload(URL.createObjectURL(jsonBlob), jsonFilename, true);

    showToast('Saved image + metadata to Downloads');
  }

  function triggerDownload(url, filename, revoke) {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();

    if (revoke) {
      setTimeout(() => URL.revokeObjectURL(url), 1500);
    }
  }

  async function fetchImageBlob(imageUrl) {
    try {
      const response = await fetch(imageUrl, { credentials: 'include' });
      if (!response.ok) {
        return null;
      }
      const blob = await response.blob();
      return { blob, type: blob.type };
    } catch {
      return null;
    }
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

  ensureButton();
})();
