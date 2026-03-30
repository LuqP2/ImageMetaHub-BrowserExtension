const DEFAULT_SETTINGS = {
  defaultProvider: '',
  defaultModel: '',
  filenamePrefix: 'imh',
  sidecarFallback: true,
  includeRichMetadata: true
};

const form = document.getElementById('settings-form');
const statusEl = document.getElementById('status');
const resetButton = document.getElementById('reset-button');
const storage = chrome.storage.sync || chrome.storage.local;

function setStatus(message) {
  statusEl.textContent = message;
}

function populateForm(settings) {
  form.defaultProvider.value = settings.defaultProvider || '';
  form.defaultModel.value = settings.defaultModel || '';
  form.filenamePrefix.value = settings.filenamePrefix || DEFAULT_SETTINGS.filenamePrefix;
  form.sidecarFallback.checked = Boolean(settings.sidecarFallback);
  form.includeRichMetadata.checked = Boolean(settings.includeRichMetadata);
}

function readFormValues() {
  return {
    defaultProvider: form.defaultProvider.value.trim(),
    defaultModel: form.defaultModel.value.trim(),
    filenamePrefix: form.filenamePrefix.value.trim() || DEFAULT_SETTINGS.filenamePrefix,
    sidecarFallback: form.sidecarFallback.checked,
    includeRichMetadata: form.includeRichMetadata.checked
  };
}

function loadSettings() {
  storage.get(DEFAULT_SETTINGS, (items) => {
    populateForm({ ...DEFAULT_SETTINGS, ...(items || {}) });
  });
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  const nextSettings = readFormValues();
  storage.set(nextSettings, () => {
    setStatus('Settings saved.');
  });
});

resetButton.addEventListener('click', () => {
  storage.set(DEFAULT_SETTINGS, () => {
    populateForm(DEFAULT_SETTINGS);
    setStatus('Settings reset.');
  });
});

loadSettings();
