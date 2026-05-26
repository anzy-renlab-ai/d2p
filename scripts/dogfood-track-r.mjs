// Track R dogfood: run runtime tests against a tmp dir.
// Sets up /tmp/track-r-dogfood (POSIX) → resolves to OS tmp on Windows.
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createTrackLogger } from '../cli/src/log-types.ts';
import { runRuntimeTests } from '../cli/src/agent/runtime/index.ts';

const demoDir = path.join(os.tmpdir(), 'track-r-dogfood');
fs.mkdirSync(demoDir, { recursive: true });
fs.writeFileSync(path.join(demoDir, 'package.json'), JSON.stringify({ name: 'dog', scripts: { dev: 'node server.js' } }, null, 2));
fs.writeFileSync(path.join(demoDir, 'server.js'), `const http = require('http');
http.createServer((req, res) => {
  if (req.url === '/api/login' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      let parsed; try { parsed = JSON.parse(body || '{}'); } catch { parsed = {}; }
      if (!parsed.email) { res.statusCode = 400; res.setHeader('content-type','application/json'); res.end('{"error":"email required"}'); return; }
      res.setHeader('content-type','application/json'); res.end('{"token":"fake"}');
    });
  } else { res.statusCode = 404; res.end(); }
}).listen(Number(process.env.PORT || 3000), '127.0.0.1', () => console.log('listening on ' + (process.env.PORT || 3000)));
`);

const logger = createTrackLogger('agent', { minLevel: 'info' });
const specs = [
  {
    id: 'login-no-email',
    name: 'login without email returns 400',
    category: 'edge-case',
    scope: { type: 'endpoint', target: 'POST /api/login', file: 'server.js', line: 1 },
    given: 'no email in body',
    when: 'POST /api/login',
    then: 'returns 400',
    reasoning: 'input validation',
  },
  {
    id: 'login-ok',
    name: 'login with email returns 200',
    category: 'happy-path',
    scope: { type: 'endpoint', target: 'POST /api/login', file: 'server.js', line: 1 },
    given: '{"email":"a@b"}',
    when: 'POST /api/login',
    then: 'returns 200',
    reasoning: 'happy path',
  },
];
const { results, runtime } = await runRuntimeTests(specs, demoDir, {
  logger,
  criticConfig: null,
  criticApiKey: null,
  readyTimeoutMs: 8000,
  pollIntervalMs: 200,
});
await logger.flush();
console.log('RUNTIME:', runtime ? { pid: runtime.pid, port: runtime.port, baseUrl: runtime.baseUrl } : null);
console.log('RESULTS:', JSON.stringify(results.map(r => ({
  id: r.spec.id,
  status: r.status,
  verdictReason: r.verdictReason,
  actualBehavior: r.evidence?.actualBehavior,
})), null, 2));
