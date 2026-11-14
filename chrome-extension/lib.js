// link-inbox への保存処理（ポップアップと右クリックで共通）
// 保存形式は iPhone の Scriptable と同じ: inbox/<UUID>.json に 1リンク1ファイル（schemaVersion 1）

export const DEFAULTS = { owner: 'kojing', repo: 'link-inbox', branch: 'main', token: '' };
const RECENT_TAGS_MAX = 24;

export async function getConfig() {
  const { config } = await chrome.storage.local.get('config');
  return Object.assign({}, DEFAULTS, config || {});
}
export async function setConfig(c) {
  await chrome.storage.local.set({ config: { owner: c.owner.trim(), repo: c.repo.trim(), branch: c.branch.trim() || 'main', token: c.token.trim() } });
}
export function isConfigured(c) {
  return !!(c.owner && c.repo && c.branch && c.token);
}

export function uuid() {
  return crypto.randomUUID();
}

// ページから拾った値を、受信箱の1件分に整える
export function buildItem({ url, title, tags, description, thumbnailUrl }, now = new Date()) {
  const u = new URL(url);
  if (!/^https?:$/.test(u.protocol)) throw new Error('http/https のページだけ保存できます');
  const cleanTags = [...new Set((tags || []).map((t) => String(t).trim()).filter(Boolean))].slice(0, 20).map((t) => t.slice(0, 80));
  const item = {
    schemaVersion: 1,
    id: uuid(),
    url: u.href,
    title: String(title || '').trim().slice(0, 500) || u.href,
    tags: cleanTags,
    description: String(description || '').trim().slice(0, 4000),
    createdAt: now.toISOString(),
  };
  // https の画像だけ。付けておくと GitHub Actions の画像探しは飛ばされる
  if (thumbnailUrl && /^https:\/\/[^\s"'<>]+$/i.test(thumbnailUrl) && thumbnailUrl.length <= 2048) item.thumbnailUrl = thumbnailUrl;
  return item;
}

export function parseTags(text) {
  return String(text || '').split(/[,、，\n]/).map((s) => s.trim()).filter(Boolean);
}

function toBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

function apiBase(c) {
  return 'https://api.github.com/repos/' + encodeURIComponent(c.owner) + '/' + encodeURIComponent(c.repo);
}
function headers(c) {
  return { Accept: 'application/vnd.github+json', Authorization: 'Bearer ' + c.token, 'X-GitHub-Api-Version': '2022-11-28' };
}

export class SaveError extends Error {
  constructor(message, { retryable }) { super(message); this.retryable = retryable; }
}

// 1件を GitHub に書き込む。409(同時コミットの競合)は少し待って再試行
export async function putItem(c, item) {
  const body = JSON.stringify({
    message: 'Save link: ' + item.title.slice(0, 60),
    branch: c.branch,
    content: toBase64(JSON.stringify(item, null, 2)),
  });
  for (let attempt = 0; attempt < 3; attempt++) {
    let res;
    try {
      res = await fetch(apiBase(c) + '/contents/inbox/' + item.id + '.json', { method: 'PUT', headers: Object.assign({ 'Content-Type': 'application/json' }, headers(c)), body });
    } catch (e) {
      throw new SaveError('GitHub に接続できません（オフラインかもしれません）', { retryable: true });
    }
    if (res.status === 201 || res.status === 200) return;
    if (res.status === 422) return; // 同じIDのファイルが既にある＝前回の送信が届いていた
    if (res.status === 409) { await new Promise((r) => setTimeout(r, 1200)); continue; }
    if (res.status === 401) throw new SaveError('トークンが無効です。設定画面で入れ直してください', { retryable: false });
    if (res.status === 403 || res.status === 404) throw new SaveError('リポジトリに書き込めません（HTTP ' + res.status + '）。リポジトリ名とトークンの権限を確認してください', { retryable: false });
    throw new SaveError('GitHub HTTP ' + res.status, { retryable: true });
  }
  throw new SaveError('保存が混み合っています。少し待って再送してください', { retryable: true });
}

// 接続テスト（設定画面用）
export async function testConnection(c) {
  const res = await fetch(apiBase(c), { headers: headers(c) });
  if (res.status === 401) return { ok: false, message: 'トークンが無効です' };
  if (res.status === 404) return { ok: false, message: 'リポジトリが見つからないか、トークンに権限がありません' };
  if (!res.ok) return { ok: false, message: 'GitHub HTTP ' + res.status };
  const repo = await res.json();
  if (repo.permissions && repo.permissions.push === false) return { ok: false, message: 'このトークンには書き込み権限がありません（Contents: Read and write が必要）' };
  return { ok: true, message: repo.full_name + ' に接続できました' + (repo.private ? '（非公開）' : '（公開）') };
}

// ---- 未送信の保留キュー ----
export async function getQueue() {
  const { queue } = await chrome.storage.local.get('queue');
  return Array.isArray(queue) ? queue : [];
}
async function setQueue(q) {
  await chrome.storage.local.set({ queue: q });
  await updateBadge(q.length);
}
export async function enqueue(item) {
  const q = await getQueue();
  if (!q.some((x) => x.id === item.id)) q.push(item);
  await setQueue(q);
}
export async function flushQueue() {
  const c = await getConfig();
  if (!isConfigured(c)) return { sent: 0, left: (await getQueue()).length, error: null };
  const q = await getQueue();
  let sent = 0, error = null;
  const left = [];
  for (const item of q) {
    if (error) { left.push(item); continue; }
    try { await putItem(c, item); sent++; }
    catch (e) { error = e.message; left.push(item); }
  }
  await setQueue(left);
  return { sent, left: left.length, error };
}
export async function updateBadge(n) {
  if (n === undefined) n = (await getQueue()).length;
  await chrome.action.setBadgeBackgroundColor({ color: '#C2372B' });
  await chrome.action.setBadgeText({ text: n ? String(n) : '' });
}

// 保存の本体: 送れなければ保留して後で再送
export async function saveItem(item) {
  const c = await getConfig();
  if (!isConfigured(c)) throw new SaveError('先に設定画面で GitHub のトークンを入れてください', { retryable: false });
  await flushQueue().catch(() => {});
  try {
    await putItem(c, item);
    await rememberTags(item.tags);
    return { queued: false };
  } catch (e) {
    if (e.retryable) { await enqueue(item); await rememberTags(item.tags); return { queued: true, message: e.message }; }
    throw e;
  }
}

export async function getRecentTags() {
  const { recentTags } = await chrome.storage.local.get('recentTags');
  return Array.isArray(recentTags) ? recentTags : [];
}
async function rememberTags(tags) {
  if (!tags || !tags.length) return;
  const cur = await getRecentTags();
  const next = [...tags, ...cur.filter((t) => !tags.includes(t))].slice(0, RECENT_TAGS_MAX);
  await chrome.storage.local.set({ recentTags: next });
}

// 開いているページから情報を拾う（chrome.scripting.executeScript でページ内で実行される）
export function extractPageInfo() {
  const meta = (sel) => { const el = document.querySelector(sel); return el ? (el.getAttribute('content') || '').trim() : ''; };
  const abs = (u) => { try { return new URL(u, location.href).href; } catch (e) { return ''; } };
  const images = [];
  const push = (u, kind) => { u = abs(u); if (u && /^https?:/.test(u) && !images.some((x) => x.url === u)) images.push({ url: u, kind }); };
  push(meta('meta[property="og:image:secure_url"]') || meta('meta[property="og:image"]') || meta('meta[name="og:image"]'), 'og:image');
  push(meta('meta[name="twitter:image"]') || meta('meta[name="twitter:image:src"]') || meta('meta[property="twitter:image"]'), 'twitter:image');
  const big = Array.from(document.images)
    .filter((img) => img.naturalWidth >= 200 && img.naturalHeight >= 100 && img.currentSrc)
    .sort((a, b) => b.naturalWidth * b.naturalHeight - a.naturalWidth * a.naturalHeight)
    .slice(0, 6);
  big.forEach((img) => push(img.currentSrc, img.naturalWidth + '×' + img.naturalHeight));
  return {
    title: meta('meta[property="og:title"]') || document.title || '',
    description: meta('meta[property="og:description"]') || meta('meta[name="description"]') || '',
    selection: String(window.getSelection ? window.getSelection() : '').trim().slice(0, 1000),
    images: images.filter((x) => x.url).slice(0, 8),
  };
}
