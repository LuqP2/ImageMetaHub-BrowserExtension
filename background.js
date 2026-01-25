chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || !message.type) {
    return;
  }

  if (message.type === 'download-url') {
    const url = message.url;
    const filename = message.filename;

    if (!url || !filename) {
      return;
    }

    chrome.downloads.download({
      url,
      filename,
      conflictAction: 'uniquify',
      saveAs: false
    });

    return;
  }

  if (message.type === 'fetch-image') {
    const url = message.url;
    if (!url) {
      sendResponse({ ok: false, error: 'missing-url' });
      return;
    }

    fetchImage(url)
      .then((result) => {
        if (!result) {
          sendResponse({ ok: false, error: 'fetch-failed' });
          return;
        }
        sendResponse({ ok: true, buffer: result.buffer, type: result.type });
      })
      .catch((error) => {
        sendResponse({ ok: false, error: String(error) });
      });

    return true;
  }
});

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
      return { buffer, type: response.headers.get('content-type') || '' };
    } catch {
      // Try next credential mode.
    }
  }
  return null;
}
