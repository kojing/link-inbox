// iPhone取込の反映ロジック(relayApply)のテスト: 新規追加・URL重複・画像の後付け・削除済みは復活しない
const fs = require('fs'), path = require('path'), assert = require('assert');
const s = fs.readFileSync(path.join(__dirname, '..', 'link-collector.js'), 'utf8');
const core = s.slice(s.indexOf('// BEGIN RELAY CORE'), s.indexOf('// END RELAY CORE'));
let n = 0; const uid = () => 'id' + (++n);
const { relayApply } = new Function('uid', core + '; return { relayApply };')(uid);
const A = 'inbox/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.json', B = 'inbox/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.json', C = 'inbox/cccccccc-cccc-4ccc-8ccc-cccccccccccc.json';
const items = [{ id: 'x', url: 'https://dup.example/', title: 'existing', tags: [] }];
const tags = [];
let r = relayApply(items, tags, [
  { path: A, status: 'added', item: { schemaVersion: 1, url: 'https://a.example/', title: 'A', tags: ['新タグ'] } },
  { path: B, status: 'added', item: { schemaVersion: 1, url: 'https://dup.example/', title: 'dup' } },
]);
assert.deepStrictEqual([r.added, r.updated, r.skipped], [1, 0, 1]);
assert(tags.includes('新タグ'));
r = relayApply(items, tags, [{ path: A, status: 'modified', item: { schemaVersion: 1, url: 'https://a.example/', title: 'A', thumbnailUrl: 'https://img.example/a.jpg' } }]);
assert.deepStrictEqual([r.added, r.updated], [0, 1]);
assert.strictEqual(items.find((x) => x.url === 'https://a.example/').thumbnailUrl, 'https://img.example/a.jpg');
r = relayApply(items, tags, [{ path: C, status: 'modified', item: { schemaVersion: 1, url: 'https://deleted.example/', title: 'gone' } }]);
assert.deepStrictEqual([r.added, r.updated, r.skipped], [0, 0, 0], 'modified only → not resurrected');
assert.throws(() => relayApply(items, tags, [{ path: C, status: 'added', item: { schemaVersion: 1, url: 'javascript:alert(1)' } }]));
console.log('relay: ALL PASS');
