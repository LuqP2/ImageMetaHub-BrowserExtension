(() => {
  const INLINE_ACTION_ATTR = 'data-imh-save-action';
  const MESSAGE_HOST_ATTR = 'data-imh-save-host';
  const GALLERY_ACTION_ATTR = 'data-imh-gallery-action';
  const PRIMARY_ACTION_LABEL = 'Save to MetaHub';
  const BROWSER_METADATA_CHUNK_KEY = 'imh_browser_data';
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
  const dirtyRoots = new Set();

  function queueInlineActionRefresh(root = document) {
    dirtyRoots.add(root instanceof Element ? root : document);
    if (refreshQueued) {
      return;
    }

    refreshQueued = true;
    window.setTimeout(() => {
      refreshQueued = false;
      const roots = Array.from(dirtyRoots).filter((scope, index, all) => !all.some((other, otherIndex) => otherIndex !== index && other.contains(scope)));
      dirtyRoots.clear();
      roots.forEach((scope) => refreshInlineActions(scope));
    }, 100);
  }

  function refreshInlineActions(scope = document) {
    const provider = inferProvider();
    if (provider === 'ChatGPT' || provider === 'Gemini') {
      ensureImageActions(scope, provider);
      return;
    }
    const messageContainers = collectAssistantMessagesWithImages();
    messageContainers.forEach((messageEl) => ensureInlineAction(messageEl));

    if (isChatGptImagesPage()) {
      const galleryHosts = collectStandaloneImageHosts();
      galleryHosts.forEach((hostEl) => ensureGalleryAction(hostEl));
    }
  }

  function collectAssistantMessagesWithImages() {
    const containers = new Set();
    const provider = inferProvider();
    const providerMessageCandidates = collectProviderMessageCandidates(provider);

    providerMessageCandidates.forEach((messageEl) => {
      if (!(messageEl instanceof HTMLElement)) {
        return;
      }

      if (findBestImageContextInMessage(messageEl)) {
        containers.add(messageEl);
      }
    });

    if (!containers.size) {
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
    }

    return Array.from(containers);
  }

  function collectProviderMessageCandidates(provider) {
    const selectors = getAssistantMessageSelectors(provider);
    const candidates = new Set();

    for (const selector of selectors) {
      const matches = Array.from(document.querySelectorAll(selector)).filter(
        (element) => element instanceof HTMLElement
      );
      if (provider === 'Grok' && matches.length) return matches;
      matches.forEach((element) => candidates.add(element));
    }

    return Array.from(candidates);
  }

  function getAssistantMessageSelectors(provider) {
    if (provider === 'ChatGPT') {
      return [
        '[data-turn-key]',
        '[data-message-author-role="assistant"]',
        '[data-testid*="conversation-turn-assistant"]',
        '[data-testid^="conversation-turn-"]',
        'article',
        '[role="article"]',
        'main section'
      ];
    }

    if (provider === 'Gemini') {
      return [
        'model-response',
        '[data-test-id="conversation-turn-model"]',
        '[data-response-id]',
        'article'
      ];
    }

    if (provider === 'Grok') {
      return [
        '[data-testid="conversation-turn-assistant"]',
        '[data-testid*="assistant"]',
        'article',
        '[role="article"]'
      ];
    }

    return ['article', '[role="article"]', 'section'];
  }

  function ensureImageActions(scope, provider) {
    scope.querySelectorAll(`[${INLINE_ACTION_ATTR}]`).forEach((row) => {
      if (row._imhImage && !row._imhImage.isConnected) row.remove();
    });
    const images = Array.from(scope.querySelectorAll('img'));
    if (scope instanceof HTMLImageElement) images.unshift(scope);
    images.forEach((img) => {
      if (!isLikelyImageCandidate(img)) return;
      const message = findAssistantMessageContainer(img);
      if (!message && !(provider === 'ChatGPT' && isChatGptImagesPage())) return;
      // A combined turn can also contain user-uploaded reference images.
      if (provider === 'ChatGPT' && message && !isChatGptGeneratedImage(img, message)) return;
      if (provider === 'Gemini' && !img.closest('model-response, [data-test-id="conversation-turn-model"], [data-response-id]')) return;
      // Galleries clip their contents to the image height. Put normal-flow
      // controls after the gallery, not below the image inside its preview.
      const gallery = provider === 'ChatGPT' ? img.closest('[data-testid="generated-image-gallery"]') : null;
      const host = gallery?.parentElement || img.closest('[data-testid="generated-image-preview"]')?.parentElement || img.parentElement;
      if (!(host instanceof HTMLElement)) return;
      let row = Array.from(host.children).find((child) => child.getAttribute(INLINE_ACTION_ATTR) === 'true' && child._imhImage === img);
      if (row) return;
      row = document.createElement('div');
      row.className = 'imh-inline-action-row';
      row.setAttribute(INLINE_ACTION_ATTR, 'true');
      row._imhImage = img;
      appendActionButtons(row, () => img.isConnected ? buildImageContextFromImg(img) : null);
      // Never nest our interactive controls inside the site's image button/link.
      const interactive = host.closest('button, a, [role="button"]');
      if (gallery && !interactive) {
        let anchor = gallery;
        while (anchor.nextElementSibling?.getAttribute(INLINE_ACTION_ATTR) === 'true') {
          anchor = anchor.nextElementSibling;
        }
        host.insertBefore(row, anchor.nextSibling);
      } else if (interactive) {
        const parent = interactive.parentElement;
        if (!parent) return;
        const existing = Array.from(parent.children).find((child) => child._imhImage === img);
        if (existing) return;
        parent.insertBefore(row, interactive.nextSibling);
      } else {
        host.appendChild(row);
      }
    });
  }

  function isChatGptGeneratedImage(img, message) {
    if (img.closest('[data-testid="generated-image-preview"], [data-testid="generated-image-gallery"]')) return true;
    if (img.closest('[data-message-author-role="user"]')) return false;
    if (img.closest('[data-message-author-role="assistant"], [data-testid*="conversation-turn-assistant"]')) return true;
    const heading = Array.from(message.querySelectorAll('h4')).find((el) => /^ChatGPT said\s*:/i.test(el.textContent.trim()));
    return Boolean(heading && (heading.compareDocumentPosition(img) & Node.DOCUMENT_POSITION_FOLLOWING));
  }

  function ensureInlineAction(messageEl) {
    if (!(messageEl instanceof HTMLElement)) {
      return;
    }

    const provider = inferProvider();
    const imageContext = findBestImageContextInMessage(messageEl);
    if (!imageContext) {
      return;
    }

    const inlineActionHost = getInlineActionHost(messageEl, imageContext, provider);
    const existing = inlineActionHost.querySelector(`[${INLINE_ACTION_ATTR}="true"]`);
    if (existing) {
      return;
    }

    messageEl.setAttribute(MESSAGE_HOST_ATTR, 'true');

    if (inlineActionHost !== messageEl) {
      attachOverlayActionRow(
        inlineActionHost,
        INLINE_ACTION_ATTR,
        () => findBestImageContextInMessage(messageEl) || imageContext
      );
      return;
    }

    const row = document.createElement('div');
    row.className = 'imh-inline-action-row';
    row.setAttribute(INLINE_ACTION_ATTR, 'true');
    appendActionButtons(row, () => findBestImageContextInMessage(messageEl) || imageContext);
    messageEl.appendChild(row);
  }

  function collectStandaloneImageHosts() {
    const hosts = new Set();

    document.querySelectorAll('img').forEach((img) => {
      if (!(img instanceof HTMLImageElement) || !isLikelyImageCandidate(img)) {
        return;
      }

      if (findAssistantMessageContainer(img)) {
        return;
      }

      const host = findStandaloneImageHost(img);
      if (host) {
        hosts.add(host);
      }
    });

    return Array.from(hosts);
  }

  function findStandaloneImageHost(element) {
    if (!element || !(element instanceof Element)) {
      return null;
    }

    const selectors = [
      '[data-testid*="image"]',
      '[data-testid*="asset"]',
      '[data-testid*="media"]',
      '[role="listitem"]',
      'figure',
      'article',
      'li',
      'a',
      'button'
    ];

    for (const selector of selectors) {
      const match = element.closest(selector);
      if (match instanceof HTMLElement && match !== document.body && match !== document.documentElement) {
        return normalizeActionHost(match);
      }
    }

    let current = element.parentElement;
    while (current && current !== document.body && current !== document.documentElement) {
      const rect = current.getBoundingClientRect();
      if (rect.width >= 160 && rect.height >= 160 && rect.width < window.innerWidth * 0.98) {
        return normalizeActionHost(current);
      }
      current = current.parentElement;
    }

    return element.parentElement instanceof HTMLElement ? normalizeActionHost(element.parentElement) : null;
  }

  function normalizeActionHost(host) {
    if (!(host instanceof HTMLElement)) {
      return null;
    }

    if ((host.tagName === 'A' || host.tagName === 'BUTTON') && host.parentElement instanceof HTMLElement) {
      return host.parentElement;
    }

    return host;
  }

  function ensureGalleryAction(hostEl) {
    if (!(hostEl instanceof HTMLElement)) {
      return;
    }

    const existing = hostEl.querySelector(`[${GALLERY_ACTION_ATTR}="true"]`);
    if (existing) {
      return;
    }

    const imageContext = findBestImageContextInMessage(hostEl);
    if (!imageContext) {
      return;
    }

    attachOverlayActionRow(
      hostEl,
      GALLERY_ACTION_ATTR,
      () => findBestImageContextInMessage(hostEl) || imageContext
    );
  }

  function getInlineActionHost(messageEl, imageContext, provider) {
    if (provider === 'Grok') {
      const imageHost = findStandaloneImageHost(imageContext.sourceElement);
      if (imageHost instanceof HTMLElement) {
        return imageHost;
      }
    }

    return messageEl;
  }

  function attachOverlayActionRow(hostEl, attrName, getImageContext) {
    hostEl.classList.add('imh-image-host');
    const computedStyle = window.getComputedStyle(hostEl);
    if (computedStyle.position === 'static') {
      hostEl.style.position = 'relative';
    }

    const row = document.createElement('div');
    row.className = 'imh-inline-action-row imh-inline-action-row--overlay';
    row.setAttribute(attrName, 'true');
    appendActionButtons(row, getImageContext);
    hostEl.appendChild(row);
  }

  function appendActionButtons(row, getImageContext) {
    const provider = inferProvider();
    const prefersMetadataModal = shouldOpenMetadataModalByDefault(provider);
    row.dataset.imhProvider = provider.toLowerCase();
    const saveButton = document.createElement('button');
    saveButton.type = 'button';
    saveButton.className = 'imh-inline-action imh-inline-action--primary';
    saveButton.textContent = PRIMARY_ACTION_LABEL;
    saveButton.title = prefersMetadataModal
      ? 'Review metadata before saving'
      : 'Quick save image to MetaHub';
    saveButton.addEventListener('click', async (event) => {
      event.preventDefault();
      event.stopPropagation();

      const latestImageContext = getImageContext();
      if (!latestImageContext) {
        showToast('No image found in this item');
        return;
      }

      if (prefersMetadataModal) {
        await openMetadataModal(latestImageContext);
        return;
      }

      await quickSaveImage(latestImageContext);
    });

    row.appendChild(saveButton);

    if (!prefersMetadataModal) {
      const editButton = document.createElement('button');
      editButton.type = 'button';
      editButton.className = 'imh-inline-action imh-inline-action--secondary';
      editButton.textContent = 'Edit';
      editButton.title = 'Review metadata before saving';
      editButton.addEventListener('click', async (event) => {
        event.preventDefault();
        event.stopPropagation();

        const latestImageContext = getImageContext();
        if (!latestImageContext) {
          showToast('No image found in this item');
          return;
        }

        await openMetadataModal(latestImageContext);
      });

      row.appendChild(editButton);
    }
  }

  function shouldOpenMetadataModalByDefault(provider) {
    return provider === 'Grok';
  }

  function findAssistantMessageContainer(element) {
    if (!element || !(element instanceof Element)) {
      return null;
    }

    const provider = inferProvider();

    if (provider === 'ChatGPT') {
      return findClosestBySelectorPriority(element, getAssistantMessageSelectors(provider));
    }

    if (provider === 'Gemini') {
      return findClosestBySelectorPriority(element, getAssistantMessageSelectors(provider));
    }

    if (provider === 'Grok') {
      return findClosestBySelectorPriority(element, getAssistantMessageSelectors(provider));
    }

    return findClosestBySelectorPriority(element, getAssistantMessageSelectors(provider));
  }

  function findClosestBySelectorPriority(element, selectors) {
    for (const selector of selectors) {
      const match = element.closest(selector);
      if (match) {
        return match;
      }
    }

    return null;
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
    return downloadWithMetadata(imageContext.imageUrl, metadata, Boolean(metadata.sidecar_fallback));
  }

  async function buildMetadataFromContext(imageContext, overrides = {}) {
    const settings = await loadSettings();
    const sourceElement = imageContext.sourceElement || null;
    const provider = overrides.provider || settings.defaultProvider || inferProvider();
    const prompt =
      overrides.prompt !== undefined ? overrides.prompt : guessPromptText(sourceElement, inferProvider());
    const model =
      overrides.model !== undefined
        ? overrides.model
        : guessModelName(sourceElement, inferProvider()) || settings.defaultModel || '';
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

  function isChatGptImagesPage() {
    return inferProvider() === 'ChatGPT' && /^\/images(?:\/|$)/i.test(window.location.pathname);
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
        if (!/^https:/i.test(imageUrl)) throw new Error('Image bytes are unavailable in this page');
        await downloadRemoteUrl(imageUrl, `${baseName}.${extension}`);
        if (sidecarFallback) {
          await saveSidecar(baseName, metadata);
        }
        showToast(sidecarFallback ? 'Download completed; metadata saved in JSON sidecar' : 'Download completed without embedded metadata');
        return { ok: true, embedded: false };
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
        let outBlob;
        try {
          const buffer = await blob.arrayBuffer();
          const embedded = embedPngMetadataChunks(buffer, buildTextMetadataChunks(metadata));
          outBlob = new Blob([embedded], { type: 'image/png' });
        } catch (error) {
          console.warn('[IMH] Metadata embedding failed', error);
        }
        if (outBlob) {
          await downloadBlob(outBlob, `${baseName}.png`);
          showToast('Download completed: PNG with embedded metadata');
          return { ok: true, embedded: true };
        }
      }

      await downloadBlob(blob, `${baseName}.${outputExtension}`);
      if (sidecarFallback) {
        await saveSidecar(baseName, metadata);
      }
      showToast(sidecarFallback ? 'Download completed; metadata saved in JSON sidecar' : 'Download completed without embedded metadata');
      return { ok: true, embedded: false };
    } catch (error) {
      console.warn('[IMH] Failed to save image', error);
      if (sidecarFallback) {
        try { await saveSidecar(buildBaseName(metadata), metadata); } catch { /* Report the image failure below. */ }
      }
      showToast(`Download failed: ${error.message || 'Could not save image'}`);
      return { ok: false, error: error.message || 'download-failed' };
    }
  }

  function sendRuntimeMessage(message) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, (response) => {
        const error = chrome.runtime.lastError;
        if (error || !response?.ok) reject(new Error(error?.message || response?.error || 'Extension did not respond'));
        else resolve(response);
      });
    });
  }

  async function downloadRemoteUrl(url, filename) {
    const { id } = await sendRuntimeMessage({ type: 'download-url', url, filename });
    showToast('Download started');
    for (;;) {
      const status = await sendRuntimeMessage({ type: 'download-status', id });
      if (status.state === 'complete') return id;
      if (status.state === 'interrupted') throw new Error(status.error || 'Download interrupted');
      await new Promise((resolve) => window.setTimeout(resolve, 500));
    }
  }

  async function downloadBlob(blob, filename) {
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('Could not read image bytes'));
      reader.readAsDataURL(blob);
    });
    return downloadRemoteUrl(dataUrl, filename);
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
        if (blob.type.startsWith('image/')) return { blob, type: blob.type };
      } catch {
        // Try next credential mode.
      }
    }

    const backgroundResult = /^https:/i.test(imageUrl) ? await fetchImageBlobViaBackground(imageUrl) : null;
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
      return findChatGptPrompt(sourceElement);
    }

    if (provider === 'Grok') {
      const prompt = findGrokPrompt(sourceElement);
      if (prompt) {
        return prompt;
      }
    }

    if (provider === 'Gemini') {
      return findGeminiPrompt(sourceElement);
    }

    return findGenericPrompt(sourceElement);
  }

  function findChatGptPrompt(sourceElement) {
    const turn = sourceElement.closest('[data-turn-key], [data-testid^="conversation-turn-"], article, [role="article"]');
    const userSelector = '[data-message-author-role="user"], [data-testid*="conversation-turn-user"], [data-testid*="user-message"]';
    if (turn) {
      const user = turn.matches(userSelector) ? turn : turn.querySelector(userSelector);
      if (user) return extractPromptText(user);
      const headings = Array.from(turn.querySelectorAll('h4'));
      const userHeading = headings.find((el) => /^You said\s*:/i.test(el.textContent.trim()));
      const assistantHeading = headings.find((el) => /^ChatGPT said\s*:/i.test(el.textContent.trim()));
      if (userHeading && assistantHeading) {
        const range = document.createRange();
        range.setStartAfter(userHeading);
        range.setEndBefore(assistantHeading);
        const fragment = document.createElement('div');
        fragment.appendChild(range.cloneContents());
        return extractPromptText(fragment);
      }
    }
    const message = turn || sourceElement.closest('[data-message-author-role="assistant"]');
    if (!message) return '';
    return findPreviousExplicitPrompt(message, userSelector);
  }

  function findGeminiPrompt(sourceElement) {
    const response = sourceElement.closest('model-response, [data-test-id="conversation-turn-model"], [data-response-id]');
    if (!response) return '';
    const selector = '.query-text, user-query, [data-test-id="conversation-turn-user"]';
    return findPreviousExplicitPrompt(response, selector);
  }

  function findPreviousExplicitPrompt(start, selector) {
    let current = start;
    for (let depth = 0; current && depth < 8; depth++, current = current.parentElement) {
      let sibling = current.previousElementSibling;
      while (sibling) {
        const matches = sibling.matches(selector) ? [sibling] : Array.from(sibling.querySelectorAll(selector));
        const match = matches[matches.length - 1];
        if (match) return extractPromptText(match);
        // Don't cross another assistant response with no corresponding request.
        if (sibling.matches('model-response, [data-message-author-role="assistant"], [data-turn-key]')) return '';
        sibling = sibling.previousElementSibling;
      }
      if (current.matches('main, body')) break;
    }
    return '';
  }

  function extractPromptText(element) {
    if (!(element instanceof Element)) return '';
    const clone = element.cloneNode(true);
    clone.querySelectorAll('.imh-inline-action-row, button, [role="button"], nav, svg, script, style, textarea, input, [contenteditable="true"], [aria-hidden="true"]').forEach((el) => el.remove());
    clone.querySelectorAll('h1, h2, h3, h4, h5, h6, .sr-only, .visually-hidden, [role="heading"]').forEach((el) => {
      if (/^(You said|ChatGPT said|Gemini said)\s*:?$/i.test(el.textContent.trim())) el.remove();
    });
    return readableBlockText(clone).replace(/\n{3,}/g, '\n\n').trim();
  }

  function readableBlockText(root) {
    function read(node) {
      if (node.nodeType === Node.TEXT_NODE) return node.textContent;
      if (!(node instanceof Element)) return '';
      if (node.tagName === 'BR') return '\n';
      const text = Array.from(node.childNodes).map(read).join('');
      if (node.tagName === 'LI') return `\n- ${text.trim()}\n`;
      if (/^(P|DIV|SECTION|ARTICLE|H[1-6]|UL|OL|BLOCKQUOTE|PRE)$/.test(node.tagName)) return `\n${text}\n`;
      return text;
    }
    return read(root).split('\n').map((line) => line.replace(/[\t ]+/g, ' ').trim()).join('\n');
  }

  function findGrokPrompt(sourceElement) {
    const promptFromConversation = findGrokConversationPrompt(sourceElement);
    if (promptFromConversation) {
      return promptFromConversation;
    }

    const promptFromInputs = findGrokPromptFromInputs(sourceElement);
    if (promptFromInputs) {
      return promptFromInputs;
    }

    const promptFromAttributes = findGrokPromptFromImageAttributes(sourceElement);
    if (promptFromAttributes) {
      return promptFromAttributes;
    }

    const promptFromNearbyPromptBlocks = findGrokPromptFromNearbyPromptBlocks(sourceElement);
    if (promptFromNearbyPromptBlocks) {
      return promptFromNearbyPromptBlocks;
    }

    return findGenericPrompt(sourceElement);
  }

  function findGrokConversationPrompt(sourceElement) {
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

    return '';
  }

  function findGrokPromptFromInputs(sourceElement) {
    const roots = collectPromptSearchRoots(sourceElement);
    const preferredSelectors = [
      'textarea[placeholder*="prompt" i]',
      'textarea[placeholder*="describe" i]',
      'textarea[placeholder*="imagine" i]',
      'textarea[aria-label*="prompt" i]',
      'textarea[aria-label*="describe" i]',
      'textarea[aria-label*="imagine" i]',
      'input[type="text"][placeholder*="prompt" i]',
      'input[type="text"][placeholder*="describe" i]',
      'input[type="text"][placeholder*="imagine" i]',
      'input[type="text"][aria-label*="prompt" i]',
      'input[type="text"][aria-label*="describe" i]',
      'input[type="text"][aria-label*="imagine" i]',
      '[contenteditable="true"][aria-label*="prompt" i]',
      '[contenteditable="true"][aria-label*="describe" i]',
      '[contenteditable="true"][aria-label*="imagine" i]',
      '[role="textbox"][aria-label*="prompt" i]',
      '[role="textbox"][aria-label*="describe" i]',
      '[role="textbox"][aria-label*="imagine" i]'
    ];
    const fallbackSelectors = ['textarea', 'input[type="text"]', '[contenteditable="true"]', '[role="textbox"]'];

    const preferredPrompt = findPromptInRoots(roots, preferredSelectors);
    if (preferredPrompt) {
      return preferredPrompt;
    }

    return findPromptInRoots(roots, fallbackSelectors);
  }

  function findGrokPromptFromImageAttributes(sourceElement) {
    const imageEl =
      sourceElement instanceof HTMLImageElement
        ? sourceElement
        : sourceElement.querySelector('img') || sourceElement.closest('img');
    const elements = [imageEl, findStandaloneImageHost(sourceElement), sourceElement];
    const attributes = ['alt', 'title', 'aria-label', 'data-prompt', 'data-description', 'data-caption'];

    for (const element of elements) {
      if (!(element instanceof Element)) {
        continue;
      }

      for (const attribute of attributes) {
        const text = cleanExtractedText(element.getAttribute(attribute) || '');
        if (text && !isLikelyUiLine(text)) {
          return text;
        }
      }
    }

    return '';
  }

  function findGrokPromptFromNearbyPromptBlocks(sourceElement) {
    const roots = collectPromptSearchRoots(sourceElement);
    const selectors = [
      '[data-testid*="prompt"]',
      '[data-testid*="query"]',
      '[data-testid*="composer"]',
      '[aria-label*="prompt" i]',
      '[aria-label*="query" i]',
      '[aria-label*="imagine" i]',
      '[placeholder*="prompt" i]',
      '[placeholder*="describe" i]',
      '[placeholder*="imagine" i]'
    ];

    return findPromptInRoots(roots, selectors, false);
  }

  function collectPromptSearchRoots(sourceElement) {
    const roots = [];
    addUniqueElement(roots, findAssistantMessageContainer(sourceElement));
    addUniqueElement(roots, sourceElement.closest('[data-testid*="assistant"]'));
    addUniqueElement(roots, findStandaloneImageHost(sourceElement));
    addUniqueElement(roots, sourceElement.closest('[role="dialog"]'));
    addUniqueElement(roots, sourceElement.closest('form'));
    addUniqueElement(roots, sourceElement.closest('section'));
    addUniqueElement(roots, sourceElement.closest('article'));
    addUniqueElement(roots, document.body);
    return roots;
  }

  function addUniqueElement(target, element) {
    if (element instanceof Element && !target.includes(element)) {
      target.push(element);
    }
  }

  function findPromptInRoots(roots, selectors, valueOnly = true) {
    for (const root of roots) {
      for (const selector of selectors) {
        const matches = root.querySelectorAll(selector);
        for (const match of matches) {
          const text = valueOnly ? extractTextInputValue(match) : extractPromptLikeText(match);
          if (text) {
            return text;
          }
        }
      }
    }

    return '';
  }

  function extractTextInputValue(element) {
    if (!(element instanceof HTMLElement)) {
      return '';
    }

    const value = 'value' in element && typeof element.value === 'string' ? element.value : '';
    return extractPromptLikeText(value || element);
  }

  function extractPromptLikeText(source) {
    const rawText =
      typeof source === 'string'
        ? source
        : source instanceof HTMLElement
          ? source.innerText || source.textContent || ''
          : '';
    const text = cleanExtractedText(rawText);
    if (!text || text.length < 8 || isLikelyUiLine(text)) {
      return '';
    }
    return text;
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

  function findPreviousSiblingTextBySelectors(startElement, selectors) {
    let current = startElement.previousElementSibling;
    while (current) {
      for (const selector of selectors) {
        const match = current.matches(selector) ? current : current.querySelector(selector);
        const text = extractReadableText(match || current);
        if (text) {
          return text;
        }
      }
      current = current.previousElementSibling;
    }
    return '';
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
      return '';
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
      clone
        .querySelectorAll(
          '.imh-inline-action-row, button, [role="button"], nav, svg, path, script, style'
        )
        .forEach((el) => el.remove());
    }
    const text = ((clone instanceof HTMLElement ? clone.innerText : element.innerText) || '').trim();
    if (!text) {
      return '';
    }
    const cleaned = cleanExtractedText(text);
    if (!cleaned || cleaned.length < 8) {
      return '';
    }
    return cleaned;
  }

  function cleanExtractedText(text) {
    const lines = String(text || '')
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean)
      .filter((line) => !isLikelyUiLine(line));

    return lines.join(' ').replace(/\s+/g, ' ').trim();
  }

  async function fetchImageBlobViaBackground(imageUrl) {
    if (!chrome.runtime || !chrome.runtime.sendMessage) {
      return null;
    }

    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'fetch-image', url: imageUrl }, (response) => {
        if (chrome.runtime.lastError || !response || !response.ok || !response.base64) {
          resolve(null);
          return;
        }
        const mimeType = response.type || inferMimeTypeFromUrl(imageUrl);
        const bytes = Uint8Array.from(atob(response.base64), (char) => char.charCodeAt(0));
        const blob = new Blob([bytes], { type: mimeType || undefined });
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

  function isLikelyUiLine(text) {
    const normalized = normalizeTextForMatch(text);
    if (!normalized) {
      return true;
    }

    const exactMatches = new Set([
      'save to metahub',
      'save',
      'edit',
      'copy',
      'share',
      'report',
      'download',
      'like',
      'dislike',
      'retry',
      'try again',
      'regenerate',
      'good response',
      'bad response',
      'copy prompt',
      'copy raw metadata',
      'show in folder',
      'add to compare'
    ]);

    if (exactMatches.has(normalized)) {
      return true;
    }

    if (/^\d{1,2}\/\d{1,2}\/\d{2,4},?\s+\d{1,2}:\d{2}(?::\d{2})?\s*(am|pm)?$/i.test(text.trim())) {
      return true;
    }

    return normalized.length <= 24 && isLikelyUiText(normalized);
  }

  function findLastTextBySelectors(selectors) {
    for (const selector of selectors) {
      const matches = Array.from(document.querySelectorAll(selector));
      for (let index = matches.length - 1; index >= 0; index -= 1) {
        const text = extractReadableText(matches[index]);
        if (text) {
          return text;
        }
      }
    }
    return '';
  }

  function saveSidecar(baseName, metadata) {
    const jsonFilename = `${baseName}.json`;
    const jsonPayload = JSON.stringify(buildRichMetadataEnvelope(metadata), null, 2);
    const jsonBlob = new Blob([jsonPayload], { type: 'application/json' });
    return downloadBlob(jsonBlob, jsonFilename);
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
    const negative = metadata.negative_prompt || metadata.negativePrompt || '';
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

  function buildTextMetadataChunks(metadata) {
    const parameters = buildParametersString(metadata);
    const chunks = [{ type: 'tEXt', keyword: 'parameters', text: parameters }];
    const prompt = String(metadata.prompt || '').trim();

    if (prompt) {
      chunks.push({ type: 'tEXt', keyword: 'prompt', text: prompt });
      chunks.push({ type: 'tEXt', keyword: 'Description', text: prompt });
    }

    if (metadata.include_rich_metadata !== false) {
      chunks.push({
        type: 'iTXt',
        keyword: BROWSER_METADATA_CHUNK_KEY,
        text: JSON.stringify(buildRichMetadataEnvelope(metadata), null, 2)
      });
    }

    return chunks;
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
    const observer = new MutationObserver((mutations) => {
      if (inferProvider() === 'Grok') {
        queueInlineActionRefresh();
        return;
      }
      for (const mutation of mutations) {
        const target = mutation.target instanceof Element ? mutation.target : mutation.target.parentElement;
        if (!target || target.closest('.imh-inline-action-row, .imh-modal, .imh-toast')) continue;
        const changedNodes = [...mutation.addedNodes, ...mutation.removedNodes];
        if (changedNodes.length && changedNodes.every((node) => node instanceof Element && node.matches('.imh-inline-action-row, .imh-modal, .imh-toast'))) continue;
        const message = target.closest('[data-turn-key], [data-testid^="conversation-turn-"], [data-message-author-role], model-response, [data-response-id], article');
        if (message) queueInlineActionRefresh(message);
        else {
          mutation.addedNodes.forEach((node) => {
            if (node instanceof Element && (node.matches('main') || node.closest('main'))) queueInlineActionRefresh(node);
          });
        }
      }
    });
    observer.observe(document.documentElement || document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['src', 'srcset', 'width', 'height']
    });
    document.addEventListener('load', (event) => {
      if (event.target instanceof HTMLImageElement) queueInlineActionRefresh(event.target.parentElement || event.target);
    }, true);
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
