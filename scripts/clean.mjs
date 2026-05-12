#!/usr/bin/env node
import { rm } from 'node:fs/promises';

const targets = [
  'node_modules',
  'daemon/node_modules', 'daemon/dist', 'daemon/.tsbuildinfo',
  'ui/node_modules', 'ui/dist', 'ui/.vite', 'ui/.tsbuildinfo',
  'cli/node_modules', 'cli/dist', 'cli/.tsbuildinfo',
];

for (const t of targets) {
  await rm(t, { recursive: true, force: true });
  console.log(`removed ${t}`);
}
