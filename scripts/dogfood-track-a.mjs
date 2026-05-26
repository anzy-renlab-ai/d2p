// Track A dogfood: drive detectProject + buildChecklist on a fixture.
import { createTrackLogger } from '../cli/src/log-types.ts';
import { detectProject } from '../cli/src/agent/project-detector.ts';
import { buildChecklist } from '../cli/src/agent/checklist-builder.ts';

const cwd = process.argv[2] ?? '/tmp/track-a-dogfood';
const logRoot = `${cwd}/.zerou/logs`;

const logger = createTrackLogger('agent', { logRoot });

const profile = await detectProject({
  cwd,
  logger,
  criticConfig: null,
  criticApiKey: null,
});
console.log('---PROFILE---');
console.log(JSON.stringify(profile, null, 2));

const checklist = await buildChecklist({
  profile,
  availablePresets: [
    {
      manifest: { id: 'secrets-leak', version: 1, appliesTo: [], rules: [], body: '' },
      source: 'plugin',
      resolvedPath: '/fake/secrets-leak.md',
      shadowedBy: [],
    },
    {
      manifest: { id: 'supabase-rls', version: 1, appliesTo: [], rules: [], body: '' },
      source: 'plugin',
      resolvedPath: '/fake/supabase-rls.md',
      shadowedBy: [],
    },
  ],
  logger,
  criticConfig: null,
  criticApiKey: null,
});
console.log('---CHECKLIST---');
console.log(JSON.stringify(checklist, null, 2));

await logger.flush();
console.log('---LOG ROOT---');
console.log(logRoot);
