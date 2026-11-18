import { describe, expect, it } from 'vitest';
import type { WardenOptions } from '../config.js';
import { DEFAULT_WARDEN_OPTIONS } from '../config.js';
import { syntheticChangedFile } from '../diff.js';
import { invalidToolCallResponse, MockProvider, toolCallResponse } from '../llm/mock.js';
import type { LLMProvider, LLMRequest, LLMResponse } from '../llm/provider.js';
import type { ReviewInput } from '../types.js';
import { runReview } from './pipeline.js';

const FILE_CONTENT = [
  'export function check(value) {',
  '  if (value == 10) {',
  '    return true;',
  '  }',
  '}',
  '',
].join('\n');

function makeInput(): ReviewInput {
  return {
    repo: 'octocat/example',
    pr: 7,
    title: 'Test PR',
    body: 'body text',
    files: [
      syntheticChangedFile('src/app.js', FILE_CONTENT),
      syntheticChangedFile('src/util.ts', 'export const id = (x: number) => x;\n'),
    ],
  };
}

function llmFinding(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    file: 'src/app.js',
    start_line: 2,
    end_line: 2,
    severity: 'major',
    category: 'bug',
    title: 'Loose equality accepts wrong types',
    detail: 'The value is compared with == against a number.',
    confidence: 0.8,
    ...overrides,
  };
}

describe('runReview', () => {
  it('merges LLM findings with static findings and reports usage', async () => {
    const provider = new MockProvider([
      { match: () => true, response: toolCallResponse([llmFinding()]) },
    ]);
    const result = await runReview(makeInput(), DEFAULT_WARDEN_OPTIONS, {
      provider,
      disableStatic: true,
    });
    expect(result.degraded).toBe(false);
    expect(result.findings.length).toBe(1);
    expect(result.findings[0]?.source).toBe('llm');
    expect(result.usage).toEqual({ promptTokens: 1234, completionTokens: 56 });
    expect(result.stats.llmFindings).toBe(1);
    expect(result.provider).toBe('mock');
  });

  it('marks cross-source corroboration when both passes flag the same lines', async () => {
    const provider = new MockProvider([
      {
        match: () => true,
        // Line 2 is also where biome flags noDoubleEquals.
        response: toolCallResponse([llmFinding()]),
      },
    ]);
    const result = await runReview(makeInput(), DEFAULT_WARDEN_OPTIONS, { provider });
    expect(result.findings.length).toBe(1);
    expect(result.findings[0]?.source).toBe('both');
    expect(result.findings[0]?.confidence).toBeGreaterThan(0.8);
    expect(result.stats.staticFindings).toBeGreaterThan(0);
  });

  it('retries once after a schema violation and sums usage', async () => {
    const provider = new MockProvider([
      {
        match: (request: LLMRequest) => !request.retryHint,
        response: invalidToolCallResponse({ findings: [{}] }),
      },
      {
        match: (request: LLMRequest) => Boolean(request.retryHint),
        response: toolCallResponse([llmFinding()]),
      },
    ]);
    const result = await runReview(makeInput(), DEFAULT_WARDEN_OPTIONS, {
      provider,
      disableStatic: true,
    });
    expect(result.degraded).toBe(false);
    expect(result.stats.llmRetries).toBe(1);
    expect(result.findings.length).toBe(1);
    expect(result.usage?.promptTokens).toBe(1234 * 2);
    expect(provider.callCount).toBe(2);
  });

  it('degrades to static-only findings after a failed retry', async () => {
    const provider = new MockProvider([
      { match: () => true, response: invalidToolCallResponse({ findings: [{}] }) },
    ]);
    const result = await runReview(makeInput(), DEFAULT_WARDEN_OPTIONS, { provider });
    expect(result.degraded).toBe(true);
    expect(result.stats.llmFindings).toBe(0);
    expect(result.stats.staticFindings).toBeGreaterThan(0);
    expect(result.findings.every((finding) => finding.source !== 'llm')).toBe(true);
    expect(result.notes.some((note) => note.includes('static findings only'))).toBe(true);
    expect(provider.callCount).toBe(2);
  });

  it('degrades when the provider throws a transport error', async () => {
    const failing: LLMProvider = {
      name: 'failing',
      model: 'broken',
      async complete(): Promise<LLMResponse> {
        throw new Error('401 Unauthorized');
      },
    };
    const result = await runReview(makeInput(), DEFAULT_WARDEN_OPTIONS, {
      provider: failing,
      disableStatic: true,
    });
    expect(result.degraded).toBe(true);
    expect(result.findings.length).toBe(0);
    expect(result.notes.some((note) => note.includes('401'))).toBe(true);
  });

  it('runs static-only without degradation when no provider is configured', async () => {
    const result = await runReview(makeInput(), DEFAULT_WARDEN_OPTIONS, { provider: null });
    expect(result.degraded).toBe(false);
    expect(result.provider).toBe('none');
    expect(result.usage).toBeNull();
    expect(result.costUsd).toBeNull();
    expect(result.stats.staticFindings).toBeGreaterThan(0);
    expect(result.notes.some((note) => note.includes('not configured'))).toBe(true);
  });

  it('drops LLM findings for files outside the review', async () => {
    const provider = new MockProvider([
      {
        match: () => true,
        response: toolCallResponse([llmFinding({ file: 'src/not-reviewed.js' })]),
      },
    ]);
    const result = await runReview(makeInput(), DEFAULT_WARDEN_OPTIONS, {
      provider,
      disableStatic: true,
    });
    expect(result.findings.length).toBe(0);
    expect(result.stats.invalidLlmFindingsDropped).toBe(1);
  });

  it('applies severity, category, and ignore-path filters', async () => {
    const provider = new MockProvider([
      {
        match: () => true,
        response: toolCallResponse([
          llmFinding({
            start_line: 2,
            end_line: 2,
            severity: 'minor',
            category: 'style',
            title: 'Minor style thing',
            detail: 'style detail here',
          }),
          llmFinding({
            file: 'src/util.ts',
            start_line: 1,
            end_line: 1,
            severity: 'critical',
            category: 'security',
            title: 'Big problem found',
            detail: 'security detail here',
          }),
        ]),
      },
    ]);
    const config: WardenOptions = {
      ...DEFAULT_WARDEN_OPTIONS,
      minSeverity: 'major',
      categories: ['bug', 'security', 'performance'],
      ignorePaths: ['src/util.ts'],
    };
    const result = await runReview(makeInput(), config, { provider, disableStatic: true });
    expect(result.findings.map((finding) => finding.title)).toEqual([]);
  });

  it('runs the real static pass end to end when static is enabled', async () => {
    const result = await runReview(makeInput(), DEFAULT_WARDEN_OPTIONS, { provider: null });
    const doubleEquals = result.findings.find((finding) => finding.rule === 'biome:noDoubleEquals');
    expect(doubleEquals).toBeDefined();
    expect(doubleEquals?.file).toBe('src/app.js');
    expect(doubleEquals?.start_line).toBe(2);
  });
});
