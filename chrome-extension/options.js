import { getConfig, setConfig, testConnection } from './lib.js';

const $ = (id) => document.getElementById(id);
function showMsg(kind, text) { const m = $('msg'); m.className = 'msg ' + kind; m.textContent = text; m.hidden = false; }
function read() { return { owner: $('owner').value, repo: $('repo').value, branch: $('branch').value, token: $('token').value }; }

(async () => {
  const c = await getConfig();
  $('owner').value = c.owner; $('repo').value = c.repo; $('branch').value = c.branch;
  if (c.token) $('token').placeholder = '保存済み（変更するときだけ入力）';

  async function current() {
    const v = read();
    if (!v.token) v.token = (await getConfig()).token;
    return v;
  }
  $('test').onclick = async () => {
    const v = await current();
    if (!v.token) { showMsg('err', 'トークンを入力してください'); return; }
    $('test').disabled = true;
    try { const r = await testConnection(v); showMsg(r.ok ? 'ok' : 'err', r.message); }
    catch (e) { showMsg('err', 'GitHub に接続できません: ' + e.message); }
    finally { $('test').disabled = false; }
  };
  $('save').onclick = async () => {
    const v = await current();
    if (!/^[A-Za-z0-9-]+$/.test(v.owner.trim()) || !/^[A-Za-z0-9_.-]+$/.test(v.repo.trim())) { showMsg('err', 'ユーザー名とリポジトリ名を確認してください'); return; }
    if (!v.token) { showMsg('err', 'トークンを入力してください'); return; }
    await setConfig(v);
    $('token').value = ''; $('token').placeholder = '保存済み（変更するときだけ入力）';
    showMsg('ok', '保存しました。ツールバーのボタンか Alt+Shift+L、右クリックから保存できます。');
  };
})();
