import { DEFAULT_LANG, LANGUAGES } from '../shared/languages.js';
import { sendToTab } from '../shared/tabs.js';

const $ = (id) => document.getElementById(id);

function setStatus(message, type = '') {
  $('status').textContent = message;
  $('status').className = `status ${type}`;
}

async function activeTabId() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id;
}

async function run(message) {
  try {
    await sendToTab(await activeTabId(), message);
    window.close(); // o progresso aparece na própria página
  } catch {
    setStatus('Não é possível traduzir esta página (páginas internas do Chrome e da Web Store são bloqueadas).', 'error');
  }
}

async function init() {
  const { apiKey, targetLang = DEFAULT_LANG } = await chrome.storage.local.get(['apiKey', 'targetLang']);

  for (const lang of LANGUAGES) $('lang').add(new Option(lang.label, lang.code, false, lang.code === targetLang));

  $('setup').hidden = Boolean(apiKey);
  $('main').hidden = !apiKey;

  $('lang').addEventListener('change', () => chrome.storage.local.set({ targetLang: $('lang').value }));
  $('translate').addEventListener('click', () => run({ type: 'translate-page', targetLang: $('lang').value }));
  $('restore').addEventListener('click', () => run({ type: 'restore-page' }));
  for (const id of ['open-options', 'settings']) {
    $(id).addEventListener('click', (event) => {
      event.preventDefault();
      chrome.runtime.openOptionsPage();
    });
  }
}

init();
