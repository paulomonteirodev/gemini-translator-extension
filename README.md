# Tradutor Gemini (extensão para Chrome)

Traduz a aba atual (ou um texto selecionado) usando o Gemini. Cada pessoa usa a **sua própria chave de API**, que fica salva só no navegador dela.

## Instalação (modo desenvolvedor)

1. Abra `chrome://extensions`.
2. Ative o **Modo do desenvolvedor** (canto superior direito).
3. Clique em **Carregar sem compactação** e escolha esta pasta.
4. A página de configurações abre sozinha: crie uma chave gratuita no [Google AI Studio](https://aistudio.google.com/apikey), cole e clique em **Salvar e testar**.

## Como usar

- **Página inteira:** clique no ícone da extensão, escolha o idioma e clique em **Traduzir esta página** (ou use o atalho `Alt+Shift+T`).
- **Voltar ao original:** botão **Mostrar original** no aviso da página ou no popup.
- **Trecho selecionado:** selecione o texto, clique com o botão direito e escolha **Traduzir seleção com Gemini**.

## Estrutura

| Arquivo | Função |
|---|---|
| `manifest.json` | Permissões e pontos de entrada (Manifest V3) |
| `background.js` | Chama a API do Gemini com a chave do usuário, menu de contexto e atalho |
| `content/content.js` | Injetado só na aba escolhida: coleta os textos, aplica as traduções e mostra o progresso |
| `popup/` | Escolha do idioma e botões de traduzir/restaurar |
| `options/` | Cadastro e teste da chave e escolha do modelo |
| `shared/gemini.js` | Cliente da API (listar modelos, traduzir, tratar erros) |

## Detalhes

- A chave fica em `chrome.storage.local` e só é enviada para `generativelanguage.googleapis.com`. As chamadas saem do service worker, nunca da página traduzida.
- Os textos vão em lotes de até ~4000 caracteres, com no máximo 2 requisições ao mesmo tempo. Textos repetidos são enviados uma vez só.
- Quando a cota estoura (erro 429), a extensão espera o tempo indicado pela API e tenta de novo.
- Código, `<pre>`, campos editáveis e elementos com `translate="no"` ou `.notranslate` não são traduzidos.
- Cada nó de texto é traduzido separadamente para não quebrar links e o layout. Por isso frases divididas por tags (ex.: `Clique <a>aqui</a>`) podem ficar com uma tradução menos natural.
- Conteúdo que aparece depois da tradução (rolagem infinita, SPAs) não é traduzido automaticamente. É só clicar em traduzir de novo, e o que já foi traduzido vem do cache.
