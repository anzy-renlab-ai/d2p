// Dogfood: TestCaseSpec → real .test.ts file via emitVitestTests.
import { createTrackLogger } from '../src/log-types.js';
import { emitVitestTests } from '../src/agent/test-emitter.js';
import fs from 'node:fs';

const logger = createTrackLogger('agent', { silent: true });
const specs = [
  {
    id: 'hello-1',
    name: 'hello returns world',
    category: 'happy-path',
    scope: { type: 'function', target: 'fn:hello', file: 'src/hello.ts', line: 1 },
    given: 'no input',
    when: 'hello() is called',
    then: 'returns world',
    reasoning: 'basic happy path',
  },
];
const fns = [
  {
    file: 'src/hello.ts',
    line: 1,
    name: 'hello',
    kind: 'function',
    params: [],
    returnTypeHint: 'Promise<string>',
    branchCount: 0,
    hasAsyncCall: false,
    hasDatabaseCall: false,
    hasNetworkCall: false,
    sourceSnippet: 'export async function hello() { return "world"; }',
  },
];

const cwd = process.argv[2] ?? '/tmp/track-8b-dogfood';
const files = await emitVitestTests({
  specs,
  functions: fns,
  cwd,
  logger,
  criticConfig: null,
  criticApiKey: null,
});
console.log('emitted:', JSON.stringify(files, null, 2));
console.log('--- content ---');
console.log(fs.readFileSync(files[0].path, 'utf8'));
await logger.flush();
