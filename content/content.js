// Injetado sob demanda na aba que o usuário escolheu traduzir.
(() => {
  if (window.__tradutorGemini) return;
  window.__tradutorGemini = true;

  const SKIP_SELECTOR = [
    'script', 'style', 'noscript', 'textarea', 'code', 'pre', 'kbd', 'samp', 'svg', 'math',
    '[translate="no"]', '.notranslate', '[contenteditable]:not([contenteditable="false"])',
  ].join(', ');
  const ONLY_SYMBOLS = /^[\s\d\p{P}\p{S}]*$/u;
  const BATCH_MAX_CHARS = 4000;
  const BATCH_MAX_ITEMS = 80;
  const CONCURRENCY = 2;
  const MAX_RETRIES = 3;
  const MAX_RETRY_WAIT_MS = 60_000;
  // Erros que não adianta repetir com os próximos lotes (chave, modelo, rede, cota).
  const RECOVERABLE = new Set(['BAD_RESPONSE', 'BLOCKED']);

  const originals = new Map(); // nó de texto -> texto original
  const cache = new Map(); // idioma + texto -> tradução
  let currentRun = null;

  const ui = createUi();

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    switch (message?.type) {
      case 'translate-page':
        translatePage(message.targetLang);
        break;
      case 'restore-page':
        restore();
        ui.hideToast();
        break;
      case 'translate-selection':
        translateSelection(message.text, message.targetLang);
        break;
      case 'get-state':
        sendResponse({ translated: originals.size > 0, running: currentRun !== null });
        return;
    }
    sendResponse({ ok: true });
  });

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const cacheKey = (lang, text) => `${lang}\u0000${text}`;

  function collectTextNodes() {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const parent = node.parentElement;
        if (!parent || ONLY_SYMBOLS.test(node.nodeValue)) return NodeFilter.FILTER_REJECT;
        return parent.closest(SKIP_SELECTOR) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
      },
    });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    return nodes;
  }

  function makeBatches(texts) {
    const batches = [];
    let batch = [];
    let size = 0;
    for (const text of texts) {
      if (batch.length && (size + text.length > BATCH_MAX_CHARS || batch.length >= BATCH_MAX_ITEMS)) {
        batches.push(batch);
        batch = [];
        size = 0;
      }
      batch.push(text);
      size += text.length;
    }
    if (batch.length) batches.push(batch);
    return batches;
  }

  function applyTranslation(nodes, translation) {
    for (const node of nodes) {
      if (!originals.has(node)) originals.set(node, node.nodeValue);
      // Mantém os espaços das pontas para não grudar palavras de nós vizinhos.
      const [, lead, , trail] = originals.get(node).match(/^(\s*)([\s\S]*?)(\s*)$/);
      node.nodeValue = lead + translation + trail;
    }
  }

  function restore() {
    currentRun = null;
    for (const [node, original] of originals) node.nodeValue = original;
    originals.clear();
  }

  async function translateBatch(texts, targetLang, attempt = 0) {
    let response;
    try {
      response = await chrome.runtime.sendMessage({ type: 'translate', texts, targetLang });
    } catch {
      throw Object.assign(new Error('A extensão foi recarregada. Atualize a página e tente de novo.'), { code: 'RELOADED' });
    }
    if (response.ok) return response.translations;

    const { error } = response;
    if (error.code === 'RATE_LIMIT' && attempt < MAX_RETRIES && error.retryAfterMs <= MAX_RETRY_WAIT_MS) {
      ui.toast(`Limite da API atingido. Tentando de novo em ${Math.ceil(error.retryAfterMs / 1000)}s…`);
      await sleep(error.retryAfterMs);
      return translateBatch(texts, targetLang, attempt + 1);
    }
    // Se o modelo errou a quantidade de itens, divide o lote e tenta as metades.
    if (error.code === 'BAD_RESPONSE' && texts.length > 1) {
      const mid = Math.ceil(texts.length / 2);
      const first = await translateBatch(texts.slice(0, mid), targetLang);
      const second = await translateBatch(texts.slice(mid), targetLang);
      return [...first, ...second];
    }
    throw Object.assign(new Error(error.message), { code: error.code });
  }

  async function translatePage(targetLang) {
    restore();
    const run = {};
    currentRun = run;

    const groups = new Map(); // texto (sem espaços nas pontas) -> nós com esse texto
    for (const node of collectTextNodes()) {
      const text = node.nodeValue.trim();
      if (!groups.has(text)) groups.set(text, []);
      groups.get(text).push(node);
    }

    const pending = [];
    for (const [text, nodes] of groups) {
      const cached = cache.get(cacheKey(targetLang, text));
      if (cached === undefined) pending.push(text);
      else applyTranslation(nodes, cached);
    }

    const batches = makeBatches(pending);
    const total = batches.length;
    let done = 0;
    let failed = 0;
    let fatal = null;
    const showProgress = () => ui.toast(`Traduzindo com Gemini… ${done}/${total}`);
    if (total) showProgress();

    const worker = async () => {
      while (batches.length && currentRun === run) {
        const batch = batches.shift();
        try {
          const translations = await translateBatch(batch, targetLang);
          if (currentRun !== run) return;
          batch.forEach((text, i) => {
            cache.set(cacheKey(targetLang, text), translations[i]);
            applyTranslation(groups.get(text), translations[i]);
          });
        } catch (err) {
          failed += batch.length;
          if (!RECOVERABLE.has(err.code)) {
            fatal = err;
            batches.length = 0;
          }
        }
        done++;
        if (currentRun === run && !fatal) showProgress();
      }
    };
    await Promise.all(Array.from({ length: CONCURRENCY }, worker));
    if (currentRun !== run) return; // restaurada ou reiniciada no meio do caminho
    currentRun = null;

    if (fatal) {
      const action = ['NO_KEY', 'INVALID_KEY', 'MODEL_NOT_FOUND', 'NO_QUOTA'].includes(fatal.code)
        ? { label: 'Abrir opções', onClick: () => chrome.runtime.sendMessage({ type: 'open-options' }) }
        : undefined;
      ui.toast(fatal.message, { error: true, action });
    } else if (originals.size === 0 && total === 0) {
      ui.toast('Nenhum texto para traduzir nesta página.', { autoHide: true });
    } else {
      const restoreAction = { label: 'Mostrar original', onClick: () => { restore(); ui.hideToast(); } };
      const message = failed
        ? `Página traduzida, mas ${failed} trecho(s) não puderam ser traduzidos.`
        : 'Página traduzida.';
      ui.toast(message, { action: restoreAction });
    }
  }

  async function translateSelection(fallbackText, targetLang) {
    const selection = window.getSelection();
    const text = (selection?.toString() || fallbackText || '').trim();
    if (!text) return;
    const rect = selection?.rangeCount ? selection.getRangeAt(0).getBoundingClientRect() : null;

    ui.panel(rect, 'Traduzindo…');
    try {
      const [translation] = await translateBatch([text], targetLang);
      ui.panel(rect, translation, { copyable: true });
    } catch (err) {
      ui.panel(rect, err.message, { error: true });
    }
  }

  // Interface própria dentro de um Shadow DOM para não sofrer com o CSS da página.
  function createUi() {
    const host = document.createElement('tradutor-gemini-ui');
    const root = host.attachShadow({ mode: 'closed' });
    root.innerHTML = `
      <style>
        :host { all: initial; }
        .box {
          position: fixed; z-index: 2147483647; box-sizing: border-box;
          font: 14px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif;
          color: #1f1f1f; background: #fff; border: 1px solid #dadce0; border-radius: 10px;
          box-shadow: 0 6px 24px rgba(0, 0, 0, .18);
        }
        .toast { right: 16px; bottom: 16px; max-width: min(380px, calc(100vw - 32px));
          display: flex; align-items: center; gap: 10px; padding: 10px 12px; }
        .panel { width: min(420px, calc(100vw - 32px)); padding: 12px; }
        .panel .text { white-space: pre-wrap; max-height: 260px; overflow: auto; margin: 6px 0 10px; }
        .title { font-size: 12px; font-weight: 600; color: #5f6368; }
        .error { color: #b3261e; }
        .actions { display: flex; gap: 8px; justify-content: flex-end; }
        button { font: inherit; font-size: 13px; cursor: pointer; border-radius: 6px; padding: 4px 10px;
          border: 1px solid #dadce0; background: #f8f9fa; color: #1a73e8; }
        button:hover { background: #eef3fd; }
        .close { border: none; background: none; color: #5f6368; font-size: 18px; line-height: 1; padding: 2px 4px; }
        [hidden] { display: none !important; }
        @media (prefers-color-scheme: dark) {
          .box { color: #e8eaed; background: #2d2e31; border-color: #5f6368; }
          .title, .close { color: #9aa0a6; }
          .error { color: #f2b8b5; }
          button { background: #3c4043; border-color: #5f6368; color: #8ab4f8; }
          button:hover { background: #45484d; }
        }
      </style>
      <div class="box toast" hidden>
        <span class="message"></span>
        <button class="action" hidden></button>
        <button class="close" title="Fechar">×</button>
      </div>
      <div class="box panel" hidden>
        <div class="title">Tradução (Gemini)</div>
        <div class="text"></div>
        <div class="actions">
          <button class="copy">Copiar</button>
          <button class="close-panel">Fechar</button>
        </div>
      </div>`;
    document.documentElement.append(host);

    const toastEl = root.querySelector('.toast');
    const toastMessage = root.querySelector('.toast .message');
    const toastAction = root.querySelector('.toast .action');
    const panelEl = root.querySelector('.panel');
    const panelText = root.querySelector('.panel .text');
    const copyButton = root.querySelector('.copy');
    let hideTimer;

    root.querySelector('.toast .close').addEventListener('click', () => (toastEl.hidden = true));
    root.querySelector('.close-panel').addEventListener('click', () => (panelEl.hidden = true));
    copyButton.addEventListener('click', async () => {
      await navigator.clipboard.writeText(panelText.textContent);
      copyButton.textContent = 'Copiado!';
      setTimeout(() => (copyButton.textContent = 'Copiar'), 1500);
    });

    return {
      toast(message, { error = false, action, autoHide = false } = {}) {
        clearTimeout(hideTimer);
        toastMessage.textContent = message;
        toastMessage.classList.toggle('error', error);
        toastAction.hidden = !action;
        if (action) {
          toastAction.textContent = action.label;
          toastAction.onclick = action.onClick;
        }
        toastEl.hidden = false;
        if (autoHide) hideTimer = setTimeout(() => (toastEl.hidden = true), 4000);
      },
      hideToast() {
        toastEl.hidden = true;
      },
      panel(rect, text, { error = false, copyable = false } = {}) {
        panelText.textContent = text;
        panelText.classList.toggle('error', error);
        copyButton.hidden = !copyable;
        // Abre logo abaixo da seleção, sem sair da tela.
        const width = Math.min(420, window.innerWidth - 32);
        const left = Math.max(16, Math.min((rect?.left ?? 16), window.innerWidth - width - 16));
        const below = (rect?.bottom ?? 16) + 8;
        const top = below + 200 > window.innerHeight ? Math.max(16, (rect?.top ?? 16) - 220) : below;
        panelEl.style.left = `${left}px`;
        panelEl.style.top = `${top}px`;
        panelEl.hidden = false;
      },
    };
  }
})();
