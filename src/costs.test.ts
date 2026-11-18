import { describe, expect, it } from 'vitest';
import { estimateCost, lookupPrice, priceNote } from './costs.js';

describe('estimateCost', () => {
  it('computes mixed-token costs for known models', () => {
    const cost = estimateCost('gemini-2.5-flash', {
      promptTokens: 1_000_000,
      completionTokens: 1_000_000,
    });
    expect(cost).toBe(2.8);
  });

  it('handles small runs with rounding', () => {
    const cost = estimateCost('gpt-4o-mini', { promptTokens: 1_500, completionTokens: 500 });
    expect(cost).toBe(0.0005);
  });

  it('strips vendor prefixes for gateway-style model ids', () => {
    const cost = estimateCost('google/gemini-2.5-flash', {
      promptTokens: 0,
      completionTokens: 1_000_000,
    });
    expect(cost).toBe(2.5);
  });

  it('returns null for unknown models', () => {
    expect(
      estimateCost('mystery-model-9000', { promptTokens: 100, completionTokens: 100 }),
    ).toBeNull();
  });
});

describe('lookupPrice / priceNote', () => {
  it('finds a price entry and formats a note', () => {
    expect(lookupPrice('llama-3.3-70b-versatile')?.outputPerMillion).toBe(0.79);
    expect(priceNote('gpt-4o-mini')).toContain('per 1M tokens');
  });

  it('returns null for unknown models', () => {
    expect(lookupPrice('nope')).toBeNull();
    expect(priceNote('nope')).toBeNull();
  });
});
