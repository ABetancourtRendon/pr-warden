import type { Usage } from '../types.js';
import type { LLMProvider, LLMRequest, LLMResponse } from './provider.js';

export const MOCK_USAGE: Usage = { promptTokens: 1234, completionTokens: 56 };

export interface MockScenario {
  match: (request: LLMRequest) => boolean;
  response: LLMResponse;
}

/** Convenience: an LLMResponse that calls emit_findings with the given findings array. */
export function toolCallResponse(findings: unknown[]): LLMResponse {
  return {
    toolCall: { name: 'emit_findings', args: { findings } },
    content: null,
    usage: MOCK_USAGE,
  };
}

/** Convenience: an LLMResponse whose emit_findings arguments are deliberately malformed. */
export function invalidToolCallResponse(args: unknown): LLMResponse {
  return {
    toolCall: { name: 'emit_findings', args },
    content: null,
    usage: MOCK_USAGE,
  };
}

/**
 * Deterministic provider used by every test, by CI, and by the recorded-fixture
 * benchmark run. Returns the first scenario whose matcher accepts the request;
 * with no matching scenario it emits an empty findings list.
 */
export class MockProvider implements LLMProvider {
  readonly name = 'mock';
  readonly model = 'mock-reviewer-1';
  private calls = 0;

  constructor(private readonly scenarios: MockScenario[] = []) {}

  get callCount(): number {
    return this.calls;
  }

  async complete(request: LLMRequest): Promise<LLMResponse> {
    this.calls += 1;
    const scenario = this.scenarios.find((candidate) => candidate.match(request));
    return scenario ? scenario.response : toolCallResponse([]);
  }
}
