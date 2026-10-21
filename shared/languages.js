export const LANGUAGES = [
  { code: 'pt-BR', label: 'Português (Brasil)', prompt: 'Brazilian Portuguese' },
  { code: 'pt-PT', label: 'Português (Portugal)', prompt: 'European Portuguese' },
  { code: 'en', label: 'Inglês', prompt: 'English' },
  { code: 'es', label: 'Espanhol', prompt: 'Spanish' },
  { code: 'fr', label: 'Francês', prompt: 'French' },
  { code: 'de', label: 'Alemão', prompt: 'German' },
  { code: 'it', label: 'Italiano', prompt: 'Italian' },
  { code: 'ja', label: 'Japonês', prompt: 'Japanese' },
  { code: 'ko', label: 'Coreano', prompt: 'Korean' },
  { code: 'zh-CN', label: 'Chinês (simplificado)', prompt: 'Simplified Chinese' },
  { code: 'ru', label: 'Russo', prompt: 'Russian' },
];

export const DEFAULT_LANG = 'pt-BR';

export function promptName(code) {
  return (LANGUAGES.find((lang) => lang.code === code) ?? LANGUAGES[0]).prompt;
}
