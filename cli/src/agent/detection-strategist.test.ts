/**
 * Tests for agent/detection-strategist.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { chooseStrategy } from './detection-strategist.js';
import { createTrackLogger, captureLogsFor } from '../log-types.js';
import {
  __resetMetaLoggersForTests,
  __resetLiveLoggersForTests,
  __resetRotationGateForTests,
} from '../log-types.js';
import { HARDCODED_KEY_PRESET } from '../stubs.js';
import type { ChecklistItem, ProjectProfile } from './types.js';

beforeEach(() => {
  __resetMetaLoggersForTests();
  __resetLiveLoggersForTests();
  __resetRotationGateForTests();
});
afterEach(() => {
  __resetMetaLoggersForTests();
  __resetLiveLoggersForTests();
  __resetRotationGateForTests();
});

const profile: ProjectProfile = {
  framework: 'unknown',
  backend: null,
  language: [],
  hasGit: false,
  hasTests: false,
  hasEnvFile: false,
  packageMgr: null,
  evidence: {},
};

describe('detection-strategist.chooseStrategy', () => {
  it('returns use-preset when item has presetIds matching available presets', async () => {
    const logger = createTrackLogger('agent', { silent: true });
    const item: ChecklistItem = {
      category: 'secrets',
      priority: 'high',
      reasoning: 'test',
      presetIds: ['no-hardcoded-llm-keys'],
    };
    const out = await captureLogsFor(
      { track: 'agent', eventPattern: /^agent\.strategy\./ },
      async () => {
        return chooseStrategy({
          item,
          profile,
          availablePresets: [HARDCODED_KEY_PRESET],
          logger,
          criticConfig: null,
          criticApiKey: null,
        });
      },
    );
    expect(out.result.approach).toBe('use-preset');
    expect(out.result.presetIds).toEqual(['no-hardcoded-llm-keys']);
    // verify the event sequence
    const events = out.entries.map((e) => e.event);
    expect(events).toContain('agent.strategy.start');
    expect(events).toContain('agent.strategy.preset-matched');
    expect(events).toContain('agent.strategy.complete');
  });

  it('returns skip-no-preset when item.presetIds is empty', async () => {
    const logger = createTrackLogger('agent', { silent: true });
    const item: ChecklistItem = {
      category: 'observability',
      priority: 'medium',
      reasoning: 'no preset coverage in v1',
      presetIds: [],
    };
    const cap = await captureLogsFor(
      { track: 'agent', eventPattern: /^agent\.strategy\./ },
      async () =>
        chooseStrategy({
          item,
          profile,
          availablePresets: [HARDCODED_KEY_PRESET],
          logger,
          criticConfig: null,
          criticApiKey: null,
        }),
    );
    expect(cap.result.approach).toBe('skip-no-preset');
    expect(cap.result.presetIds).toEqual([]);
    const events = cap.entries.map((e) => e.event);
    expect(events).toContain('agent.strategy.skip-no-preset');
    expect(events).toContain('agent.strategy.complete');
  });

  it('returns skip-no-preset when requested preset not in availablePresets', async () => {
    const logger = createTrackLogger('agent', { silent: true });
    const item: ChecklistItem = {
      category: 'db',
      priority: 'medium',
      reasoning: 'wants supabase preset',
      presetIds: ['nonexistent-preset'],
    };
    const out = await chooseStrategy({
      item,
      profile,
      availablePresets: [HARDCODED_KEY_PRESET],
      logger,
      criticConfig: null,
      criticApiKey: null,
    });
    expect(out.approach).toBe('skip-no-preset');
  });
});
