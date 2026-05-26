// Tiny fixture server. Listens on PORT env (default 3000). Used by launcher
// + http-tester + index integration tests.
const http = require('http');

const port = Number(process.env.PORT || 3000);

const server = http.createServer((req, res) => {
  if (req.url === '/api/login' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      let parsed;
      try {
        parsed = JSON.parse(body || '{}');
      } catch {
        res.statusCode = 400;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ error: 'bad json' }));
        return;
      }
      if (!parsed.email) {
        res.statusCode = 400;
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ error: 'email required' }));
        return;
      }
      res.statusCode = 200;
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ token: 'fake-token', email: parsed.email }));
    });
    return;
  }
  if (req.url === '/healthz' && req.method === 'GET') {
    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ ok: true, name: 'fixture' }));
    return;
  }
  res.statusCode = 404;
  res.end('not found');
});

server.listen(port, '127.0.0.1', () => {
  // eslint-disable-next-line no-console
  console.log('listening on ' + port);
});
