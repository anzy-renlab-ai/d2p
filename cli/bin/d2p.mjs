#!/usr/bin/env node
// d2p CLI entry. Delegates to dist/index.js (built by tsc).
import('../dist/index.js')
  .then((m) => m.main(process.argv))
  .catch((e) => {
    console.error(e?.stack ?? e?.message ?? String(e));
    process.exit(1);
  });
