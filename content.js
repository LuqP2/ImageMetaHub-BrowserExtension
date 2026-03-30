(() => {
  const INLINE_ACTION_ATTR = 'data-imh-save-action';
  const MESSAGE_HOST_ATTR = 'data-imh-save-host';
  const DEFAULT_SETTINGS = {
    defaultProvider: '',
    defaultModel: '',
    filenamePrefix: 'imh',
    sidecarFallback: true,
    includeRichMetadata: true
  };

  let modalEl = null;
  let refreshQueued = false;
  let settingsCache = { ...DEFAULT_SETTINGS };
  let settingsPromise = null;

  function queueInlineActionRefresh() {
    if (refreshQueued) {
      return;
    }

    refreshQueued = true;
    window.requestAnimationFrame(() => {
      refreshQueued = false;
      refreshInlineActions();
    });
  }

  function refreshInlineActions() {
    const messageContainers = collectAssistantMessagesWithImages();
    messageContainers.forEach((messageEl) => ensureInlineAction(messageEl));
  }

  function collectAssistantMessagesWithImages() {
    const containers = new Set();
    const candidates = document.querySelectorAll('img');

    candidates.forEach((img) => {
      if (!(img instanceof HTMLImageElement) || !isLikelyImageCandidate(img)) {
        return;
      }

      const messageEl = findAssistantMessageContainer(img);
      if (messageEl) {
        containers.add(messageEl);
      }
    });

    return Array.from(containers);
  }

  function ensureInlineAction(messageEl) {
    if (!(messageEl instanceof HTMLElement)) {
      return;
    }

    const existing = messageEl.querySelector(`[${INLINE_ACTION_ATTR}="true"]`);
    if (existing) {
      return;
    }

    const imageContext = findBestImageContextInMessage(messageEl);
    if (!imageContext) {
      return;
    }

    messageEl.setAttribute(MESSAGE_HOST_ATTR, 'true');

    const row = document.createElement('div');
    row.className = 'imh-inline-action-row';
    row.setAttribute(INLINE_ACTION_ATTR, 'true');

    const saveButton = document.createElement('button');
    saveButton.type = 'button';
    saveButton.className = 'imh-inline-action imh-inline-action--primary';
    saveButton.textContent = 'Save';
    saveButton.title = 'Quick save image to MetaHub';
    saveButton.addEventListener('click', async (event) => {
      event.preventDefault();
      event.stopPropagation();

      const latestImageContext = findBestImageContextInMessage(messageEl) || imageContext;
      if (!latestImageContext) {
        showToast('No image found in this message');
        return;
      }

      await quickSaveImage(latestImageContext);
    });

    const editButton = document.createElement('button');
    editButton.type = 'button';
    editButton.className = 'imh-inline-action imh-inline-action--secondary';
    editButton.textContent = 'Edit';
    editButton.title = 'Review metadata before saving';
    editButton.addEventListener('click', async (event) => {
      event.preventDefault();
      event.stopPropagation();

      const latestImageContext = findBestImageContextInMessage(messageEl) || imageContext;
      if (!latestImageContext) {
        showToast('No image found in this message');
        return;
      }

      await openMetadataModal(latestImageContext);
    });

    row.appendChild(saveButton);
    row.appendChild(editButton);
    messageEl.appendChild(row);
  }

  function findAssistantMessageContainer(element) {
    if (!element || !(element instanceof Element)) {
      return null;
    }

    const provider = inferProvider();

    if (provider === 'ChatGPT') {
      return element.closest('[data-message-author-role="assistant"]');
    }

    if (provider === 'Gemini') {
      return (
        element.closest('model-response') ||
        element.closest('[data-test-id="conversation-turn-model"]') ||
        element.closest('[data-response-id]') ||
        element.closest('article')
      );
    }

    if (provider === 'Grok') {
      return (
        element.closest('[data-testid="conversation-turn-assistant"]') ||
        element.closest('[data-testid*="assistant"]') ||
        element.closest('article') ||
        element.closest('[role="article"]')
      );
    }

    return element.closest('article, [role="article"], section');
  }

  function findBestImageContextInMessage(root) {
    const imageCandidates = [];

    root.querySelectorAll('img').forEach((img) => {
      if (!(img instanceof HTMLImageElement) || !isLikelyImageCandidate(img)) {
        return;
      }

      const context = buildImageContextFromImg(img);
      if (!context || !context.imageUrl) {
        return;
      }

      imageCandidates.push({
        context,
        score: scoreImageCandidate(context.width, context.height)
      });
    });

    root.querySelectorAll('*').forEach((el) => {
      if (!(el instanceof HTMLElement)) {
        return;
      }

      const backgroundUrl = extractBackgroundImageUrl(el);
      if (!backgroundUrl) {
        return;
      }

      const rect = el.getBoundingClientRect();
      const width = Math.round(rect.width || 0);
      const height = Math.round(rect.height || 0);
      if (!isLargeEnough(width, height)) {
        return;
      }

      imageCandidates.push({
        context: {
          imageUrl: backgroundUrl,
          width,
          height,
          sourceElement: el
        },
        score: scoreImageCandidate(width, height)
      });
    });

    imageCandidates.sort((a, b) => b.score - a.score);
    return imageCandidates[0] ? imageCandidates[0].context : null;
  }

  function isLikelyImageCandidate(img) {
    const url = img.currentSrc || img.src || '';
    if (!url || url.startsWith('data:')) {
      return false;
    }

    const width = img.naturalWidth || img.width || Math.round(img.getBoundingClientRect().width || 0);
    const height =
      img.naturalHeight || img.height || Math.round(img.getBoundingClientRect().height || 0);

    if (!isLargeEnough(width, height)) {
      return false;
    }

    const alt = (img.getAttribute('alt') || '').toLowerCase();
    if (alt && /(avatar|icon|logo|profile)/.test(alt)) {
      return false;
    }

    return true;
  }

  function isLargeEnough(width, height) {
    return width >= 160 && height >= 160;
  }

  function scoreImageCandidate(width, height) {
    return Math.max(width, 0) * Math.max(height, 0);
  }

  function getStorageArea() {
    if (!chrome.storage) {
      return null;
    }
    return chrome.storage.sync || chrome.storage.local || null;
  }

  function loadSettings() {
    if (settingsPromise) {
      return settingsPromise;
    }

    const storage = getStorageArea();
    if (!storage) {
      settingsPromise = Promise.resolve(settingsCache);
      return settingsPromise;
    }

    settingsPromise = new Promise((resolve) => {
      storage.get(DEFAULT_SETTINGS, (items) => {
        settingsCache = { ...DEFAULT_SETTINGS, ...(items || {}) };
        resolve(settingsCache);
      });
    });

    return settingsPromise;
  }

  function updateSettingsCache(changes) {
    Object.keys(changes).forEach((key) => {
      settingsCache[key] = changes[key].newValue;
    });
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

  async function quickSaveImage(imageContext) {
    const metadata = await buildMetadataFromContext(imageContext);
    downloadWithMetadata(imageContext.imageUrl, metadata, Boolean(metadata.sidecar_fallback));
  }

  async function buildMetadataFromContext(imageContext, overrides = {}) {
    const settings = await loadSettings();
    const sourceElement = imageContext.sourceElement || null;
    const provider = overrides.provider || settings.defaultProvider || inferProvider();
    const prompt =
      overrides.prompt !== undefined ? overrides.prompt : guessPromptText(sourceElement, provider);
    const model =
      overrides.model !== undefined
        ? overrides.model
        : guessModelName(sourceElement, provider) || settings.defaultModel || '';
    const width = overrides.width !== undefined ? overrides.width : imageContext.width || undefined;
    const height =
      overrides.height !== undefined ? overrides.height : imageContext.height || undefined;
    const assistantMessage = sourceElement ? findAssistantMessageContainer(sourceElement) : null;

    return {
      prompt,
      model,
      width,
      height,
      provider,
      source_url: window.location.href,
      page_title: document.title || '',
      page_host: window.location.hostname,
      image_url: imageContext.imageUrl,
      captured_at: new Date().toISOString(),
      source_message_text: extractReadableText(assistantMessage),
      conversation_id: inferConversationId(),
      filename_prefix: settings.filenamePrefix || DEFAULT_SETTINGS.filenamePrefix,
      sidecar_fallback: Boolean(settings.sidecarFallback),
      include_rich_metadata: Boolean(settings.includeRichMetadata),
      _rich_context: {
        schema: 'imagemetahub.browser/1.0',
        app: {
          name: 'Image MetaHub Browser',
          version: getExtensionVersion()
        },
        source: {
          provider,
          url: window.location.href,
          hostname: window.location.hostname,
          title: document.title || '',
          conversation_id: inferConversationId()
        },
        image: {
          url: imageContext.imageUrl,
          width,
          height
        },
        prompt: {
          text: prompt,
          strategy: inferPromptStrategy(provider)
        },
        assistant: {
          excerpt: extractReadableText(assistantMessage)
        }
      }
    };
  }

  function getExtensionVersion() {
    try {
      return chrome.runtime && chrome.runtime.getManifest ? chrome.runtime.getManifest().version : '';
    } catch {
      return '';
    }
  }

  function inferConversationId() {
    const match = window.location.pathname.match(/\/(?:c|chat|conversation)\/([^/?#]+)/i);
    return match ? match[1] : '';
  }

  function inferPromptStrategy(provider) {
    if (provider === 'ChatGPT') {
      return 'chatgpt.previous_user_message';
    }
    if (provider === 'Grok') {
      return 'grok.previous_user_message';
    }
    return 'generic.previous_text_block';
  }

  async function openMetadataModal(imageContext) {
    closeModal();

    const metadataDraft = await buildMetadataFromContext(imageContext);

    const imageUrl = imageContext.imageUrl;
    const width = metadataDraft.width || 0;
    const height = metadataDraft.height || 0;
    const promptPrefill = metadataDraft.prompt || '';
    const promptPrefillEscaped = promptPrefill ? escapeHtml(promptPrefill) : '';
    const modelPrefillEscaped = metadataDraft.model ? escapeHtml(metadataDraft.model) : '';

    modalEl = document.createElement('div');
    modalEl.className = 'imh-modal';

    const provider = metadataDraft.provider || inferProvider();

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
            <input type="text" name="model" placeholder="e.g. GPT-4o Images" value="${modelPrefillEscaped}" />
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
        </div>
        <div class="imh-modal__field" style="grid-column: 1 / -1;">
          <label>
            <input type="checkbox" name="sidecarFallback" ${metadataDraft.sidecar_fallback ? 'checked' : ''} />
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
        handleSave(imageContext, modalEl, metadataDraft);
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

  function handleSave(imageContext, modalRoot, baseMetadata) {
    const form = modalRoot;
    const promptValue = getFieldValue(form, 'prompt');
    const modelValue = getFieldValue(form, 'model');
    const providerValue = getFieldValue(form, 'provider');
    const widthValue = parseNumber(getFieldValue(form, 'width'));
    const heightValue = parseNumber(getFieldValue(form, 'height'));
    const sidecarFallback = isChecked(form, 'sidecarFallback');
    const metadata = {
      ...baseMetadata,
      prompt: promptValue,
      model: modelValue,
      width: widthValue,
      height: heightValue,
      provider: providerValue,
      image_url: imageContext.imageUrl,
      captured_at: new Date().toISOString()
    };

    metadata.sidecar_fallback = sidecarFallback;
    if (metadata._rich_context) {
      metadata._rich_context.source.provider = providerValue;
      metadata._rich_context.source.url = metadata.source_url || window.location.href;
      metadata._rich_context.source.hostname = metadata.page_host || window.location.hostname;
      metadata._rich_context.source.title = metadata.page_title || document.title || '';
      metadata._rich_context.image.url = imageContext.imageUrl;
      metadata._rich_context.image.width = widthValue;
      metadata._rich_context.image.height = heightValue;
      metadata._rich_context.prompt.text = promptValue;
      metadata._rich_context.prompt.strategy = inferPromptStrategy(providerValue);
      metadata._rich_context.assistant.excerpt = metadata.source_message_text || '';
    }

    closeModal();
    downloadWithMetadata(imageContext.imageUrl, metadata, sidecarFallback);
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
        const metadataChunks = [{ type: 'tEXt', keyword: 'parameters', text: parameters }];
        if (metadata.include_rich_metadata !== false) {
          metadataChunks.push({
            type: 'iTXt',
            keyword: 'imagemetahub_data',
            text: JSON.stringify(buildRichMetadataEnvelope(metadata), null, 2)
          });
        }
        const embedded = embedPngMetadataChunks(buffer, metadataChunks);
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

  function guessPromptText(sourceElement, providerOverride) {
    if (!sourceElement || !(sourceElement instanceof Element)) {
      return '';
    }

    const provider = providerOverride || inferProvider();
    if (provider === 'ChatGPT') {
      const prompt = findChatGptPrompt(sourceElement);
      if (prompt) {
        return prompt;
      }
    }

    if (provider === 'Grok') {
      const prompt = findGrokPrompt(sourceElement);
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

  function findGrokPrompt(sourceElement) {
    const message =
      sourceElement.closest('[data-testid*="assistant"]') ||
      sourceElement.closest('article') ||
      sourceElement.closest('[role="article"]');

    if (message) {
      let current = message.previousElementSibling;
      while (current) {
        const explicitUser = current.matches('[data-testid*="user"]')
          ? current
          : current.querySelector('[data-testid*="user"]');
        const explicitUserText = extractReadableText(explicitUser || current);
        if (explicitUserText) {
          return explicitUserText;
        }
        current = current.previousElementSibling;
      }
    }

    return findGenericPrompt(sourceElement);
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

  function guessModelName(sourceElement, providerOverride) {
    const provider = providerOverride || inferProvider();

    if (provider === 'ChatGPT') {
      return findKnownModelName(
        [
          'button[data-testid*="model"]',
          '[data-testid*="model-switcher"]',
          'header button',
          'nav button'
        ],
        sourceElement,
        document.title,
        [
          'GPT-4o',
          'GPT-4.1',
          'GPT-4.5',
          'GPT-Image-1',
          'o4-mini',
          'o3',
          'o1'
        ]
      );
    }

    if (provider === 'Grok') {
      return findKnownModelName(
        [
          '[data-testid*="model"]',
          'header button',
          'nav button',
          'button[aria-haspopup="menu"]'
        ],
        sourceElement,
        document.title,
        ['Grok 3 Think', 'Grok 3', 'Grok 2']
      );
    }

    return '';
  }

  function findKnownModelName(selectors, sourceElement, fallbackText, knownModels) {
    const texts = [];

    selectors.forEach((selector) => {
      document.querySelectorAll(selector).forEach((el) => {
        const text = normalizeTextForMatch(
          el.innerText || el.textContent || el.getAttribute('aria-label') || ''
        );
        if (text) {
          texts.push(text);
        }
      });
    });

    const bodyExcerpt = normalizeTextForMatch(document.body ? document.body.innerText : '');
    if (fallbackText) {
      texts.push(normalizeTextForMatch(fallbackText));
    }
    if (sourceElementHasUsefulText(sourceElement)) {
      texts.push(normalizeTextForMatch(sourceElement.innerText || ''));
    }
    if (bodyExcerpt) {
      texts.push(bodyExcerpt.slice(0, 2000));
    }

    for (const model of knownModels) {
      const normalizedModel = normalizeTextForMatch(model);
      if (texts.some((text) => text.includes(normalizedModel))) {
        return model;
      }
    }

    return '';
  }

  function sourceElementHasUsefulText(sourceElement) {
    return Boolean(sourceElement && sourceElement instanceof Element && sourceElement.innerText);
  }

  function normalizeTextForMatch(value) {
    return String(value || '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  }

  function extractReadableText(element) {
    if (!element || !(element instanceof Element)) {
      return '';
    }
    const clone = element.cloneNode(true);
    if (clone instanceof Element) {
      clone.querySelectorAll('.imh-inline-action-row').forEach((el) => el.remove());
    }
    const text = ((clone instanceof HTMLElement ? clone.innerText : element.innerText) || '').trim();
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
    const jsonPayload = JSON.stringify(buildRichMetadataEnvelope(metadata), null, 2);
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

  function buildRichMetadataEnvelope(metadata) {
    const richContext = metadata._rich_context || {};

    return {
      schema: richContext.schema || 'imagemetahub.browser/1.0',
      metadata: {
        prompt: metadata.prompt || '',
        model: metadata.model || '',
        provider: metadata.provider || '',
        width: metadata.width || null,
        height: metadata.height || null,
        captured_at: metadata.captured_at || '',
        source_url: metadata.source_url || '',
        image_url: metadata.image_url || ''
      },
      source: richContext.source || {
        provider: metadata.provider || '',
        url: metadata.source_url || '',
        hostname: metadata.page_host || '',
        title: metadata.page_title || '',
        conversation_id: metadata.conversation_id || ''
      },
      image: richContext.image || {
        url: metadata.image_url || '',
        width: metadata.width || null,
        height: metadata.height || null
      },
      prompt: richContext.prompt || {
        text: metadata.prompt || '',
        strategy: inferPromptStrategy(metadata.provider || '')
      },
      assistant: richContext.assistant || {
        excerpt: metadata.source_message_text || ''
      },
      app: richContext.app || {
        name: 'Image MetaHub Browser',
        version: getExtensionVersion()
      }
    };
  }

  function embedPngMetadataChunks(buffer, chunks) {
    const bytes = new Uint8Array(buffer);
    const builtChunks = chunks
      .filter((chunk) => chunk && chunk.keyword && chunk.text)
      .map((chunk) => {
        if (chunk.type === 'iTXt') {
          return buildPngITextChunk(chunk.keyword, chunk.text);
        }
        return buildPngTextChunk(chunk.keyword, chunk.text);
      });

    if (!builtChunks.length) {
      return bytes;
    }

    let offset = 8;
    while (offset + 8 <= bytes.length) {
      const length = readUint32(bytes, offset);
      const chunkType = readChunkType(bytes, offset);
      const totalLength = 12 + length;
      if (chunkType === 'IEND') {
        return concatUint8(bytes.slice(0, offset), ...builtChunks, bytes.slice(offset));
      }
      offset += totalLength;
    }
    return bytes;
  }

  function buildPngTextChunk(keyword, text) {
    const data = new TextEncoder().encode(`${keyword}\0${text}`);
    return buildPngChunk(toBytes('tEXt'), data);
  }

  function buildPngITextChunk(keyword, text) {
    const encoder = new TextEncoder();
    const keywordBytes = encoder.encode(keyword);
    const textBytes = encoder.encode(text);
    const data = new Uint8Array(keywordBytes.length + 5 + textBytes.length);
    data.set(keywordBytes, 0);
    data[keywordBytes.length] = 0;
    data[keywordBytes.length + 1] = 0;
    data[keywordBytes.length + 2] = 0;
    data[keywordBytes.length + 3] = 0;
    data[keywordBytes.length + 4] = 0;
    data.set(textBytes, keywordBytes.length + 5);
    return buildPngChunk(toBytes('iTXt'), data);
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
    const prefix = metadata.filename_prefix || DEFAULT_SETTINGS.filenamePrefix;
    const provider = metadata.provider || 'online';
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const safePrefix = slugify(prefix);
    const safeProvider = slugify(provider);
    return `${safePrefix}-${safeProvider}-${timestamp}`;
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
    loadSettings();
    queueInlineActionRefresh();
    const observer = new MutationObserver(() => queueInlineActionRefresh());
    observer.observe(document.documentElement || document.body, {
      childList: true,
      subtree: true
    });
    document.addEventListener('load', queueInlineActionRefresh, true);
    window.addEventListener('pageshow', queueInlineActionRefresh);
    if (chrome.storage && chrome.storage.onChanged) {
      chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName === 'sync' || areaName === 'local') {
          updateSettingsCache(changes);
        }
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
