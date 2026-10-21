// Injeta o content script (só quando o usuário pede) e envia a mensagem para ele.
export async function sendToTab(tabId, message, frameId = 0) {
  await chrome.scripting.executeScript({ target: { tabId, frameIds: [frameId] }, files: ['content/content.js'] });
  return chrome.tabs.sendMessage(tabId, message, { frameId });
}
