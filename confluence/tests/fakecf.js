// Minimal fake of Confluence Server content-property REST endpoints, enforcing 32KB per property.
function makeConfluence(opts = {}) {
  const props = new Map(); // key -> {value, version}
  const stats = { get: 0, list: 0, put: 0, post: 0, conflict: 0, maxBytes: 0 };
  const LIMIT = opts.limit ?? 32768;
  const enc = (v) => new TextEncoder().encode(JSON.stringify(v)).length;
  const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });
  async function fetch(url, init = {}) {
    await new Promise((r) => setTimeout(r, opts.delay ?? 1));
    const m = url.match(/^\/rest\/api\/content\/(\d+)\/property(\/[^?]*)?(\?.*)?$/);
    if (!m) return json(404, {});
    const key = m[2] ? decodeURIComponent(m[2].slice(1)) : null;
    const method = init.method || 'GET';
    if (method === 'GET' && !key) {
      stats.list++;
      if (opts.noList) return json(500, {});
      const q = new URLSearchParams(m[3] || '');
      const start = +q.get('start') || 0, limit = +q.get('limit') || 10;
      const all = [...props].map(([k, p]) => ({ key: k, value: p.value, version: { number: p.version } }));
      return json(200, { results: all.slice(start, start + limit), size: Math.min(limit, all.length - start) });
    }
    if (method === 'GET') { stats.get++; const p = props.get(key); return p ? json(200, { key, value: p.value, version: { number: p.version } }) : json(404, {}); }
    const body = JSON.parse(init.body);
    if (enc(body.value) > LIMIT) return json(413, { message: 'too large ' + enc(body.value) });
    stats.maxBytes = Math.max(stats.maxBytes, enc(body.value));
    if (method === 'POST') {
      stats.post++;
      if (props.has(body.key)) { stats.conflict++; return json(409, { message: 'exists' }); }
      props.set(body.key, { value: body.value, version: 1 }); return json(200, { key: body.key, version: { number: 1 } });
    }
    if (method === 'PUT') {
      stats.put++;
      const p = props.get(key);
      if (!p || body.version.number !== p.version + 1) { stats.conflict++; return json(409, { message: 'stale' }); }
      p.value = body.value; p.version++; return json(200, { key, version: { number: p.version } });
    }
    return json(405, {});
  }
  return { fetch, props, stats, enc };
}
module.exports = { makeConfluence };
