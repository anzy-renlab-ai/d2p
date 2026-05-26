// Fixture: tests target.ts for coverage measurement.
// Excluded from main vitest run via cli/vitest.config.ts (__fixtures__ glob).
import { test, expect } from 'vitest';
import { add, classify } from '../src/target.js';

test('add covers happy path', () => {
  expect(add(1, 2)).toBe(3);
});

test('classify positive branch only', () => {
  expect(classify(5)).toBe('positive');
});
