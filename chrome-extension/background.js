// 右クリックからの保存と、未送信の自動再送
import { buildItem, saveItem, flushQueue, updateBadge, extractPageInfo, getConfig, isConfigured } from './lib.js';

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'save-page', title: 'このページを link-inbox に保存', contexts: ['page', 'image', 'selection'] });
    chrome.contextMenus.create({ id: 'save-link', title: 'このリンクを link-inbox に保存', contexts: ['link'] });
  });
  chrome.alarms.create('flush', { periodInMinutes: 30 });
  if (reason === 'install' && !isConfigured(await getConfig())) chrome.runtime.openOptionsPage();
});

chrome.runtime.onStartup.addListener(() => { flushQueue().catch(() => {}); });
chrome.alarms.onAlarm.addListener((a) => { if (a.name === 'flush') flushQueue().catch(() => {}); });

async function flash(text, color) {
  await chrome.action.setBadgeBackgroundColor({ color });
  await chrome.action.setBadgeText({ text });
  setTimeout(() => { updateBadge().catch(() => {}); }, 2500);
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  try {
    let fields;
    if (info.menuItemId === 'save-link') {
      fields = { url: info.linkUrl, title: info.selectionText || info.linkUrl, tags: [], description: '' };
    } else {
      fields = { url: (tab && tab.url) || info.pageUrl, title: (tab && tab.title) || '', tags: [], description: info.selectionText || '' };
      try {
        const [res] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: extractPageInfo });
        const p = res && res.result;
        if (p) {
          fields.title = p.title || fields.title;
          if (!fields.description) fields.description = p.description;
          const img = info.mediaType === 'image' && info.srcUrl ? info.srcUrl : (p.images[0] && p.images[0].url);
          fields.thumbnailUrl = img;
        }
      } catch (e) { /* chrome:// など読めないページはタイトルとURLだけ */ }
    }
    const result = await saveItem(buildItem(fields));
    await flash(result.queued ? '…' : '✓', result.queued ? '#A66300' : '#1F8A5A');
  } catch (e) {
    console.warn('[link-inbox]', e);
    await flash('!', '#C2372B');
  }
});
