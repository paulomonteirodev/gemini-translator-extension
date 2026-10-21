// Cliente mínimo da API do Gemini (Google AI Studio). A chave é sempre a do usuário.
const API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

export const DEFAULT_MODEL = 'gemini-2.5-flash';

// Modelos que não servem para gerar texto (voz, imagem, embeddings etc.).
const NON_TEXT_MODEL = /(tts|image|embedding|audio|live|robotics|computer-use)/;

export class GeminiError extends Error {
  constructor(message, { code = 'API', retryAfterMs } = {}) {
    super(message);
    this.code = code;
    this.retryAfterMs = retryAfterMs;
  }
}

async function request(path, apiKey, init = {}) {
  let res;
  try {
    res = await fetch(`${API_BASE}/${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    });
  } catch {
    throw new GeminiError('Não foi possível conectar à API do Gemini. Verifique sua internet.', { code: 'NETWORK' });
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw toGeminiError(res.status, body);
  return body;
}

function toGeminiError(status, body) {
  const message = body?.error?.message ?? '';
  const details = body?.error?.details ?? [];

  if (status === 429) {
    // O Gemini informa quanto esperar em RetryInfo.retryDelay (ex.: "34s").
    const retryDelay = details.find((d) => d['@type']?.endsWith('RetryInfo'))?.retryDelay;
    const retryAfterMs = retryDelay ? Math.ceil(parseFloat(retryDelay) * 1000) : 20_000;
    return new GeminiError('Limite de uso da sua chave do Gemini foi atingido. Tente novamente mais tarde.', {
      code: 'RATE_LIMIT',
      retryAfterMs,
    });
  }
  const invalidKey = details.some((d) => d.reason === 'API_KEY_INVALID') || /api key/i.test(message);
  if (invalidKey || status === 401 || status === 403) {
    return new GeminiError('Chave de API inválida ou sem permissão. Confira a chave nas opções da extensão.', {
      code: 'INVALID_KEY',
    });
  }
  if (status === 404) {
    return new GeminiError('Modelo não encontrado. Escolha outro modelo nas opções da extensão.', {
      code: 'MODEL_NOT_FOUND',
    });
  }
  return new GeminiError(`Erro da API do Gemini (${status}): ${message || 'erro desconhecido'}`);
}

export async function listModels(apiKey) {
  const models = [];
  let pageToken = '';
  do {
    const query = new URLSearchParams({ pageSize: '1000' });
    if (pageToken) query.set('pageToken', pageToken);
    const body = await request(`models?${query}`, apiKey);
    models.push(...(body.models ?? []));
    pageToken = body.nextPageToken;
  } while (pageToken);

  return models
    .filter((m) => m.supportedGenerationMethods?.includes('generateContent'))
    .map((m) => ({ id: m.name.replace(/^models\//, ''), label: m.displayName }))
    .filter((m) => m.id.startsWith('gemini') && !NON_TEXT_MODEL.test(m.id));
}

export function pickModel(models, current) {
  const ids = models.map((m) => m.id);
  if (ids.includes(current)) return current;
  return (
    [DEFAULT_MODEL, 'gemini-flash-latest'].find((id) => ids.includes(id)) ??
    ids.find((id) => id.includes('flash') && !id.includes('preview')) ??
    ids[0]
  );
}

function buildInstruction(targetLanguage) {
  return [
    `You are a professional translator. Translate every string of the JSON array sent by the user into ${targetLanguage}.`,
    'Reply with a JSON array of strings with exactly the same number of items, in the same order.',
    'Strings are fragments of a web page: translate naturally but keep each item independent.',
    'Keep numbers, URLs, e-mails, code, product names and placeholders unchanged.',
    'If an item is already in the target language or must not be translated, return it unchanged.',
  ].join('\n');
}

export async function translateTexts({ apiKey, model, texts, targetLanguage }) {
  const generationConfig = {
    responseMimeType: 'application/json',
    responseSchema: { type: 'ARRAY', items: { type: 'STRING' } },
  };
  // No 2.5 Flash o "raciocínio" só deixa a tradução mais lenta.
  if (/^gemini-2\.5-flash/.test(model)) generationConfig.thinkingConfig = { thinkingBudget: 0 };

  const body = await request(`models/${encodeURIComponent(model)}:generateContent`, apiKey, {
    method: 'POST',
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: buildInstruction(targetLanguage) }] },
      contents: [{ role: 'user', parts: [{ text: JSON.stringify(texts) }] }],
      generationConfig,
    }),
  });

  const candidate = body.candidates?.[0];
  if (!candidate?.content) {
    const reason = body.promptFeedback?.blockReason ?? candidate?.finishReason;
    throw new GeminiError(`O Gemini não traduziu este trecho${reason ? ` (${reason})` : ''}.`, { code: 'BLOCKED' });
  }

  const text = candidate.content.parts
    .filter((part) => !part.thought)
    .map((part) => part.text ?? '')
    .join('');
  let translations;
  try {
    translations = JSON.parse(text);
  } catch {
    throw new GeminiError('O Gemini devolveu uma resposta em formato inválido.', { code: 'BAD_RESPONSE' });
  }
  const valid =
    Array.isArray(translations) &&
    translations.length === texts.length &&
    translations.every((t) => typeof t === 'string');
  if (!valid) {
    throw new GeminiError('O Gemini devolveu um número diferente de trechos.', { code: 'BAD_RESPONSE' });
  }
  return translations;
}
