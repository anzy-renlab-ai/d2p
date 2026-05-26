/**
 * Log types — local copy of the log module so cli is self-contained.
 *
 * Source of truth: `daemon/src/log/track-logger.ts`. Lead will switch this
 * to a real cross-package import (e.g. `@zerou/log`) during integration.
 *
 * NOTE: This file is the canonical "log surface" import for cli code.
 */
export type {
  LogLevel,
  LogEntry,
  TrackLogger,
  CreateTrackLoggerOptions,
} from './log/track-logger.js';
export {
  createTrackLogger,
  LogError,
  __resetMetaLoggersForTests,
  __resetLiveLoggersForTests,
  __resetRotationGateForTests,
} from './log/track-logger.js';
export { captureLogsFor } from './log/test-helpers.js';
