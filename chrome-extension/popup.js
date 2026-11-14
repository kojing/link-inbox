import { getConfig, isConfigured, buildItem, parseTags, saveItem, getQueue, flushQueue, getRecentTags, extractPageInfo } from './lib.js';

const $ = (id) => document.getElementById(id);
let selectedImage = '';

function showMsg(kind, text) {
  const m = $('msg');
  m.className = 'msg ' + kind; m.textContent = text; m.hidden = false;
}

async function renderQueue() {
  const n = (await getQueue()).length;
  $('foot').hidden = n === 0;
  $('queueInfo').textContent = '未送信 ' + n + '件';
}

function renderThumbs(images) {
  const box = $('thumbs');
  box.textContent = '';
  const add = (url, label) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'thumb' + (url ? '' : ' none');
    b.setAttribute('aria-pressed', String(url === selectedImage));
    if (url) {
      const img = document.createElement('img');
      img.src = url; img.alt = ''; img.referrerPolicy = 'no-referrer';
      // 読めない画像は候補から外す（選択中だったら「自動」に戻す）
      img.onerror = () => {
        if (selectedImage === url) { selectedImage = ''; const auto = box.querySelector('.thumb.none'); if (auto) auto.setAttribute('aria-pressed', 'true'); }
        b.remove();
      };
      b.appendChild(img);
      const s = document.createElement('span'); s.textContent = label; b.appendChild(s);
    } else {
      b.textContent = label;
    }
    b.onclick = () => { selectedImage = url; box.querySelectorAll('.thumb').forEach((x) => x.setAttribute('aria-pressed', String(x === b))); };
    box.appendChild(b);
  };
  add('', '自動');
  images.filter((x) => /^https:/.test(x.url)).forEach((x) => add(x.url, x.kind));
}

function toggleTag(tag) {
  const cur = parseTags($('tags').value);
  const i = cur.indexOf(tag);
  if (i >= 0) cur.splice(i, 1); else cur.push(tag);
  $('tags').value = cur.join(', ');
  renderRecent();
}
async function renderRecent() {
  const cur = parseTags($('tags').value);
  const box = $('recent');
  box.textContent = '';
  (await getRecentTags()).forEach((t) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'chip' + (cur.includes(t) ? ' on' : ''); b.textContent = t;
    b.onclick = () => toggleTag(t);
    box.appendChild(b);
  });
}

async function init() {
  const c = await getConfig();
  $('openOptions').onclick = $('settings').onclick = () => chrome.runtime.openOptionsPage();
  $('flush').onclick = async () => {
    $('flush').disabled = true;
    const r = await flushQueue();
    $('flush').disabled = false;
    showMsg(r.error ? 'err' : 'ok', r.error ? '再送できませんでした: ' + r.error : r.sent + '件を送信しました');
    renderQueue();
  };
  if (!isConfigured(c)) { $('setup').hidden = false; return; }

  $('form').hidden = false;
  $('dest').textContent = '→ ' + c.owner + '/' + c.repo;
  renderQueue();

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  $('title').value = (tab && tab.title) || '';
  $('url').value = (tab && tab.url) || '';
  let page = null;
  try {
    const [res] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: extractPageInfo });
    page = res && res.result;
  } catch (e) { /* chrome:// などは読めない */ }
  if (page) {
    if (page.title && page.title.length > 3) $('title').value = page.title;
    $('memo').value = page.selection || '';
    const meta = page.images.find((x) => /^https:/.test(x.url) && /og|twitter/.test(x.kind));
    selectedImage = meta ? meta.url : '';
    renderThumbs(page.images);
  } else {
    renderThumbs([]);
  }
  if (!/^https?:/.test($('url').value)) {
    $('save').disabled = true;
    showMsg('warn', 'このページは保存できません（http / https のページだけ）');
  }
  $('tags').addEventListener('input', renderRecent);
  renderRecent();
  $('title').focus(); $('title').select();

  $('save').onclick = async () => {
    $('save').disabled = true;
    try {
      const item = buildItem({ url: $('url').value, title: $('title').value, tags: parseTags($('tags').value), description: $('memo').value, thumbnailUrl: selectedImage });
      const r = await saveItem(item);
      if (r.queued) {
        showMsg('warn', '送信できなかったので保留しました（' + r.message + '）。次回の保存時や30分ごとに自動で再送します。');
        renderQueue();
      } else {
        showMsg('ok', 'GitHub に保存しました。Confluence を開くと取り込まれます。');
        setTimeout(() => window.close(), 1200);
      }
    } catch (e) {
      showMsg('err', e.message);
      $('save').disabled = false;
    }
  };
  document.addEventListener('keydown', (e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && !$('save').disabled) $('save').click(); });
}

init();
