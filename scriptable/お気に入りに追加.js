// Variables used by Scriptable.
// icon-color: deep-purple; icon-glyph: bookmark;
// share-sheet-inputs: url, plain-text;
// iPhone share -> durable local queue -> GitHub inbox/*.json
const FM = FileManager.local();
const ROOT = FM.joinPath(FM.documentsDirectory(), 'link-collector-relay-v1');
if (!FM.fileExists(ROOT)) FM.createDirectory(ROOT, true);
const CFGKEY = 'link-collector.github.config.v1';
const TOKENKEY = 'link-collector.github.write-token.v1';
async function message(title, text) {
  const a = new Alert(); a.title = title; a.message = text; a.addAction('OK'); await a.presentAlert();
}
async function setup() {
  const prev = Keychain.contains(CFGKEY) ? JSON.parse(Keychain.get(CFGKEY)) : {};
  const a = new Alert(); a.title = 'GitHubの設定';
  a.message = 'README付きで作成した専用リポジトリを指定。トークンはそのリポジトリのContents: Read and writeのみ。';
  a.addTextField('GitHubユーザー/組織名', prev.owner || 'kojing');
  a.addTextField('リポジトリ名', prev.repo || 'link-inbox');
  a.addTextField('ブランチ', prev.branch || 'main');
  a.addSecureTextField('書き込みトークン（空欄なら既存を維持）', '');
  a.addAction('保存'); a.addCancelAction('キャンセル');
  if (await a.presentAlert() < 0) return null;
  const c = {owner:a.textFieldValue(0).trim(), repo:a.textFieldValue(1).trim(), branch:a.textFieldValue(2).trim()};
  if (!/^[A-Za-z0-9-]+$/.test(c.owner) || !/^[A-Za-z0-9_.-]+$/.test(c.repo) || !c.branch) throw new Error('ユーザー名・リポジトリ名・ブランチを確認してください。');
  const token = a.textFieldValue(3).trim();
  if (!token && !Keychain.contains(TOKENKEY)) throw new Error('トークンを入力してください。');
  if (token) Keychain.set(TOKENKEY, token);
  Keychain.set(CFGKEY, JSON.stringify(c)); return c;
}
function sharedURL() {
  const inputs = [].concat(args.urls || [], args.plainTexts || [], args.shortcutParameter || []);
  for (const input of inputs) {
    const s = typeof input === 'string' ? input : (input && input.url) || '';
    const m = s.match(/https?:\/\/[^\s<>"\u3000]+/i);
    if (m) return m[0];
  }
  return '';
}
// Safari often shares the page title as plain text next to the URL; use it when present.
function sharedTitle(url) {
  const texts = [].concat(args.plainTexts || [], args.shortcutParameter && typeof args.shortcutParameter === 'object' ? [args.shortcutParameter.title || ''] : []);
  for (const t of texts) {
    const s = String(t || '').replace(/https?:\/\/\S+/gi, '').replace(/\s+/g, ' ').trim();
    if (s && s !== url) return s.slice(0, 500);
  }
  return '';
}
function clipboardURL() {
  const s = Pasteboard.pasteString() || '';
  const m = s.match(/https?:\/\/[^\s<>"\u3000]+/i);
  return m ? m[0] : '';
}
function queueFiles() { return FM.listContents(ROOT).filter(n => /^[a-f0-9-]+\.json$/i.test(n)).sort(); }
async function github(c, suffix, method, body) {
  const r = new Request('https://api.github.com/repos/' + encodeURIComponent(c.owner) + '/' + encodeURIComponent(c.repo) + suffix);
  r.method = method || 'GET'; r.timeoutInterval = 25;
  r.headers = {Accept:'application/vnd.github+json', Authorization:'Bearer ' + Keychain.get(TOKENKEY), 'X-GitHub-Api-Version':'2022-11-28'};
  if (body) { r.headers['Content-Type'] = 'application/json'; r.body = JSON.stringify(body); }
  const text = await r.loadString(); const status = r.response.statusCode;
  let data; try { data = JSON.parse(text); } catch (_) { data = {}; }
  if (status < 200 || status >= 300) { const e = new Error('GitHub HTTP ' + status + '（権限・ブランチ・通信状態を確認）'); e.status = status; throw e; }
  return data;
}
async function flush() {
  let sent = 0;
  for (const name of queueFiles().slice(0, 10)) {
    const path = FM.joinPath(ROOT, name); const entry = JSON.parse(FM.readString(path));
    const c = entry.destination; const content = JSON.stringify(entry.item, null, 2);
    const suffix = '/contents/inbox/' + name;
    try {
      await github(c, suffix, 'PUT', {message:'Save shared link', branch:c.branch, content:Data.fromString(content).toBase64String()});
    } catch (e) {
      if (e.status !== 409 && e.status !== 422) throw e;
      // A successful upload whose response was lost must not create a second entry.
      const old = await github(c, suffix + '?ref=' + encodeURIComponent(c.branch));
      if (!old.content) throw e;
      // GitHub Actions may have added thumbnail fields after the first upload; ignore those when comparing.
      const remote = JSON.parse(Data.fromBase64String(old.content.replace(/\s/g, '')).toRawString());
      delete remote.thumbnailUrl; delete remote.thumbnailCheckedAt;
      if (JSON.stringify(remote) !== JSON.stringify(entry.item)) throw e;
    }
    FM.remove(path); sent++;
  }
  return sent;
}
async function guessTitle(url) {
  // The share extension has a tight memory limit; loading a whole page there can kill it silently.
  if (config.runsInActionExtension) return url;
  try {
    const r = new Request(url); r.timeoutInterval = 8;
    const html = await r.loadString();
    const m = html.slice(0, 500000).match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    if (m) return m[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim().slice(0, 500);
  } catch (_) {}
  return url;
}
async function main() {
  let c = Keychain.contains(CFGKEY) ? JSON.parse(Keychain.get(CFGKEY)) : await setup();
  if (!c) return;
  let url = sharedURL();
  if (!url) {
    const clip = clipboardURL();
    if (clip) {
      const q = new Alert(); q.title = 'コピーしたURLを保存しますか？'; q.message = clip;
      q.addAction('保存する'); q.addCancelAction('メニューを開く');
      if (await q.presentAlert() === 0) url = clip;
    }
  }
  if (!url) {
    const a = new Alert(); a.title = 'リンクを保存'; a.message = '未送信 ' + queueFiles().length + '件';
    a.addAction('URLを入力'); a.addAction('未送信を再送'); a.addAction('設定を変更'); a.addCancelAction('閉じる');
    const action = await a.presentSheet();
    if (action < 0) return;
    if (action === 2) { await setup(); return; }
    if (action === 0) {
      const q = new Alert(); q.title = 'URL'; q.addTextField('https://', ''); q.addAction('次へ'); q.addCancelAction('キャンセル');
      if (await q.presentAlert() < 0) return; url = q.textFieldValue(0).trim();
      if (!/^https?:\/\/[^\s]+$/i.test(url)) throw new Error('http/httpsのURLを入力してください。');
    }
  }
  if (url) {
    const a = new Alert(); a.title = 'お気に入りに追加'; a.message = url + '\n→ GitHub: ' + c.owner + '/' + c.repo;
    a.addTextField('タイトル', sharedTitle(url) || await guessTitle(url)); a.addTextField('タグ（カンマ区切り）', ''); a.addTextField('メモ（任意）', '');
    a.addAction('保存'); a.addCancelAction('キャンセル'); if (await a.presentAlert() < 0) return;
    const id = UUID.string().toLowerCase();
    const item = {schemaVersion:1, id:id, url:url, title:(a.textFieldValue(0).trim() || url).slice(0,500), tags:[...new Set(a.textFieldValue(1).split(/[,、]/).map(s => s.trim().slice(0,80)).filter(Boolean))].slice(0,20), description:a.textFieldValue(2).slice(0,4000), createdAt:new Date().toISOString()};
    // Persist before starting network I/O. Each entry keeps its original destination.
    FM.writeString(FM.joinPath(ROOT, id + '.json'), JSON.stringify({destination:c, item:item}));
  }
  try {
    const n = await flush(); await message('GitHubに保存しました', n + '件送信。未送信 ' + queueFiles().length + '件。\nConfluence側で「iPhoneから取込」を実行してください。');
  } catch (e) {
    await message('端末に保留しました', '未送信 ' + queueFiles().length + '件。次回の登録・再送で再試行します。\n' + e.message);
  }
}
try { await main(); } catch (e) { await message('処理を完了できませんでした', e.message); }
Script.complete();
