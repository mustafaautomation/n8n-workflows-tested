// Stand-in for the external services the workflows call: a Slack incoming webhook, the Google
// Sheets values:append endpoint and a few endpoints for the health check. It records every
// request so tests can assert on exactly what n8n sent.
//   GET    /__requests   -> recorded requests (JSON)
//   DELETE /__requests   -> clear
import http from 'node:http';

const PORT = Number(process.env.MOCK_PORT ?? 4010);
const recorded = [];

function send(res, status, body, type = 'application/json') {
  res.writeHead(status, { 'content-type': type });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

export function createMockServer() {
  return http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const url = new URL(req.url, 'http://mock');
      if (url.pathname === '/__requests') {
        if (req.method === 'DELETE') recorded.length = 0;
        return send(res, 200, recorded);
      }
      let body = raw;
      try {
        body = raw ? JSON.parse(raw) : null;
      } catch {
        /* keep raw text */
      }
      recorded.push({ method: req.method, path: url.pathname, query: Object.fromEntries(url.searchParams), body });

      if (req.method === 'POST' && url.pathname === '/slack/webhook') {
        // Slack answers a valid incoming-webhook post with the plain text "ok".
        if (!body || typeof body.text !== 'string') return send(res, 400, 'invalid_payload', 'text/plain');
        return send(res, 200, 'ok', 'text/plain');
      }
      const sheet = /^\/sheets\/v4\/spreadsheets\/([^/]+)\/values\/([^/]+):append$/.exec(
        decodeURIComponent(url.pathname),
      );
      if (req.method === 'POST' && sheet) {
        const rows = body?.values;
        if (!Array.isArray(rows) || rows.length === 0)
          return send(res, 400, { error: { code: 400, message: 'values is required' } });
        const n = recorded.filter((r) => r.path.startsWith('/sheets/')).length;
        return send(res, 200, {
          spreadsheetId: sheet[1],
          updates: {
            updatedRange: `Signups!A${n + 1}:D${n + 1}`,
            updatedRows: rows.length,
            updatedColumns: rows[0].length,
          },
        });
      }
      const status = /^\/status\/(\d{3})$/.exec(url.pathname);
      if (status) return send(res, Number(status[1]), { status: Number(status[1]) });
      return send(res, 404, { error: 'not found' });
    });
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  createMockServer().listen(PORT, '0.0.0.0', () => console.log(`mock listening on ${PORT}`));
}
