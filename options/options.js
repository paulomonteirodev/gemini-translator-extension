import { listUsableModels, pickModel } from '../shared/gemini.js';

const $ = (id) => document.getElementById(id);

function setStatus(message, type = '') {
  $('key-status').textContent = message;
  $('key-status').className = `status ${type}`;
}

function showModels(models, selected) {
  $('model').replaceChildren(
    ...models.map((m) => new Option(m.label ? `${m.label} (${m.id})` : m.id, m.id, false, m.id === selected)),
  );
  $('model-field').hidden = models.length === 0;
}

// Valida a chave e guarda os modelos que ela realmente consegue usar. O teste gasta uma
// requisição por modelo, por isso só roda ao salvar e não toda vez que a página abre.
async function validate(apiKey) {
  setStatus('Verificando quais modelos a sua chave pode usar…');
  const models = await listUsableModels(apiKey);
  if (models.length === 0) throw new Error('Nenhum modelo do Gemini está disponível para esta chave.');
  const { model: current } = await chrome.storage.local.get('model');
  const model = pickModel(models, current);
  showModels(models, model);
  await chrome.storage.local.set({ apiKey, models, model });
}

async function save() {
  const apiKey = $('api-key').value.trim();
  if (!apiKey) {
    setStatus('Cole a sua chave de API antes de salvar.', 'error');
    return;
  }
  $('save').disabled = true;
  try {
    await validate(apiKey);
    setStatus('Chave válida e salva! Já pode traduzir pelo ícone da extensão.', 'ok');
  } catch (err) {
    setStatus(err.message, 'error');
  } finally {
    $('save').disabled = false;
  }
}

async function remove() {
  await chrome.storage.local.remove(['apiKey', 'models', 'model']);
  $('api-key').value = '';
  $('model-field').hidden = true;
  setStatus('Chave removida deste navegador.');
}

async function init() {
  const { apiKey, models, model } = await chrome.storage.local.get(['apiKey', 'models', 'model']);

  $('save').addEventListener('click', save);
  $('api-key').addEventListener('keydown', (event) => event.key === 'Enter' && save());
  $('remove').addEventListener('click', remove);
  $('model').addEventListener('change', () => chrome.storage.local.set({ model: $('model').value }));
  $('toggle-key').addEventListener('click', () => {
    const hidden = $('api-key').type === 'password';
    $('api-key').type = hidden ? 'text' : 'password';
    $('toggle-key').textContent = hidden ? 'Ocultar' : 'Mostrar';
  });

  if (!apiKey) return;
  $('api-key').value = apiKey;
  if (models?.length) {
    showModels(models, model);
    setStatus('Chave configurada. Clique em “Salvar e testar” para atualizar a lista de modelos.', 'ok');
    return;
  }
  try {
    await validate(apiKey);
    setStatus('Chave configurada.', 'ok');
  } catch (err) {
    setStatus(err.message, 'error');
  }
}

init();
