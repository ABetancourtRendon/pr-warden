import type { Usage } from './types.js';

export interface ModelPrice {
  inputPerMillion: number;
  outputPerMillion: number;
}

/**
 * Approximate list prices in USD per 1M tokens at the time of writing.
 * These are estimates for transparency, not billing data; verify current pricing
 * with the provider before relying on the numbers.
 */
const PRICE_TABLE: Array<{ match: RegExp; price: ModelPrice }> = [
  { match: /^gpt-4o-mini/, price: { inputPerMillion: 0.15, outputPerMillion: 0.6 } },
  { match: /^gpt-4o/, price: { inputPerMillion: 2.5, outputPerMillion: 10 } },
  { match: /^gpt-4\.1-mini/, price: { inputPerMillion: 0.4, outputPerMillion: 1.6 } },
  { match: /^gpt-4\.1/, price: { inputPerMillion: 2.5, outputPerMillion: 10 } },
  { match: /^gemini-2\.5-flash/, price: { inputPerMillion: 0.3, outputPerMillion: 2.5 } },
  { match: /^gemini-2\.5-pro/, price: { inputPerMillion: 1.25, outputPerMillion: 10 } },
  { match: /^gemini-2\.0-flash/, price: { inputPerMillion: 0.1, outputPerMillion: 0.4 } },
  { match: /^gemini-1\.5-flash/, price: { inputPerMillion: 0.075, outputPerMillion: 0.3 } },
  { match: /^claude-sonnet-4/, price: { inputPerMillion: 3, outputPerMillion: 15 } },
  { match: /^claude-(3-5-)?haiku/, price: { inputPerMillion: 0.8, outputPerMillion: 4 } },
  { match: /^llama-3\.3-70b-versatile/, price: { inputPerMillion: 0.59, outputPerMillion: 0.79 } },
];

function bareModel(model: string): string {
  return model.includes('/') ? (model.split('/').pop() ?? model) : model;
}

export function lookupPrice(model: string): ModelPrice | null {
  const bare = bareModel(model).toLowerCase();
  const entry = PRICE_TABLE.find((candidate) => candidate.match.test(bare));
  return entry ? entry.price : null;
}

/** Estimated cost in USD for a run, or null when the model has no price entry. */
export function estimateCost(model: string, usage: Usage): number | null {
  const price = lookupPrice(model);
  if (!price) {
    return null;
  }
  const cost =
    (usage.promptTokens / 1_000_000) * price.inputPerMillion +
    (usage.completionTokens / 1_000_000) * price.outputPerMillion;
  return Math.round(cost * 10_000) / 10_000;
}

export function priceNote(model: string): string | null {
  const price = lookupPrice(model);
  if (!price) {
    return null;
  }
  return `${model} at ~$${price.inputPerMillion}/$${price.outputPerMillion} per 1M tokens (estimate)`;
}
