/*!
 * リンク集 for Confluence — 追加用ポップアップ v3.1.0
 *
 * ブックマークレットから開く「追加だけ」の軽い画面。設定した TARGETS のうち enabled のものすべてに同時追加する。
 * 使い方: このファイルを添付し、link-collector-quick-add.embed.html の内容を追加用ページの HTML マクロに貼る。
 * 本体(link-collector.js)と同じ16分割形式で保存するので、必ず本体と同じバージョンを使うこと。
 */
(function () {
  'use strict';

  var DEFAULT_TAGS = [
    'UI/モーション参考', 'Houdini/3D制作', 'タイポグラフィ/フォント',
    'デザインシステム・思考法', 'AIツール', 'ゲーム/アニメ', '個人メモ', '映画', '要確認'
  ];

  var VERSION = '3.1.0';
  // 設定は埋め込みHTML側の window.LINK_COLLECTOR_QUICKADD_CONFIG に書く
  var CONFIG = {
    TARGETS: [],                         // 追加先 [{ id: 'ページID', label: '表示名', enabled: true }]。enabled のものすべてに同時追加
    OWNER_USERNAME: '',                  // 本体と同じユーザー名
    PROPERTY_KEY: 'link-collector-data', // 本体と同じキー(変更しない)
    ROOT_ID: 'link-quickadd-root'
  };
  var USER_CONFIG = window.LINK_COLLECTOR_QUICKADD_CONFIG || {};
  Object.keys(CONFIG).forEach(function (k) { if (USER_CONFIG[k] !== undefined) CONFIG[k] = USER_CONFIG[k]; });
  window.LinkCollectorQuickAdd = { version: VERSION };

  // BEGIN LC STORE (link-collector.html と link-collector-quick-add.html で同じ内容)
  // リンク本体を16個のContent Property(<KEY>-00〜-15)に分けて保存する。<KEY>本体はタグと取込状況だけの小さな索引。
  // 1個あたりは公式ドキュメントの32KBより少し小さい30,000バイト(UTF-8)までに抑える。
  var LCStore = (function () {
    var SHARDS = 16, LIMIT = 30000;
    function size(v) { return new TextEncoder().encode(JSON.stringify(v)).length; }
    function create(pageId, metaKey, fetchImpl) {
      var f = fetchImpl || window.fetch.bind(window);
      var base = '/rest/api/content/' + encodeURIComponent(pageId) + '/property';
      var st = { meta: {}, shardBytes: [], shardOf: new Map(), snap: new Map(), tagsSnap: null, legacy: null };
      function key(i) { return metaKey + '-' + (i < 10 ? '0' : '') + i; }

      async function req(method, path, body) {
        var res = await f(base + path, {
          method: method, credentials: 'same-origin', cache: 'no-store',
          headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
          body: body ? JSON.stringify(body) : undefined
        });
        if (res.status === 404 && method === 'GET') return null;
        if (!res.ok) {
          var t = ''; try { t = await res.text(); } catch (_) {}
          var e = new Error('Confluence HTTP ' + res.status + (t ? ': ' + t.slice(0, 160) : ''));
          e.status = res.status; throw e;
        }
        return res.json();
      }
      async function getOne(k) {
        var d = await req('GET', '/' + encodeURIComponent(k));
        return d ? { value: d.value, version: d.version.number } : { value: null, version: null };
      }
      async function put(k, value, version) {
        if (version == null) return (await req('POST', '', { key: k, value: value })).version.number;
        return (await req('PUT', '/' + encodeURIComponent(k), { key: k, value: value, version: { number: version + 1 } })).version.number;
      }
      // 最新を読み直してから書く。別ウィンドウ(追加用ポップアップ等)と同時に保存しても上書きで消えないように、409なら読み直して再試行。
      async function mutate(k, fn) {
        for (var attempt = 0; attempt < 4; attempt++) {
          var g = await getOne(k);
          var v = g.value && typeof g.value === 'object' ? g.value : {};
          var r = fn(v) || {};
          if (r.changed === false) return { result: r, value: v };
          try { await put(k, v, g.version); return { result: r, value: v }; }
          catch (e) { if (e.status === 409 || (g.version == null && e.status === 400)) continue; throw e; }
        }
        throw new Error('別の保存と競合しました。ページを再読み込みしてください。');
      }
      function mutateShard(i, fn) {
        return mutate(key(i), function (v) { v.items = Array.isArray(v.items) ? v.items : []; return fn(v); })
          .then(function (out) { st.shardBytes[i] = size(out.value); return out.result; });
      }
      function mutateMeta(fn) {
        return mutate(metaKey, fn).then(function (out) { st.meta = out.value; return out.result; });
      }

      async function listAll() {
        var out = {};
        for (var start = 0; start < 1000; start += 50) {
          var d = await req('GET', '?expand=version&limit=50&start=' + start);
          var rs = (d && d.results) || [];
          rs.forEach(function (p) { out[p.key] = p; });
          if (rs.length < 50) break;
        }
        return out;
      }

      // 新規アイテムを空きの多い領域から順に詰める。入りきらなければ次の領域へ。
      async function place(list) {
        var pending = list.slice(), tried = new Set();
        while (pending.length) {
          var pick = -1;
          for (var i = 0; i < SHARDS; i++) if (!tried.has(i) && (pick < 0 || (st.shardBytes[i] || 0) < (st.shardBytes[pick] || 0))) pick = i;
          if (pick < 0) throw new Error('保存領域(16個)がいっぱいです。' + pending.length + '件を保存できませんでした。不要なリンクを削除してください。');
          tried.add(pick);
          var batch = pending;
          var r = await mutateShard(pick, function (v) {
            var rest = [], placed = [];
            batch.forEach(function (x) {
              v.items.push(x);
              if (size(v) > LIMIT) { v.items.pop(); rest.push(x); } else placed.push(x);
            });
            return { changed: placed.length > 0, rest: rest, placed: placed };
          });
          (r.placed || []).forEach(function (x) { st.shardOf.set(x.id, pick); st.snap.set(x.id, JSON.stringify(x)); });
          pending = r.rest || batch;
        }
      }

      async function load() {
        var wanted = [metaKey]; for (var i = 0; i < SHARDS; i++) wanted.push(key(i));
        var got = {}, props = null;
        try { props = await listAll(); } catch (_) { props = null; }
        var listOk = props && wanted.every(function (k) { return !props[k] || (props[k].value !== undefined && props[k].version); });
        if (listOk) {
          wanted.forEach(function (k) { got[k] = props[k] ? { value: props[k].value, version: props[k].version.number } : { value: null, version: null }; });
        } else {
          var arr = await Promise.all(wanted.map(getOne));
          wanted.forEach(function (k, n) { got[k] = arr[n]; });
        }
        st.meta = got[metaKey].value || {};
        st.shardOf = new Map(); st.snap = new Map();
        var items = [];
        for (var s = 0; s < SHARDS; s++) {
          var v = got[key(s)].value || { items: [] };
          st.shardBytes[s] = size(v);
          (v.items || []).forEach(function (x) {
            if (!x || !x.id || st.shardOf.has(x.id)) return;
            st.shardOf.set(x.id, s); st.snap.set(x.id, JSON.stringify(x)); items.push(x);
          });
        }
        // 旧形式(索引にitemsを直接持っていた)のデータは読み取り専用で一緒に表示し、書き込みは本人が保存するときに移行する。
        st.legacy = Array.isArray(st.meta.items) ? st.meta.items.filter(function (x) { return x && x.id && !st.shardOf.has(x.id); }) : null;
        (st.legacy || []).forEach(function (x) { items.push(x); });
        items.sort(function (a, b) { return String(a.createdAt || '').localeCompare(String(b.createdAt || '')); });
        var tags = (st.meta.tags && st.meta.tags.length) ? st.meta.tags : (st.meta.categories && st.meta.categories.length) ? st.meta.categories : null;
        st.tagsSnap = JSON.stringify(tags);
        return { items: items, tags: tags, meta: st.meta };
      }

      // 旧形式からの移行。先に分割先へ書いてから索引を小さくするので、途中で失敗しても旧データは残る。
      async function migrate() {
        if (!st.legacy) return false;
        if (st.legacy.length) await place(st.legacy);
        await mutateMeta(function (m) {
          delete m.items; m.schema = 2; m.shards = SHARDS;
          if (!m.tags && m.categories) m.tags = m.categories;
        });
        st.legacy = null;
        return true;
      }

      // 画面上の一覧(items)と前回保存した状態の差分だけを、該当する領域に書き込む。
      async function sync(items, tags) {
        await migrate();
        var byId = new Map(items.map(function (x) { return [x.id, x]; }));
        var ops = new Map();
        function op(i) { if (!ops.has(i)) ops.set(i, { remove: new Set(), upsert: new Map() }); return ops.get(i); }
        st.shardOf.forEach(function (i, id) { if (!byId.has(id)) op(i).remove.add(id); });
        var fresh = [];
        items.forEach(function (x) {
          if (!st.shardOf.has(x.id)) fresh.push(x);
          else if (st.snap.get(x.id) !== JSON.stringify(x)) op(st.shardOf.get(x.id)).upsert.set(x.id, x);
        });
        var moved = [];
        for (var entry of ops) {
          var i = entry[0], o = entry[1];
          var r = await mutateShard(i, function (v) {
            var out = [], over = [];
            v.items = v.items.filter(function (x) { return !o.remove.has(x.id); })
              .map(function (x) { return o.upsert.has(x.id) ? o.upsert.get(x.id) : x; });
            // 編集で大きくなって入りきらない場合は、その項目だけ別の領域へ移す
            while (size(v) > LIMIT) {
              var idx = -1;
              for (var n = v.items.length - 1; n >= 0; n--) if (o.upsert.has(v.items[n].id)) { idx = n; break; }
              if (idx < 0) break;
              over.push(v.items.splice(idx, 1)[0]);
            }
            return { over: over };
          });
          o.remove.forEach(function (id) { st.shardOf.delete(id); st.snap.delete(id); });
          o.upsert.forEach(function (x, id) { st.snap.set(id, JSON.stringify(x)); });
          (r.over || []).forEach(function (x) { st.shardOf.delete(x.id); moved.push(x); });
        }
        if (fresh.length || moved.length) await place(fresh.concat(moved));
        if (tags && JSON.stringify(tags) !== st.tagsSnap) {
          await mutateMeta(function (m) {
            var merged = tags.slice();
            (Array.isArray(m.tags) ? m.tags : []).forEach(function (t) { if (merged.indexOf(t) < 0) merged.push(t); });
            m.tags = merged; m.schema = 2; m.shards = SHARDS;
          });
          st.tagsSnap = JSON.stringify(tags);
        }
      }

      // 追加専用(ポップアップ用): 他のアイテムには触れずに足すだけ。
      async function addItems(newItems, tags) {
        await migrate();
        await place(newItems);
        if (tags && JSON.stringify(tags) !== st.tagsSnap) {
          await mutateMeta(function (m) {
            var cur = Array.isArray(m.tags) ? m.tags : [];
            tags.forEach(function (t) { if (cur.indexOf(t) < 0) cur.push(t); });
            m.tags = cur; m.schema = 2; m.shards = SHARDS;
          });
          st.tagsSnap = JSON.stringify(st.meta.tags);
        }
      }

      function usage() {
        var used = 0; for (var i = 0; i < SHARDS; i++) used += st.shardBytes[i] || 0;
        return { used: used, total: SHARDS * LIMIT };
      }
      return { load: load, migrate: migrate, needsMigration: function () { return !!st.legacy; }, sync: sync, addItems: addItems, mutateMeta: mutateMeta, usage: usage, meta: function () { return st.meta; } };
    }
    return { create: create, SHARDS: SHARDS, LIMIT: LIMIT };
  })();
  // END LC STORE

  // BIZ UDPゴシック(Google Fonts)。Shadow DOM内では@font-faceが効かないので<head>に読み込む。使えない環境ではWindows標準のBIZ UDPゴシック等で表示。
  if (!document.getElementById('lc-font-biz-udp')) {
    var fontLink = document.createElement('link');
    fontLink.id = 'lc-font-biz-udp'; fontLink.rel = 'stylesheet';
    fontLink.href = 'https://fonts.googleapis.com/css2?family=BIZ+UDPGothic:wght@400;700&display=swap';
    document.head.appendChild(fontLink);
  }

  var hostEl = document.getElementById(CONFIG.ROOT_ID);
  if (!hostEl) { if (window.console) console.warn('[link-collector] #' + CONFIG.ROOT_ID + ' が見つかりません'); return; }
  if (hostEl.shadowRoot) return;
  hostEl.setAttribute('data-bs-theme', 'light');
  var root = hostEl.attachShadow({ mode: 'open' });

  var styleEl = document.createElement('style');
  styleEl.textContent = CSS_TEXT();
  root.appendChild(styleEl);

  var wrapper = document.createElement('div');
  wrapper.className = 'qa-app';
  wrapper.innerHTML =
    '<div class="qa-header"><span class="qa-mark" aria-hidden="true"></span>リンク集に追加</div>' +
    '<div class="qa-status"></div>' +
    '<div class="qa-targets-note"></div>' +
    '<div class="qa-form" style="display:none">' +
      '<div class="qa-error" style="display:none"></div>' +
      '<label class="qa-field"><span>タイトル</span><input type="text" class="qa-title" /></label>' +
      '<label class="qa-field"><span>URL</span><input type="text" class="qa-url" /></label>' +
      '<div class="qa-field qa-thumb-field" style="display:none"><span>サムネイル(任意)</span><div class="qa-thumb-options"></div></div>' +
      '<label class="qa-field"><span>タグ(カンマ区切り、複数可)</span><input type="text" class="qa-tags" placeholder="例: Houdini, チュートリアル" />' +
        '<div class="qa-tag-suggestions"></div></label>' +
      '<label class="qa-field"><span>説明(任意)</span><textarea class="qa-desc" rows="3" placeholder="軽い説明"></textarea></label>' +
      '<div class="qa-actions">' +
        '<button class="qa-btn qa-cancel">閉じる</button>' +
        '<button class="qa-btn qa-btn-primary qa-save">追加</button>' +
      '</div>' +
    '</div>';
  root.appendChild(wrapper);

  var els = {
    status: root.querySelector('.qa-status'),
    targetsNote: root.querySelector('.qa-targets-note'),
    form: root.querySelector('.qa-form'),
    error: root.querySelector('.qa-error'),
    title: root.querySelector('.qa-title'),
    url: root.querySelector('.qa-url'),
    thumbField: root.querySelector('.qa-thumb-field'),
    thumbOptions: root.querySelector('.qa-thumb-options'),
    tags: root.querySelector('.qa-tags'),
    tagSuggestions: root.querySelector('.qa-tag-suggestions'),
    desc: root.querySelector('.qa-desc'),
    cancel: root.querySelector('.qa-cancel'),
    save: root.querySelector('.qa-save')
  };

  // ターゲットごとのデータ: { version, items, tags }
  var state = { targetsData: {}, tagSuggestionPool: [], selectedThumbnail: null };

  function escapeHtml(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function uid() { return 'l' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
  function setStatus(msg, isError) {
    els.status.textContent = msg || '';
    els.status.className = 'qa-status' + (isError ? ' qa-status-error' : '');
  }
  function showError(msg) {
    els.error.textContent = msg;
    els.error.style.display = msg ? 'block' : 'none';
  }

  function enabledTargets() {
    return (CONFIG.TARGETS || []).filter(function (t) { return t.id && t.id !== 'YOUR_MAIN_PAGE_ID_HERE' && t.enabled !== false; });
  }

  function apiGetCurrentUser() {
    return fetch('/rest/api/user/current', { headers: { Accept: 'application/json' }, credentials: 'same-origin' })
      .then(function (res) { if (!res.ok) throw new Error('user fetch failed'); return res.json(); });
  }

  // 設定ミス検知用: pageIdが実際に指すページのタイトル/スペースを取得する
  function apiGetPageInfo(pageId) {
    return fetch('/rest/api/content/' + pageId + '?expand=space', {
      headers: { Accept: 'application/json' }, credentials: 'same-origin'
    }).then(function (res) {
      if (!res.ok) return null;
      return res.json().then(function (data) {
        return { title: data.title, spaceKey: data.space && data.space.key, spaceName: data.space && data.space.name };
      });
    }).catch(function () { return null; });
  }

  function renderThumbOptions(images) {
    if (!images || !images.length) { els.thumbField.style.display = 'none'; return; }
    els.thumbField.style.display = '';
    state.selectedThumbnail = images[0];

    var html = '<button type="button" class="qa-thumb-opt qa-thumb-none" data-url="">なし</button>';
    images.forEach(function (url) {
      html += '<button type="button" class="qa-thumb-opt" data-url="' + escapeHtml(url) + '"><img src="' + escapeHtml(url) + '" loading="lazy" onerror="this.closest(\'.qa-thumb-opt\').style.display=\'none\'" /></button>';
    });
    els.thumbOptions.innerHTML = html;

    els.thumbOptions.querySelectorAll('.qa-thumb-opt').forEach(function (btn) {
      btn.addEventListener('click', function () {
        state.selectedThumbnail = btn.getAttribute('data-url') || null;
        els.thumbOptions.querySelectorAll('.qa-thumb-opt').forEach(function (b) { b.classList.remove('is-selected'); });
        btn.classList.add('is-selected');
      });
    });
    var firstOpt = els.thumbOptions.querySelector('.qa-thumb-opt:not(.qa-thumb-none)');
    if (firstOpt) firstOpt.classList.add('is-selected');
  }

  function renderTagSuggestions() {
    els.tagSuggestions.innerHTML = state.tagSuggestionPool.map(function (t) {
      return '<button type="button" class="qa-tag-suggest" data-tag="' + escapeHtml(t) + '">' + escapeHtml(t) + '</button>';
    }).join('');
    els.tagSuggestions.querySelectorAll('.qa-tag-suggest').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var tag = btn.getAttribute('data-tag');
        var current = els.tags.value.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
        if (current.indexOf(tag) === -1) current.push(tag);
        els.tags.value = current.join(', ');
        els.tags.focus();
      });
    });
  }

  els.cancel.addEventListener('click', function () { window.close(); });

  els.save.addEventListener('click', function () {
    var title = els.title.value.trim();
    var url = els.url.value.trim();
    var description = els.desc.value.trim();
    var tags = els.tags.value.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    tags = tags.filter(function (t, i) { return tags.indexOf(t) === i; });

    if (!title || !url) { showError('タイトルとURLは必須です'); return; }

    var targets = state.validTargets || enabledTargets();
    els.save.disabled = true;
    setStatus('追加中...');

    var added = [], skipped = [], failed = [];

    var chain = Promise.resolve();
    targets.forEach(function (target) {
      chain = chain.then(function () {
        var data = state.targetsData[target.id];
        if (!data) { failed.push(target.label); return; }

        if (data.items.some(function (i) { return i.url === url; })) {
          skipped.push(target.label);
          return;
        }

        var newItem = {
          id: uid(), title: title, url: url, tags: tags.slice(), description: description,
          thumbnailUrl: state.selectedThumbnail || undefined,
          createdAt: new Date().toISOString()
        };
        var mergedTags = data.tags.slice();
        tags.forEach(function (t) { if (mergedTags.indexOf(t) === -1) mergedTags.push(t); });

        // 16分割の空きがある領域にだけ書き込む(他のリンクには触れない)
        return data.store.addItems([newItem], mergedTags)
          .then(function () {
            data.items.push(newItem);
            data.tags = mergedTags;
            added.push(target.label);
          })
          .catch(function (err) {
            console.error(err);
            failed.push(target.label + (err && /いっぱい/.test(err.message) ? '(容量不足)' : ''));
          });
      });
    });

    chain.then(function () {
      els.save.disabled = false;
      var parts = [];
      if (added.length) parts.push('追加: ' + added.join('、'));
      if (skipped.length) parts.push('重複でスキップ: ' + skipped.join('、'));
      if (failed.length) parts.push('失敗: ' + failed.join('、'));
      var isError = failed.length > 0 && added.length === 0;
      setStatus(parts.join(' / ') || '対象の追加先がありませんでした', isError);

      if (added.length && !failed.length) {
        setTimeout(function () { window.close(); }, 1400);
      }
    });
  });

  function init() {
    var targets = enabledTargets();
    if (!targets.length) {
      setStatus('CONFIG.TARGETS に有効な追加先が設定されていません。マクロのソースを編集してください。', true);
      return;
    }

    var params = new URLSearchParams(location.search);
    els.title.value = params.get('lc_title') || '';
    els.url.value = params.get('lc_url') || '';
    var imagesParam = params.get('lc_images');
    var images = [];
    if (imagesParam) {
      try { images = JSON.parse(imagesParam); } catch (e) { images = []; }
    }

    els.targetsNote.textContent = '追加先を確認中...';

    setStatus('読み込み中...');

    apiGetCurrentUser().catch(function () { return null; }).then(function (user) {
      if (!user || user.name !== CONFIG.OWNER_USERNAME) {
        setStatus('このページは本人のみ利用できます。', true);
        return;
      }

      return Promise.all(targets.map(function (t) { return apiGetPageInfo(t.id); })).then(function (pageInfos) {
        // 設定したlabelと実際のページタイトルを突き合わせて表示。取得失敗(存在しないID等)は警告扱い。
        var noteHtml = targets.map(function (t, i) {
          var info = pageInfos[i];
          if (!info) {
            return '<div class="qa-target-item qa-target-warn">⚠ ' + escapeHtml(t.label || t.id) + ' (id: ' + escapeHtml(t.id) + ') — ページが見つかりません。IDを確認してください</div>';
          }
          var mismatch = t.label && info.title && t.label.indexOf(info.title) === -1 && info.title.indexOf(t.label) === -1;
          return '<div class="qa-target-item' + (mismatch ? ' qa-target-warn' : '') + '">' +
            (mismatch ? '⚠ ' : '✓ ') +
            escapeHtml(t.label || info.title) + ' → 「' + escapeHtml(info.title) + '」' +
            (info.spaceName ? ' (' + escapeHtml(info.spaceName) + ')' : '') +
            '</div>';
        }).join('');
        els.targetsNote.innerHTML = '<div class="qa-targets-label">追加先(実際のページを確認):</div>' + noteHtml;

        // ページが見つからなかったターゲットは追加処理から除外する
        var validTargets = targets.filter(function (t, i) { return !!pageInfos[i]; });
        if (!validTargets.length) {
          setStatus('有効な追加先が1つも見つかりませんでした。CONFIG.TARGETS のIDを確認してください。', true);
          return;
        }

        var stores = validTargets.map(function (t) { return LCStore.create(t.id, CONFIG.PROPERTY_KEY); });
        return Promise.all(stores.map(function (st) { return st.load(); })).then(function (results) {
        var tagPool = [];
        validTargets.forEach(function (t, i) {
          var data = results[i];
          var tags = data.tags || DEFAULT_TAGS.slice();
          state.targetsData[t.id] = { store: stores[i], items: data.items, tags: tags };
          tags.forEach(function (tag) { if (tagPool.indexOf(tag) === -1) tagPool.push(tag); });
        });
        state.tagSuggestionPool = tagPool;
        state.validTargets = validTargets;

        renderTagSuggestions();
        renderThumbOptions(images);
        setStatus('');
        els.form.style.display = '';
        els.title.focus();
        });
      });
    }).catch(function (err) {
      setStatus('読み込みに失敗しました: ' + err.message, true);
    });
  }

  function CSS_TEXT() {
    return [
      ':host { --qa-font:"BIZ UDPGothic","BIZ UDPゴシック","Hiragino Sans","Hiragino Kaku Gothic ProN","Yu Gothic UI","Meiryo",sans-serif; --qa-canvas:#F5F6F8; --qa-line:#E4E6EB; --qa-line-strong:#CDD1D9; --qa-ink:#15171C; --qa-text:#2A2D34; --qa-muted:#6B7080; --qa-faint:#9AA0AE; --qa-accent:#5B5BD6; --qa-accent-ink:#4744C2; --qa-accent-soft:#EEEEFD; --qa-danger:#C2372B; all:initial; }',
      '.qa-app { display:block; font-family:var(--qa-font); font-feature-settings:"palt" 1; letter-spacing:.01em; -webkit-font-smoothing:antialiased; background:#fff; color:var(--qa-text); padding:22px 20px; max-width:440px; box-sizing:border-box; font-size:13px; line-height:1.6; }',
      '.qa-app * { box-sizing:border-box; font-family:inherit; }',
      '.qa-header { display:flex; align-items:center; gap:10px; font-size:17px; font-weight:700; color:var(--qa-ink); margin-bottom:14px; }',
      '.qa-mark { width:28px; height:28px; border-radius:9px; background:var(--qa-accent); position:relative; flex:none; }',
      '.qa-mark::before, .qa-mark::after { content:""; position:absolute; left:50%; top:50%; background:#fff; border-radius:1px; transform:translate(-50%,-50%); }',
      '.qa-mark::before { width:12px; height:2px; } .qa-mark::after { width:2px; height:12px; }',
      '.qa-targets-note { font-size:12px; color:var(--qa-muted); margin-bottom:14px; background:var(--qa-canvas); border-radius:12px; padding:10px 12px; display:grid; gap:2px; }',
      '.qa-targets-note:empty { display:none; }',
      '.qa-targets-label { font-weight:700; color:var(--qa-text); font-size:11.5px; margin-bottom:2px; }',
      '.qa-target-item { padding:1px 0; color:var(--qa-text); }',
      '.qa-target-warn { color:#A8501C; font-weight:700; }',
      '.qa-status { font-size:12.5px; color:var(--qa-muted); min-height:18px; margin-bottom:8px; }',
      '.qa-status:empty { display:none; }',
      '.qa-status-error { color:var(--qa-danger); }',
      '.qa-error { background:#FDEDEB; color:#A52A1F; border:1px solid #F6CBC5; border-radius:10px; padding:9px 12px; font-size:12.5px; margin-bottom:8px; }',
      '.qa-field { display:flex; flex-direction:column; gap:6px; font-size:12px; color:var(--qa-muted); margin-bottom:14px; }',
      '.qa-thumb-options { display:flex; gap:8px; flex-wrap:wrap; }',
      '.qa-thumb-opt { position:relative; padding:0; border:1px solid var(--qa-line); border-radius:10px; overflow:hidden; width:76px; height:52px; cursor:pointer; background:var(--qa-canvas); flex-shrink:0; transition:border-color .15s, box-shadow .15s; }',
      '.qa-thumb-opt img { width:100%; height:100%; object-fit:cover; display:block; }',
      '.qa-thumb-opt:hover { border-color:var(--qa-line-strong); }',
      '.qa-thumb-opt.is-selected { border-color:var(--qa-accent); box-shadow:0 0 0 2px var(--qa-accent); }',
      '.qa-thumb-none { display:flex; align-items:center; justify-content:center; font-size:11.5px; color:var(--qa-muted); }',
      '.qa-thumb-none.is-selected { color:var(--qa-accent-ink); background:var(--qa-accent-soft); }',
      '.qa-tag-suggestions { display:flex; flex-wrap:wrap; gap:5px; margin-top:2px; }',
      '.qa-tag-suggest { border:1px solid var(--qa-line); background:#fff; color:var(--qa-text); font-size:11.5px; padding:4px 10px; border-radius:999px; cursor:pointer; }',
      '.qa-tag-suggest:hover { border-color:var(--qa-accent); color:var(--qa-accent-ink); }',
      '.qa-field input, .qa-field select, .qa-field textarea { font-size:13px; padding:9px 11px; border:1px solid var(--qa-line); border-radius:10px; color:var(--qa-ink); background:#fff; resize:vertical; transition:border-color .15s, box-shadow .15s; }',
      '.qa-field input:focus, .qa-field select:focus, .qa-field textarea:focus { outline:none; border-color:var(--qa-accent); box-shadow:0 0 0 3px rgba(91,91,214,.16); }',
      '.qa-actions { display:flex; justify-content:flex-end; gap:8px; margin-top:18px; }',
      '.qa-btn { height:38px; padding:0 18px; border-radius:10px; border:1px solid var(--qa-line); background:#fff; font-size:13px; cursor:pointer; color:var(--qa-text); }',
      '.qa-btn:hover { border-color:var(--qa-line-strong); color:var(--qa-ink); }',
      '.qa-btn:focus-visible, .qa-thumb-opt:focus-visible, .qa-tag-suggest:focus-visible { outline:2px solid var(--qa-accent); outline-offset:2px; }',
      '.qa-btn-primary { background:var(--qa-accent); color:#fff; border-color:var(--qa-accent); font-weight:700; }',
      '.qa-btn-primary:hover { background:var(--qa-accent-ink); border-color:var(--qa-accent-ink); color:#fff; }',
      '.qa-btn-primary:disabled { opacity:.6; cursor:default; }'
    ].join('\n');
  }

  init();
})();
