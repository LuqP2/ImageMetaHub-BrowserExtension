chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || !message.type) {
    return;
  }

  if (message.type === 'download-url') {
    const url = message.url;
    const filename = message.filename;

    if (!url || !filename) {
      sendResponse({ ok: false, error: 'missing-download' });
      return false;
    }

    if (!isAllowedImageUrl(url) && !/^data:(image\/png|image\/jpeg|image\/webp|application\/json);base64,/i.test(url)) {
      sendResponse({ ok: false, error: 'unsupported-download-url' });
      return false;
    }

    chrome.downloads.download({
      url,
      filename,
      conflictAction: 'uniquify',
      saveAs: false
    }, (id) => {
      const error = chrome.runtime.lastError;
      sendResponse(error ? { ok: false, error: error.message } : { ok: true, id });
    });
    return true;
  }

  if (message.type === 'download-status') {
    if (!Number.isInteger(message.id)) {
      sendResponse({ ok: false, error: 'invalid-download-id' });
      return false;
    }
    chrome.downloads.search({ id: message.id }, (items) => {
      const error = chrome.runtime.lastError;
      const item = items?.[0];
      sendResponse(error || !item ? { ok: false, error: error?.message || 'download-not-found' } : { ok: true, state: item.state, error: item.error });
    });
    return true;
  }

  if (message.type === 'fetch-image') {
    const url = message.url;
    if (!isAllowedImageUrl(url)) {
      sendResponse({ ok: false, error: 'missing-url' });
      return;
    }

    fetchImage(url)
      .then((result) => {
        if (!result) {
          sendResponse({ ok: false, error: 'fetch-failed' });
          return;
        }
        sendResponse({ ok: true, base64: result.base64, type: result.type });
      })
      .catch((error) => {
        sendResponse({ ok: false, error: String(error) });
      });

    return true;
  }
});

if (chrome.action && chrome.runtime && chrome.runtime.openOptionsPage) {
  chrome.action.onClicked.addListener(() => {
    chrome.runtime.openOptionsPage();
  });
}

async function fetchImage(url) {
  const attempts = [
    { credentials: 'omit' },
    { credentials: 'include' }
  ];

  for (const attempt of attempts) {
    try {
      const response = await fetch(url, {
        credentials: attempt.credentials
      });
      if (!response.ok) {
        continue;
      }
      const buffer = await response.arrayBuffer();
      const type = response.headers.get('content-type') || '';
      if (!type.toLowerCase().startsWith('image/')) continue;
      const bytes = new Uint8Array(buffer);
      let binary = '';
      for (let offset = 0; offset < bytes.length; offset += 32768) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
      }
      return { base64: btoa(binary), type };
    } catch {
      // Try next credential mode.
    }
  }
  return null;
}

function isAllowedImageUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && /(^|\.)(chatgpt\.com|openai\.com|gemini\.google\.com|lh3\.googleusercontent\.com|lh3\.google\.com|grok\.com|x\.ai)$/.test(url.hostname);
  } catch {
    return false;
  }
}
