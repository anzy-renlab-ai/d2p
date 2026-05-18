import { describe, it, expect } from 'vitest';
import { checkBudget, applyVerdict } from './cap.js';

const budget = { softUsd: 5, hardUsd: 10, onSoftBreach: 'downgrade' as const };

describe('checkBudget', () => {
  it('proceeds when no budget is configured', () => {
    expect(checkBudget({ budget: null, spentUsd: 999, requestedModel: 'sonnet' })).toEqual({
      action: 'proceed',
    });
  });

  it('proceeds when spend is below soft cap', () => {
    expect(checkBudget({ budget, spentUsd: 2, requestedModel: 'sonnet' })).toEqual({
      action: 'proceed',
    });
  });

  it('downgrades sonnet → haiku at soft breach', () => {
    const v = checkBudget({ budget, spentUsd: 6, requestedModel: 'sonnet' });
    expect(v).toEqual({
      action: 'downgrade',
      from: 'sonnet',
      to: 'haiku',
      reason: 'soft-breach',
    });
  });

  it('downgrades opus → sonnet at soft breach', () => {
    const v = checkBudget({ budget, spentUsd: 6, requestedModel: 'opus' });
    expect(v.action).toBe('downgrade');
    if (v.action === 'downgrade') expect(v.to).toBe('sonnet');
  });

  it('proceeds at soft breach when already at haiku (no further downgrade)', () => {
    expect(checkBudget({ budget, spentUsd: 6, requestedModel: 'haiku' })).toEqual({
      action: 'proceed',
    });
  });

  it('emits pause action when onSoftBreach=pause', () => {
    const b2 = { ...budget, onSoftBreach: 'pause' as const };
    expect(checkBudget({ budget: b2, spentUsd: 6, requestedModel: 'sonnet' })).toEqual({
      action: 'pause',
      reason: 'soft-breach-pause',
    });
  });

  it('aborts at hard breach', () => {
    expect(checkBudget({ budget, spentUsd: 15, requestedModel: 'haiku' })).toEqual({
      action: 'abort',
      reason: 'hard-breach',
    });
  });
});

describe('applyVerdict', () => {
  it('returns requested model on proceed', () => {
    expect(applyVerdict({ action: 'proceed' }, 'sonnet')).toBe('sonnet');
  });
  it('returns downgraded model', () => {
    expect(
      applyVerdict({ action: 'downgrade', from: 'sonnet', to: 'haiku', reason: 'soft-breach' }, 'sonnet'),
    ).toBe('haiku');
  });
  it('returns null on pause / abort', () => {
    expect(applyVerdict({ action: 'pause', reason: 'soft-breach-pause' }, 'sonnet')).toBeNull();
    expect(applyVerdict({ action: 'abort', reason: 'hard-breach' }, 'sonnet')).toBeNull();
  });
});
