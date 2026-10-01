const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');

const contentSource = fs.readFileSync(require.resolve('../content.js'), 'utf8');
function page(html, provider = 'chatgpt.com', sendMessage = (_msg, cb) => cb({ ok: true })) {
  const dom = new JSDOM(html, { url: `https://${provider}/c/synthetic`, runScripts: 'outside-only' });
  const w = dom.window;
  w.chrome = { runtime: { sendMessage, getManifest: () => ({ version: 'test' }) } };
  // Expose functions only in the test copy. Don't boot observers or interact with a browser.
  w.eval(contentSource.replace("  if (document.readyState === 'loading') {", `
    window.testAPI = { refreshInlineActions, findChatGptPrompt, findGeminiPrompt,
      guessPromptText, guessModelName, extractPromptText, collectProviderMessageCandidates,
      fetchImageBlob, downloadRemoteUrl, downloadWithMetadata, buildTextMetadataChunks,
      buildMetadataFromContext };
    return;
    if (document.readyState === 'loading') {`));
  return { dom, w, document: w.document, api: w.testAPI };
}
const image = (id) => `<img id="${id}" src="https://chatgpt.com/synthetic-${id}.png" width="512" height="512">`;
const turn = (id, text, pictures) => `<div data-turn-key="${id}"><h4 class="sr-only">You said:</h4><div><p>${text}</p></div><button>Copy message</button><h4>ChatGPT said:</h4><div data-testid="generated-image-gallery">${pictures.map(i => `<div><button data-testid="generated-image-preview">${image(i)}</button></div>`).join('')}</div></div>`;

test('new turns: one action per generated image, outside native buttons; refresh is idempotent', () => {
  const { dom, document: d, api } = page(`<main>${turn('a', 'Invent a silver clock', ['a1', 'a2'])}${turn('b', 'Try a blue frame', ['b1'])}</main>`);
  api.refreshInlineActions();
  api.refreshInlineActions();
  assert.equal(d.querySelectorAll('[data-imh-save-action]').length, 3);
  assert.equal(d.querySelectorAll('button [data-imh-save-action]').length, 0);
  // Real galleries have a fixed image height and overflow:hidden. Controls
  // below a preview inside that gallery would exist in the DOM but be clipped.
  assert.equal(d.querySelectorAll('[data-testid="generated-image-gallery"] [data-imh-save-action]').length, 0);
  const firstTurnRows = d.querySelector('[data-turn-key="a"]').querySelectorAll('[data-imh-save-action]');
  assert.deepEqual(Array.from(firstTurnRows, row => row._imhImage.id), ['a1', 'a2']);
  assert.equal(api.findChatGptPrompt(d.getElementById('a2')), 'Invent a silver clock');
  assert.equal(api.findChatGptPrompt(d.getElementById('b1')), 'Try a blue frame');
  dom.window.close();
});

test('user references are excluded and remounted images receive fresh controls', () => {
  const { dom, document: d, api } = page(`<main><div data-turn-key="a"><h4>You said:</h4>${image('reference')}<p>Make a clock</p><h4>ChatGPT said:</h4>${image('result')}</div></main>`);
  api.refreshInlineActions();
  assert.equal(d.querySelectorAll('[data-imh-save-action]').length, 1);
  const old = d.getElementById('result');
  const replacement = old.cloneNode();
  old.replaceWith(replacement);
  api.refreshInlineActions();
  assert.equal(d.querySelectorAll('[data-imh-save-action]').length, 1);
  dom.window.close();
});

test('old ChatGPT turns remain supported and unrelated matching containers do not suppress new images', () => {
  const { dom, document: d, api } = page(`<main><div data-message-author-role="assistant">Text only</div><article data-testid="conversation-turn-1"><div data-message-author-role="user"><p>Draw a paper castle</p></div></article><article data-testid="conversation-turn-2"><div data-message-author-role="assistant">${image('legacy')}</div></article>${turn('new', 'Make it green', ['new'])}</main>`);
  assert.equal(api.findChatGptPrompt(d.getElementById('legacy')), 'Draw a paper castle');
  api.refreshInlineActions();
  assert.equal(d.querySelectorAll('[data-imh-save-action]').length, 2);
  dom.window.close();
});

test('missing request stays unknown instead of using a later user message or image alt', () => {
  const { dom, document: d, api } = page(`<main><article data-testid="conversation-turn-1"><div data-message-author-role="assistant">${image('missing')}</div></article><article><div data-message-author-role="user">Unrelated later request</div></article></main>`);
  assert.equal(api.guessPromptText(d.getElementById('missing'), 'ChatGPT'), '');
  d.getElementById('missing').alt = 'A descriptive image title';
  assert.equal(api.guessPromptText(d.getElementById('missing'), 'ChatGPT'), '');
  assert.equal(api.guessModelName(d.getElementById('missing'), 'ChatGPT'), '');
  dom.window.close();
});

test('short referential requests survive; paragraphs and lists remain separate', () => {
  const { dom, document: d, api } = page(`<main>${turn('a', 'Yes', ['result'])}</main>`);
  assert.equal(api.findChatGptPrompt(d.getElementById('result')), 'Yes');
  const prompt = d.createElement('div');
  prompt.innerHTML = '<h4>You said:</h4><p>You said the sky was blue.</p><p>Keep it.</p><ul><li>Add clouds</li><li>Use ink</li></ul>';
  const result = api.extractPromptText(prompt);
  assert.match(result, /^You said the sky was blue\./);
  assert.match(result, /\n\nKeep it\./);
  assert.match(result, /- Add clouds\n/);
  assert.match(result, /- Use ink/);
  dom.window.close();
});

test('Gemini: local query body without interface labels; later requests do not replace old prompts', () => {
  const { dom, document: d, api } = page(`<main><div><user-query><div class="query-text"><span class="sr-only">You said</span><p>Draw a glass bird</p><p>Use pale colors</p></div></user-query><model-response>${image('gemini')}</model-response></div><div><user-query><div class="query-text">Later unrelated request</div></user-query><model-response>Text response</model-response></div></main>`, 'gemini.google.com');
  assert.equal(api.findGeminiPrompt(d.getElementById('gemini')), 'Draw a glass bird\n\nUse pale colors');
  api.refreshInlineActions();
  assert.equal(d.querySelectorAll('[data-imh-save-action]').length, 1);
  dom.window.close();
});

test('blob bytes stay in their owning page and are never sent to background', async () => {
  let backgroundCalls = 0;
  const { dom, w, api } = page('<main></main>', 'chatgpt.com', () => { backgroundCalls++; });
  w.fetch = async () => ({ ok: true, blob: async () => new w.Blob(['synthetic'], { type: 'image/png' }) });
  assert.equal((await api.fetchImageBlob('blob:https://chatgpt.com/synthetic')).type, 'image/png');
  w.fetch = async () => { throw new Error('Expired blob'); };
  assert.equal(await api.fetchImageBlob('blob:https://chatgpt.com/expired'), null);
  assert.equal(backgroundCalls, 0);
  dom.window.close();
});

test('background image bytes survive Chrome JSON serialization', async () => {
  const { dom, w, api } = page('<main></main>', 'chatgpt.com', (_message, cb) => cb(JSON.parse(JSON.stringify({ ok: true, base64: Buffer.from([137, 80, 78, 71]).toString('base64'), type: 'image/png' }))));
  w.fetch = async () => { throw new Error('CORS'); };
  const result = await api.fetchImageBlob('https://chatgpt.com/synthetic.png');
  const bytes = await new Promise((resolve) => {
    const reader = new w.FileReader(); reader.onload = () => resolve(new Uint8Array(reader.result)); reader.readAsArrayBuffer(result.blob);
  });
  assert.deepEqual(Array.from(bytes), [137, 80, 78, 71]);
  dom.window.close();
});

test('completion is confirmed and interrupted downloads reject instead of showing success', async () => {
  let complete = false;
  const { dom, document: d, api } = page('<main></main>', 'chatgpt.com', (message, cb) => cb(message.type === 'download-url' ? { ok: true, id: 7 } : { ok: true, state: complete ? 'complete' : 'interrupted', error: 'NETWORK_FAILED' }));
  await assert.rejects(api.downloadRemoteUrl('https://chatgpt.com/synthetic.png', 'test.png'), /NETWORK_FAILED/);
  assert.equal(d.querySelector('.imh-toast').textContent, 'Download started');
  complete = true;
  assert.equal(await api.downloadRemoteUrl('https://chatgpt.com/synthetic.png', 'test.png'), 7);
  dom.window.close();
});

test('service worker responds asynchronously with download ID and returns base64 bytes', async () => {
  let listener;
  const context = {
    chrome: { runtime: { onMessage: { addListener: fn => { listener = fn; } } }, downloads: {
      download: (_options, cb) => cb(42), search: (_query, cb) => cb([{ state: 'complete' }])
    } }, URL, Uint8Array, btoa, fetch: async () => ({ ok: true, arrayBuffer: async () => Uint8Array.from([1, 2, 3]).buffer, headers: { get: () => 'image/png' } })
  };
  vm.runInNewContext(fs.readFileSync(require.resolve('../background.js'), 'utf8'), context);
  const call = (message) => new Promise(resolve => listener(message, {}, resolve));
  assert.equal((await call({ type: 'download-url', url: 'https://chatgpt.com/synthetic.png', filename: 'test.png' })).id, 42);
  assert.equal((await call({ type: 'download-status', id: 42 })).state, 'complete');
  assert.equal((await call({ type: 'fetch-image', url: 'https://chatgpt.com/synthetic.png' })).base64, 'AQID');
  assert.equal((await call({ type: 'fetch-image', url: 'blob:https://chatgpt.com/synthetic' })).ok, false);
});
