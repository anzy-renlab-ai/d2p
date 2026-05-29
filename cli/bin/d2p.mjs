#!/usr/bin/env node
// ZeroU CLI entry (legacy alias for zerou). Delegates to dist/index.js (built by tsc).
import('../dist/index.js')
  .then((m) => m.main(process.argv))
  .catch((e) => {
    console.error(e?.stack ?? e?.message ?? String(e));
    process.exit(1);
  });
