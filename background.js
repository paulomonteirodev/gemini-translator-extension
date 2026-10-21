import { DEFAULT_LANG, promptName } from './shared/languages.js';
import { DEFAULT_MODEL, translateTexts } from './shared/gemini.js';
import { sendToTab } from './shared/tabs.js';

const MENU_ID = 'translate-selection';

chrome.runtime.onInstalled.addListener(({ reason }) => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: MENU_ID, title: 'Traduzir seleção com Gemini', contexts: ['selection'] });
  });
  // Na primeira instalação a pessoa precisa cadastrar a própria chave.
  if (reason === chrome.runtime.OnInstalledReason.INSTALL) chrome.runtime.openOptionsPage();
});

async function targetLang() {
  const { targetLang } = await chrome.storage.local.get('targetLang');
  return targetLang ?? DEFAULT_LANG;
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== MENU_ID || tab?.id === undefined) return;
  const message = { type: 'translate-selection', text: info.selectionText, targetLang: await targetLang() };
  sendToTab(tab.id, message, info.frameId).catch((err) => console.warn('Não foi possível traduzir a seleção:', err));
});

chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command !== 'translate-page' || tab?.id === undefined) return;
  const message = { type: 'translate-page', targetLang: await targetLang() };
  sendToTab(tab.id, message).catch((err) => console.warn('Não foi possível traduzir a página:', err));
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'open-options') {
    chrome.runtime.openOptionsPage();
    return;
  }
  if (message?.type !== 'translate') return;
  handleTranslate(message).then(sendResponse);
  return true; // resposta assíncrona
});

// A chamada à API fica no background: a chave nunca passa pela página que está sendo traduzida.
async function handleTranslate({ texts, targetLang }) {
  const { apiKey, model } = await chrome.storage.local.get(['apiKey', 'model']);
  if (!apiKey) {
    return {
      ok: false,
      error: { code: 'NO_KEY', message: 'Cadastre sua chave de API do Gemini nas opções da extensão.' },
    };
  }
  try {
    const translations = await translateTexts({
      apiKey,
      model: model || DEFAULT_MODEL,
      texts,
      targetLanguage: promptName(targetLang),
    });
    return { ok: true, translations };
  } catch (err) {
    return { ok: false, error: { code: err.code ?? 'API', message: err.message, retryAfterMs: err.retryAfterMs } };
  }
}
