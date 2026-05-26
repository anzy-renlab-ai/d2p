/**
 * `zerou audit <path>` — main entry.
 *
 * Surface: docs/details/15-hardener-cli-public-surface.md
 *
 * Exit codes:
 *   0 — fail-on threshold not crossed
 *   1 — execution error (A-E-7/8/9)
 *   2 — fail-on threshold crossed
 *   3 — config error (A-E-1..6)
 */
import * as fs from 'node:fs';
import path from 'node:path';
import { Command } from 'commander';
import { createTrackLogger } from './log-types.js';
import type { TrackLogger, LogLevel } from './log-types.js';
import {
  loadConfig,
  ConfigError,
  resolveKeyForProvider,
  providerForKind,
  type ZerouConfig,
} from './config.js';
import { prepareRepo, RepoError } from './repo.js';
import {
  defaultRunPreset,
  HARDCODED_KEY_PRESET,
  selectCriticPolicy,
  engineFamily,
  type EngineConfig,
  type LoadedPreset,
  type PresetDeps,
  type VerdictedFinding,
} from './stubs.js';
import { buildBundle, writeBundle, type ApplyCounters } from './evidence-bundle.js';
import { renderReport } from './report.js';
import { runApplyPhase } from './apply.js';
import { logBranch, logCatch } from './log/branch.js';
import { detectProject } from './agent/project-detector.js';
import { buildChecklist } from './agent/checklist-builder.js';
import { generateTestCases } from './agent/test-case-generator.js';
import { runTestCaseBatch } from './agent/test-spec-runner.js';
import type { TestCaseSpec, TestCaseResult, TestSummary } from './agent/types.js';

export const ZEROU_CLI_VERSION = '0.1.0';

export interface AuditDeps extends Partial<PresetDeps> {
  // Test hooks
  stdoutWrite?: (s: string) => void;
  stderrWrite?: (s: string) => void;
  /** Override homedir (test affordance for legacy-fallback tests) */
  homeDir?: string;
}

export interface AuditOptions {
  argv: string[];
  deps?: AuditDeps;
}

export async function runAudit(opts: AuditOptions): Promise<number> {
  const writeOut = opts.deps?.stdoutWrite ?? ((s: string) => process.stdout.write(s));
  const writeErr = opts.deps?.stderrWrite ?? ((s: string) => process.stderr.write(s));

  // Parse argv with Commander
  const program = new Command();
  program.exitOverride();
  program
    .name('zerou')
    .description('zerou audit — find product-shipping gotchas')
    .version(ZEROU_CLI_VERSION);

  program
    .command('audit')
    .argument('<path>', 'absolute or relative path to a directory')
    .option('--preset <id...>', 'limit to specific preset ids', collect, [])
    .option('--apply', 'attempt fixes after verdicts', false)
    .option('--fail-on <severity>', 'exit-code threshold (p1|p2|p3|none)', 'none')
    .option('--key <provider=key...>', 'inline LLM key (redacted from process.argv)', collect, [])
    .option('--allow-dirty', 'allow --apply on dirty working tree', false)
    .option('--out <file>', 'write EvidenceBundle JSON to this file')
    .option('--config <file>', 'override config path')
    .option('--concurrency <n>', 'override critic concurrency', '5')
    .option('--cost-cap <usd>', 'override critic cost cap', 'Infinity')
    .option('--log-level <level>', 'log level (debug|info|warn|error)')
    .option('--no-color', 'disable ANSI color')
    .option('--insecure-config', 'skip unsafe-perms check on Unix', false)
    .action(async (auditPath: string, cmdOpts: any) => {
      // Redact --key values in BOTH process.argv (B-6-1 surface contract) and
      // opts.argv (test affordance). Note line is emitted once per distinct
      // provider across both arrays.
      const noteEmitted = new Set<string>();
      redactKeyArgv(process.argv, writeErr, noteEmitted);
      redactKeyArgv(opts.argv, writeErr, noteEmitted);

      const exit = await doAudit(auditPath, cmdOpts, opts.deps ?? {}, writeOut, writeErr);
      // throw to escape commander's await
      throw new ExitCodeSignal(exit);
    });

  try {
    await program.parseAsync(opts.argv, { from: 'node' });
    return 0;
  } catch (e) {
    if (e instanceof ExitCodeSignal) return e.exitCode;
    // commander threw e.g. unknown option → exit 1
    if ((e as any).code === 'commander.help' || (e as any).code === 'commander.version') return 0;
    if ((e as any).code === 'commander.helpDisplayed') return 0;
    writeErr(`error: ${(e as Error).message}\n`);
    return 1;
  }
}

class ExitCodeSignal extends Error {
  constructor(public exitCode: number) {
    super(`exit ${exitCode}`);
  }
}

function collect(value: string, prev: string[]): string[] {
  return [...prev, value];
}

function redactKeyArgv(
  argv: string[],
  writeErr: (s: string) => void,
  noteEmitted: Set<string>,
): void {
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--key' && i + 1 < argv.length) {
      const v = argv[i + 1]!;
      const eq = v.indexOf('=');
      if (eq > 0) {
        const provider = v.slice(0, eq);
        if (argv[i + 1] !== `${provider}=[REDACTED]`) {
          argv[i + 1] = `${provider}=[REDACTED]`;
        }
        emitNote(provider, writeErr, noteEmitted);
      }
    } else if (argv[i]?.startsWith('--key=')) {
      const after = argv[i]!.slice('--key='.length);
      const eq = after.indexOf('=');
      if (eq > 0) {
        const provider = after.slice(0, eq);
        if (argv[i] !== `--key=${provider}=[REDACTED]`) {
          argv[i] = `--key=${provider}=[REDACTED]`;
        }
        emitNote(provider, writeErr, noteEmitted);
      }
    }
  }
}

function emitNote(provider: string, writeErr: (s: string) => void, emitted: Set<string>): void {
  if (emitted.has(provider)) return;
  emitted.add(provider);
  const envName = `ZEROU_${provider.toUpperCase().replace(/-/g, '_')}_KEY`;
  writeErr(
    `note: --key value redacted from process listing. For repeated runs, use ${envName} env var or ~/.zerou/config.json (chmod 600).\n`,
  );
}

async function doAudit(
  auditPath: string,
  cmdOpts: any,
  deps: AuditDeps,
  writeOut: (s: string) => void,
  writeErr: (s: string) => void,
): Promise<number> {
  const startedAt = new Date();
  // Recover original --key values from process.argv? No — they're already
  // redacted in argv. We get keys from the **original** argv before redaction.
  // Trick: redactKeyArgv was called on process.argv. We need to capture the
  // raw values FIRST. Solution: rerun parse from opts.argv... but that's also
  // redacted. So extract before. Re-think: we parse with commander which has
  // already captured the values into cmdOpts.key BEFORE we redact. Verify.

  const cliKeys = parseKeyFlags(cmdOpts.key ?? []);

  // Build logger
  const logRoot = path.join(path.resolve(auditPath), '.zerou', 'logs');
  // Make sure path exists; createTrackLogger may delay until first write.
  const minLevel: LogLevel | undefined =
    cmdOpts.logLevel && ['debug', 'info', 'warn', 'error'].includes(cmdOpts.logLevel)
      ? (cmdOpts.logLevel as LogLevel)
      : undefined;

  // We need cwd to exist before computing logRoot for non-default cases.
  // For path.missing failures we use a fallback log root in os.tmpdir, but the
  // surface wants <cwd>/.zerou/logs. Reasonable middle ground: if the path
  // doesn't exist, log to ./.zerou/logs in the current working directory.
  const fallbackLogRoot = path.join(process.cwd(), '.zerou', 'logs');
  const resolvedAuditPath = path.resolve(auditPath);
  const pathIsDir =
    fs.existsSync(resolvedAuditPath) &&
    (() => {
      try {
        return fs.statSync(resolvedAuditPath).isDirectory();
      } catch {
        return false;
      }
    })();
  const effectiveLogRoot = pathIsDir ? logRoot : fallbackLogRoot;
  // logger isn't created yet, but the decision is consequential to where
  // every later log lands — we record it via the cli logger right after
  // construction below.

  const logger = createTrackLogger('cli', {
    logRoot: effectiveLogRoot,
    minLevel,
  });
  const auditTrackLogger = createTrackLogger('audit', {
    logRoot: effectiveLogRoot,
    parentTrace: logger.trace,
    minLevel,
  });

  const presetsRequested: string[] = cmdOpts.preset ?? [];
  const applyFlag: boolean = cmdOpts.apply ?? false;
  const allowDirty: boolean = cmdOpts.allowDirty ?? false;
  const failOn: 'p1' | 'p2' | 'p3' | 'none' = (cmdOpts.failOn ?? 'none') as any;
  const useColor: boolean = cmdOpts.color !== false;

  logger.log('info', 'cli.audit.start', {
    path: path.resolve(auditPath),
    presets: presetsRequested,
    apply: applyFlag,
    failOn,
  });
  logBranch(logger, 'cli.log-root.target-decision', {
    decision: pathIsDir ? 'audit-cwd' : 'process-cwd-fallback',
    reasoning: pathIsDir
      ? 'audit path is a directory; logs go under <path>/.zerou/logs'
      : 'audit path missing or not a directory; logs go under process.cwd/.zerou/logs',
    effectiveLogRoot,
  });

  // 1. Prepare repo (A-E-1, B-1-1..1-4)
  let repoInfo;
  try {
    repoInfo = prepareRepo({
      cwd: auditPath,
      apply: applyFlag,
      allowDirty,
      logger,
    });
    logBranch(logger, 'cli.repo.prepare-decision', {
      decision: 'success',
      head: repoInfo.head,
      autoInited: repoInfo.autoInited,
    });
  } catch (e) {
    if (e instanceof RepoError) {
      logBranch(
        logger,
        'cli.repo.prepare-decision',
        {
          decision: 'fail-exit-3',
          errorCode: e.errorCode,
          reasoning: e.message.slice(0, 200),
        },
        { level: 'info' },
      );
      writeErr(`error: ${e.message}\n`);
      logger.log('info', 'cli.audit.end', {
        findingsCount: 0,
        exitCode: 3,
        durationMs: Date.now() - startedAt.getTime(),
      });
      await logger.flush();
      return 3;
    }
    logCatch(logger, 'cli.repo.prepare-decision', e, {
      decision: 'rethrow-unknown',
    });
    throw e;
  }

  // 2. Load config (A-E-3, A-E-4, B-10-1, B-10-2, B-10-3)
  let cfg: ZerouConfig | null = null;
  let configLegacyUsed = false;
  try {
    const loaded = loadConfig({
      configPath: cmdOpts.config,
      insecureConfig: cmdOpts.insecureConfig,
      homeDir: deps.homeDir,
      logger,
    });
    cfg = loaded.cfg;
    configLegacyUsed = loaded.legacyUsed;
    logBranch(logger, 'cli.config.load-decision', {
      decision: 'loaded',
      legacyUsed: configLegacyUsed,
      source: loaded.source,
    });
  } catch (e) {
    if (e instanceof ConfigError) {
      if (e.errorCode === 'A-E-4') {
        logBranch(
          logger,
          'cli.config.load-decision',
          {
            decision: 'fail-unsafe-perms',
            errorCode: 'A-E-4',
            mode: e.mode ?? null,
          },
          { level: 'info' },
        );
        writeErr(`error: ${e.message}\n`);
        logger.log('info', 'cli.audit.end', {
          findingsCount: 0,
          exitCode: 3,
          durationMs: Date.now() - startedAt.getTime(),
        });
        await logger.flush();
        return 3;
      }
      // A-E-3
      logBranch(
        logger,
        'cli.config.load-decision',
        {
          decision: 'fail-invalid',
          errorCode: 'A-E-3',
          issues: e.issues ?? null,
        },
        { level: 'info' },
      );
      logger.log('error', 'cli.config.invalid', {
        errorCode: 'A-E-3',
        issues: e.issues ?? e.message,
      });
      writeErr(`error: ${e.message}\n`);
      logger.log('info', 'cli.audit.end', {
        findingsCount: 0,
        exitCode: 3,
        durationMs: Date.now() - startedAt.getTime(),
      });
      await logger.flush();
      return 3;
    }
    logCatch(logger, 'cli.config.load-decision', e, {
      decision: 'rethrow-unknown',
    });
    throw e;
  }
  // (legacyUsed already logged by loadConfig)
  void configLegacyUsed;

  // 3. Build worker engine config (A-E-6)
  const cfgKeys = cfg.keys;
  const workerProvider = providerForKind(cfg.worker.kind);
  const workerKey = resolveKeyForProvider(workerProvider, cliKeys, process.env, cfgKeys);
  const worker: EngineConfig = { ...cfg.worker };
  if (workerKey) {
    (worker as any).apiKey = workerKey;
    logBranch(logger, 'cli.worker.key-decision', {
      decision: 'key-resolved',
      provider: workerProvider,
      workerKind: cfg.worker.kind,
    });
  } else {
    logBranch(logger, 'cli.worker.key-decision', {
      decision: 'no-key',
      reasoning: 'CLI-subprocess engine may auth differently',
      provider: workerProvider,
      workerKind: cfg.worker.kind,
    });
  }
  // We do NOT fail at this stage on missing key — the worker may use CLI tools
  // (claude-cli / codex-cli / gemini-cli) that auth differently. If the engine
  // factory fails downstream we emit cli.engine.worker-build-failed (A-E-6).

  // 4. Critic policy
  const criticPool: EngineConfig[] = (cfg.criticPool ?? []).map((c) => {
    const p = providerForKind(c.kind);
    const k = resolveKeyForProvider(p, cliKeys, process.env, cfgKeys);
    return k ? { ...c, apiKey: k } : { ...c };
  });
  const policy = selectCriticPolicy(worker, criticPool);
  logBranch(
    logger,
    'cli.critic.policy-decision',
    {
      decision: policy.crossFamily ? 'cross-family' : 'no-cross-family',
      reasoning: policy.reason ?? 'cross-family critic available',
      workerFamily: policy.workerFamily,
      criticPoolSize: criticPool.length,
    },
    { level: 'info' },
  );
  // Resolve API key for the critic engine, per Q8 precedence.
  if (policy.criticConfig) {
    const criticProvider = providerForKind(policy.criticConfig.kind);
    const criticKey = resolveKeyForProvider(criticProvider, cliKeys, process.env, cfgKeys);
    policy.criticApiKey = criticKey;
    logBranch(logger, 'cli.critic.key-decision', {
      decision: criticKey ? 'resolved' : 'no-key',
      criticProvider,
      criticKind: policy.criticConfig.kind,
    });
    // Make sure the critic engine config carries the key too (for direct use).
    if (criticKey && !policy.criticConfig.apiKey) {
      policy.criticConfig = { ...policy.criticConfig, apiKey: criticKey };
      logBranch(logger, 'cli.critic.key-attach-decision', {
        decision: 'attached',
        reasoning: 'criticConfig had no apiKey; injecting resolved key',
      });
    }
  } else {
    logBranch(logger, 'cli.critic.key-decision', {
      decision: 'skip',
      reasoning: 'no critic config selected by policy',
    });
  }
  // critic.policy-selected is Track P1's responsibility per surface §"Policy-
  // selection event ownership"; CLI does NOT duplicate. We still need to log
  // it for traceability when Track P1 isn't integrated. Emit under critic
  // track with parentTrace.
  const criticLogger = createTrackLogger('critic', {
    logRoot: effectiveLogRoot,
    parentTrace: logger.trace,
    minLevel,
  });
  criticLogger.log('info', 'critic.policy-selected', {
    crossFamily: policy.crossFamily,
    reason: policy.reason,
    workerFamily: policy.workerFamily,
    criticFamily: policy.criticConfig ? engineFamily(policy.criticConfig) : null,
    criticHasKey: !!policy.criticApiKey,
  });

  // 5. Resolve presets
  let presets: LoadedPreset[];
  try {
    presets = await resolvePresets(presetsRequested, deps);
    logBranch(logger, 'cli.preset.resolve-decision', {
      decision: 'resolved',
      requestedCount: presetsRequested.length,
      resolvedCount: presets.length,
    });
  } catch (e) {
    if ((e as any).code === 'PRESET-MISSING') {
      logBranch(
        logger,
        'cli.preset.resolve-decision',
        {
          decision: 'fail-missing',
          requestedId: (e as any).requestedId,
          errorCode: 'PRESET-MISSING',
        },
        { level: 'info' },
      );
      logger.log('error', 'cli.preset.requested-missing', {
        requestedId: (e as any).requestedId,
      });
      writeErr(`error: ${(e as Error).message}\n`);
      logger.log('info', 'cli.audit.end', {
        findingsCount: 0,
        exitCode: 3,
        durationMs: Date.now() - startedAt.getTime(),
      });
      await logger.flush();
      return 3;
    }
    logCatch(logger, 'cli.preset.resolve-decision', e, {
      decision: 'rethrow-unknown',
    });
    throw e;
  }
  logger.log('info', 'cli.preset.listed', { count: presets.length });

  // ── Phase 4: Agent orchestration (when user did not pin --preset) ──────────
  // Run detectProject + buildChecklist for the agent track. Findings still flow
  // through the existing preset loop below — orchestrator's value here is the
  // decision trail visible under track='agent'.
  if (presetsRequested.length === 0) {
    const agentLogger = createTrackLogger('agent', {
      logRoot: effectiveLogRoot,
      parentTrace: logger.trace,
      minLevel,
    });
    try {
      const profile = await detectProject({
        cwd: repoInfo.cwd,
        logger: agentLogger,
        criticConfig: policy.criticConfig,
        criticApiKey: policy.criticApiKey ?? null,
      });
      const checklist = await buildChecklist({
        profile,
        availablePresets: presets,
        logger: agentLogger,
        criticConfig: policy.criticConfig,
        criticApiKey: policy.criticApiKey ?? null,
      });
      // Filter presets to those the agent's checklist marked as non-skip.
      const wantedPresetIds = new Set<string>();
      for (const item of checklist) {
        if (item.priority !== 'skip') {
          for (const id of item.presetIds) wantedPresetIds.add(id);
        }
      }
      if (wantedPresetIds.size > 0) {
        const before = presets.length;
        presets = presets.filter((p) => wantedPresetIds.has(p.manifest.id));
        logBranch(agentLogger, 'agent.preset-filter.decision', {
          decision: 'narrowed',
          before,
          after: presets.length,
          presetIds: [...wantedPresetIds],
        }, { level: 'info' });
      } else {
        logBranch(agentLogger, 'agent.preset-filter.decision', {
          decision: 'keep-all',
          reasoning: 'checklist did not mark any preset; running all available',
        }, { level: 'info' });
      }
    } catch (e) {
      logCatch(agentLogger, 'agent.orchestrator.error', e);
      // Non-fatal: fall back to running all presets (legacy behavior).
    }
    await agentLogger.flush();
  } else {
    logBranch(logger, 'cli.agent.mode-decision', {
      decision: 'skip-agent',
      reasoning: 'user pinned --preset; legacy mode',
    });
  }

  // ── Phase 5: Test case generator + runner (when agent mode active) ─────────
  let testResults: TestCaseResult[] = [];
  let testSummary: TestSummary | null = null;
  if (presetsRequested.length === 0) {
    const testLogger = createTrackLogger('agent', {
      logRoot: effectiveLogRoot,
      parentTrace: logger.trace,
      minLevel,
    });
    try {
      // Use the profile from earlier detection if available; else minimal fallback.
      const profileForTests = {
        framework: 'unknown',
        backend: null,
        language: [] as string[],
        hasGit: true,
        hasTests: false,
        hasEnvFile: false,
        packageMgr: null as 'npm' | 'pnpm' | 'yarn' | null,
        evidence: {} as Record<string, string>,
      };
      const specs = await generateTestCases({
        cwd: repoInfo.cwd,
        profile: profileForTests,
        logger: testLogger,
        criticConfig: policy.criticConfig,
        criticApiKey: policy.criticApiKey ?? null,
        maxCasesPerTarget: 3,
      });
      if (specs.length > 0) {
        logBranch(testLogger, 'agent.test-gen.summary-decision', {
          decision: 'run-tests',
          totalSpecs: specs.length,
        }, { level: 'info' });
        const batchResult = await runTestCaseBatch(specs, {
          cwd: repoInfo.cwd,
          logger: testLogger,
          criticConfig: policy.criticConfig,
          criticApiKey: policy.criticApiKey ?? null,
        });
        testResults = batchResult.results;
        testSummary = batchResult.summary;
      } else {
        logBranch(testLogger, 'agent.test-gen.summary-decision', {
          decision: 'no-specs-generated',
          reasoning: 'no testable targets extracted from source',
        }, { level: 'info' });
      }
    } catch (e) {
      logCatch(testLogger, 'agent.test-phase.error', e);
      // Non-fatal: tests are advisory in v1.
    }
    await testLogger.flush();
  }

  // Shadow warnings (B-3-1)
  const shadowedPresets: Array<{
    presetId: string;
    winningSource: 'plugin' | 'project' | 'builtin';
    shadowedSources: ('plugin' | 'project' | 'builtin')[];
  }> = [];
  for (const p of presets) {
    if (p.shadowedBy.length > 0) {
      logBranch(logger, 'cli.preset.shadow-decision', {
        decision: 'shadowed',
        presetId: p.manifest.id,
        winningSource: p.source,
        shadowedSources: p.shadowedBy,
      });
      logger.log('warn', 'cli.preset.shadow-warn', {
        presetId: p.manifest.id,
        winningSource: p.source,
        shadowedSources: p.shadowedBy,
      });
      shadowedPresets.push({
        presetId: p.manifest.id,
        winningSource: p.source,
        shadowedSources: p.shadowedBy,
      });
    } else {
      logBranch(logger, 'cli.preset.shadow-decision', {
        decision: 'no-shadow',
        presetId: p.manifest.id,
        source: p.source,
      });
    }
  }

  // 6. Run presets
  const readFiles = new Set<string>();
  const allFindings: VerdictedFinding[] = [];
  const runPresetFn = deps.runPreset ?? defaultRunPreset;
  for (const preset of presets) {
    try {
      const presetLogger = createTrackLogger('preset', {
        logRoot: effectiveLogRoot,
        parentTrace: logger.trace,
        minLevel,
      });
      presetLogger.log('info', 'preset.run.start', { presetId: preset.manifest.id });
      const findings = await runPresetFn(preset.manifest, {
        cwd: repoInfo.cwd,
        logger: presetLogger,
        criticPolicy: policy,
        worker,
        readFiles,
        logRoot: effectiveLogRoot,
      });
      presetLogger.log('info', 'preset.run.end', {
        presetId: preset.manifest.id,
        findingsCount: findings.length,
      });
      // Also emit preset.rule.matched for traceability (Q1 from dispatch #13)
      for (const f of findings) {
        presetLogger.log('info', 'preset.rule.matched', {
          presetId: f.presetId,
          ruleId: f.ruleId,
          findingId: f.id,
          file: f.file,
          line: f.line,
        });
      }
      allFindings.push(...findings);
    } catch (e) {
      logCatch(logger, 'cli.preset.run-decision', e, {
        decision: 'fail-skip-preset',
        presetId: preset.manifest.id,
        errorCode: (e as any).errorCode ?? 'unknown',
      });
      logger.log('error', 'cli.preset.run-failed', {
        presetId: preset.manifest.id,
        errorCode: (e as any).errorCode ?? 'unknown',
      });
    }
  }

  // 7. Compute fail-on threshold BEFORE apply (B-10-6)
  const exitCode = computeExitCode(allFindings, failOn);
  logBranch(
    logger,
    'cli.fail-on.exit-decision',
    {
      decision: exitCode === 0 ? 'pass' : 'threshold-crossed',
      failOn,
      exitCode,
      findingsCount: allFindings.length,
    },
    { level: 'info' },
  );

  // 8. Apply phase (if requested)
  let applyCounters: ApplyCounters | null = null;
  if (applyFlag) {
    logBranch(
      logger,
      'cli.apply.mode-decision',
      {
        decision: 'enabled',
        findingsCount: allFindings.length,
        confirmedCount: allFindings.filter((f) => f.verdict === 'confirmed').length,
      },
      { level: 'info' },
    );
    const changedFiles = new Set<string>();
    applyCounters = await runApplyPhase(allFindings, presets, {
      cwd: repoInfo.cwd,
      logger,
      worker,
      deps,
      changedFiles,
    });
  } else {
    logBranch(logger, 'cli.apply.mode-decision', {
      decision: 'disabled',
      reasoning: '--apply flag not set',
    });
  }

  // 9. Build bundle + write
  const endedAt = new Date();
  const bundle = buildBundle({
    startedAt,
    endedAt,
    cwd: repoInfo.cwd,
    repoSha: repoInfo.head,
    presets,
    worker,
    critic: policy.criticConfig,
    findings: allFindings,
    readFiles,
    failOnThreshold: failOn,
    exitCode,
    apply: applyCounters,
    trace: logger.trace,
    zerouVersion: ZEROU_CLI_VERSION,
    logger,
  });

  if (cmdOpts.out) {
    logBranch(logger, 'cli.bundle.emit-decision', {
      decision: 'write',
      path: cmdOpts.out,
    });
    const r = writeBundle(cmdOpts.out, bundle, logger);
    if (!r.ok) {
      // A-E-9 → exit 1
      logBranch(
        logger,
        'cli.bundle.write-decision',
        {
          decision: 'fail-exit-1',
          errorCode: 'A-E-9',
          error: r.error ?? null,
        },
        { level: 'info' },
      );
      logger.log('info', 'cli.audit.end', {
        findingsCount: allFindings.length,
        exitCode: 1,
        durationMs: Date.now() - startedAt.getTime(),
      });
      return 1;
    }
    logBranch(logger, 'cli.bundle.write-decision', {
      decision: 'success',
      bytes: r.bytes,
    });
  } else {
    logBranch(logger, 'cli.bundle.emit-decision', {
      decision: 'skip',
      reasoning: '--out flag not supplied',
    });
  }

  // 10. Emit audit.summary under track='audit'
  auditTrackLogger.log('info', 'audit.summary', {
    counts: bundle.summary.counts,
    byPreset: bundle.summary.byPreset,
    failOnThreshold: bundle.summary.failOnThreshold,
    exitCode: bundle.summary.exitCode,
  });

  // 11. Render stdout report
  const report = renderReport({
    cwd: repoInfo.cwd,
    presets,
    shadowedPresets,
    findings: allFindings,
    workerFamily: policy.workerFamily,
    failOnThreshold: failOn,
    apply: applyCounters,
    exitCode,
    useColor,
    logger,
  });
  writeOut(report);

  // Phase 5: append test summary if tests were run
  if (testSummary && testSummary.total > 0) {
    const lines: string[] = ['', '## Test Cases'];
    lines.push(
      `Tests: ${testSummary.pass} pass / ${testSummary.fail} fail / ${testSummary.inconclusive} inconclusive / ${testSummary.skipped} skipped (total ${testSummary.total})`,
    );
    if (testSummary.fail > 0) {
      lines.push('');
      lines.push('Failed tests:');
      for (const r of testResults) {
        if (r.status === 'fail') {
          const loc = r.evidence.line ? `:${r.evidence.line}` : '';
          lines.push(`  ✗ ${r.spec.name}`);
          lines.push(`      at ${r.evidence.file ?? r.spec.scope.file}${loc}`);
          lines.push(`      ${r.verdictReason.slice(0, 200)}`);
        }
      }
    }
    writeOut(lines.join('\n') + '\n');
  }

  logger.log('info', 'cli.audit.end', {
    findingsCount: allFindings.length,
    exitCode,
    durationMs: endedAt.getTime() - startedAt.getTime(),
  });

  // Flush logs before exit
  await logger.flush();
  await auditTrackLogger.flush();
  await criticLogger.flush();

  return exitCode;
}

function parseKeyFlags(values: string[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const v of values) {
    const eq = v.indexOf('=');
    if (eq <= 0) continue;
    const provider = v.slice(0, eq);
    const value = v.slice(eq + 1);
    // Skip already-redacted entries
    if (value === '[REDACTED]') continue;
    m.set(provider, value);
  }
  return m;
}

async function resolvePresets(
  requested: string[],
  deps: AuditDeps,
): Promise<LoadedPreset[]> {
  // If deps.listPresets / deps.loadPreset injected, use them. Otherwise fall
  // back to built-in registry.
  if (requested.length === 0) {
    if (deps.listPresets) {
      const list = await deps.listPresets({ cwd: process.cwd() });
      return list;
    }
    return [HARDCODED_KEY_PRESET];
  }
  const out: LoadedPreset[] = [];
  for (const id of requested) {
    if (deps.loadPreset) {
      try {
        const p = await deps.loadPreset(id, { cwd: process.cwd() });
        out.push(p);
      } catch (e) {
        const err = new Error(`preset "${id}" not found`);
        (err as any).code = 'PRESET-MISSING';
        (err as any).requestedId = id;
        throw err;
      }
    } else {
      // Built-in only
      if (id === HARDCODED_KEY_PRESET.manifest.id) {
        out.push(HARDCODED_KEY_PRESET);
      } else {
        const err = new Error(`preset "${id}" not found`);
        (err as any).code = 'PRESET-MISSING';
        (err as any).requestedId = id;
        throw err;
      }
    }
  }
  return out;
}

function computeExitCode(
  findings: VerdictedFinding[],
  failOn: 'p1' | 'p2' | 'p3' | 'none',
): number {
  if (failOn === 'none') return 0;
  const threshold = severityRank(failOn);
  for (const f of findings) {
    if (f.verdict !== 'confirmed') continue;
    if (severityRank(f.severity.toLowerCase() as any) <= threshold) {
      return 2;
    }
  }
  return 0;
}

function severityRank(s: 'p1' | 'p2' | 'p3' | 'P1' | 'P2' | 'P3'): number {
  const lc = s.toLowerCase();
  if (lc === 'p1') return 1;
  if (lc === 'p2') return 2;
  if (lc === 'p3') return 3;
  return 99;
}
