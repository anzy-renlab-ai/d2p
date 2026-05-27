/**
 * Top-level `zerou` CLI dispatcher.
 *   zerou audit <path> [opts]
 *   zerou trace [trace-id] [--last] [--filter <glob>]
 */
import { runAudit } from './audit.js';
import { runTrace } from './trace.js';
import { runEnhance } from './enhance.js';
import { runReview } from './review.js';
import { runCoverage } from './coverage.js';

export async function main(argv: string[]): Promise<void> {
  // argv = ['node', 'zerou', <subcommand>, ...]
  const sub = argv[2];
  if (sub === 'enhance') {
    const code = await runEnhance({ argv });
    process.exit(code);
  }
  if (sub === 'review') {
    const code = await runReview({ argv });
    process.exit(code);
  }
  if (sub === 'coverage') {
    const code = await runCoverage({ argv });
    process.exit(code);
  }
  if (sub === 'trace') {
    // Parse remainder ourselves (simple)
    const rest = argv.slice(3);
    let last = false;
    let filter: string | undefined;
    let traceId: string | undefined;
    let pathArg: string | undefined;
    for (let i = 0; i < rest.length; i++) {
      const a = rest[i];
      if (a === '--last') last = true;
      else if (a === '--filter' && i + 1 < rest.length) {
        filter = rest[i + 1];
        i++;
      } else if (a === '--path' && i + 1 < rest.length) {
        pathArg = rest[i + 1];
        i++;
      } else if (a && !a.startsWith('--')) {
        traceId = a;
      }
    }
    const code = await runTrace({
      cwd: pathArg ?? process.cwd(),
      traceId,
      last,
      filter,
    });
    process.exit(code);
  }
  // Default: forward everything (including --help / --version / audit) to runAudit
  const code = await runAudit({ argv });
  process.exit(code);
}
