const fs = require('fs'), assert = require('assert');
const { makeConfluence } = require('./fakecf');
const path = require('path');
// 保存処理(LCStore)は本体とポップアップに同じものが入っている。両方から切り出して一致を確認し、本体側でテストする。
const block = (file) => { const s = fs.readFileSync(path.join(__dirname, '..', file), 'utf8'); return s.slice(s.indexOf('// BEGIN LC STORE'), s.indexOf('// END LC STORE')); };
const mainStore = block('link-collector.js'), qaStore = block('link-collector-quick-add.js');
assert(mainStore.length > 1000, 'store block not found');
assert.strictEqual(mainStore, qaStore, '本体とポップアップのLCStoreが食い違っています');
const LCStore = new Function(mainStore + '; return LCStore;')();
const notion = Array.from({ length: 120 }, (_, i) => ({ title: 'サンプルのリンク ' + i + '（テスト用の日本語タイトル）', url: 'https://example.com/notion/' + i, tags: ['UI/モーション参考'], description: '説明文のテキスト' }));
let n = 0; const mk = (x) => ({ id: 'l' + (n++).toString(36) + 'abcdef', title: x.title, url: x.url, tags: x.tags, description: x.description || '', createdAt: new Date(1.7e12 + n * 1000).toISOString() });
(async () => {
  // 1) legacy migration of the 120 Notion links (legacy property may already be over 32KB)
  const cf = makeConfluence();
  const legacy = notion.map(mk);
  cf.props.set('link-collector-data', { value: { items: legacy, tags: ['UI/モーション参考', 'Houdini/3D制作'], relayProcessed: ['kojing/link-inbox/main:inbox/a.json'] }, version: 7 });
  const A = LCStore.create('100', 'link-collector-data', cf.fetch);
  const putsBefore = cf.stats.put + cf.stats.post;
  let d = await A.load();
  assert.equal(d.items.length, 120); assert.equal(cf.stats.put + cf.stats.post, putsBefore, 'load is read-only');
  assert(A.needsMigration()); await A.migrate(); assert(!A.needsMigration());
  const meta = cf.props.get('link-collector-data').value;
  assert(!meta.items && meta.schema === 2 && meta.relayProcessed.length === 1, 'meta slimmed, relay kept');
  const used = [...cf.props.keys()].filter((k) => /-\d\d$/.test(k));
  console.log('1 migrate ok: shards used', used.length, 'max bytes', cf.stats.maxBytes, 'meta bytes', cf.enc(meta));
  // reload is idempotent
  const A2 = LCStore.create('100', 'link-collector-data', cf.fetch); d = await A2.load(); assert.equal(d.items.length, 120);
  // 2) add / edit / delete touch one shard each
  let s0 = { ...cf.stats };
  const items = d.items; const tags = d.tags.slice();
  items.push(mk({ title: '新しいリンク', url: 'https://example.com/new', tags: ['新タグ'] })); tags.push('新タグ');
  await A2.sync(items, tags);
  console.log('2 add: puts', cf.stats.put - s0.put, 'posts', cf.stats.post - s0.post);
  s0 = { ...cf.stats }; items[5] = { ...items[5], title: items[5].title + '（編集）' }; await A2.sync(items, tags);
  console.log('2 edit: puts', cf.stats.put - s0.put);
  s0 = { ...cf.stats }; items.splice(10, 1); await A2.sync(items, tags);
  console.log('2 delete: puts', cf.stats.put - s0.put);
  // 3) concurrent popup add is not erased by the main page's later save
  const B = LCStore.create('100', 'link-collector-data', cf.fetch); await B.load();
  await B.addItems([mk({ title: 'ポップアップから', url: 'https://example.com/popup', tags: ['ポップ'] })], ['ポップ']);
  items.splice(0, 1); await A2.sync(items, tags); // main page deletes something with stale view
  const C = LCStore.create('100', 'link-collector-data', cf.fetch); d = await C.load();
  assert(d.items.some((x) => x.url === 'https://example.com/popup'), 'popup item survived');
  assert(d.tags.includes('ポップ') && d.tags.includes('新タグ'), 'tags merged');
  assert.equal(d.items.length, items.length + 1);
  console.log('3 concurrent ok, total', d.items.length);
  // 4) edit that grows an item beyond its shard moves it elsewhere
  const big = d.items.find((x) => x.url === 'https://example.com/new');
  big.description = 'あ'.repeat(3000); await C.sync(d.items, d.tags);
  const D = LCStore.create('100', 'link-collector-data', cf.fetch); let d2 = await D.load();
  assert.equal(d2.items.find((x) => x.id === big.id).description.length, 3000); assert.equal(d2.items.length, d.items.length);
  console.log('4 grow ok, max bytes', cf.stats.maxBytes);
  // 5) capacity: keep adding until full
  let added = 0, err = null;
  try { for (;;) { const batch = Array.from({ length: 50 }, (_, i) => mk({ title: 'サンプルのリンクタイトル ' + added + i, url: 'https://example.com/fill/' + added + '-' + i, tags: ['UI/モーション参考'], description: '短いメモ' })); await D.addItems(batch, null); added += 50; d2.items.push(...batch); } }
  catch (e) { err = e.message; }
  const E = LCStore.create('100', 'link-collector-data', cf.fetch); const d3 = await E.load();
  console.log('5 capacity: total items', d3.items.length, 'usage', E.usage(), 'err:', err, 'max bytes', cf.stats.maxBytes);
  assert(cf.stats.maxBytes <= 30000);
  // 6) no list endpoint -> per-key fallback
  const cf2 = makeConfluence({ noList: true }); cf2.props.set('link-collector-data', { value: { items: legacy.slice(0, 5), tags: [] }, version: 1 });
  const F = LCStore.create('200', 'link-collector-data', cf2.fetch); assert.equal((await F.load()).items.length, 5); await F.migrate(); assert.equal((await LCStore.create('200', 'link-collector-data', cf2.fetch).load()).items.length, 5);
  console.log('6 fallback ok, gets', cf2.stats.get);
  // 7) empty page: first save creates via POST
  const cf3 = makeConfluence(); const G = LCStore.create('300', 'link-collector-data', cf3.fetch); const e0 = await G.load();
  assert.equal(e0.items.length, 0); await G.sync([mk({ title: 'a', url: 'https://a', tags: [] })], ['x']);
  assert.equal((await LCStore.create('300', 'link-collector-data', cf3.fetch).load()).items.length, 1);
  console.log('7 empty ok');
  console.log('ALL PASS');
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
