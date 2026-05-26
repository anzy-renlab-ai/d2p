#!/usr/bin/env node
// zerou CLI entry. Delegates to dist/zerou-cli.js (built by tsc).
import('../dist/zerou-cli.js')
  .then((m) => m.main(process.argv))
  .catch((e) => {
    console.error(e?.stack ?? e?.message ?? String(e));
    process.exit(1);
  });
