import type { WardenOptions } from '../config.js';
import { matchesIgnorePath } from '../config.js';
import { estimateCost } from '../costs.js';
import { buildSystemPrompt, buildUserPrompt } from '../llm/prompts.js';
import type { LLMProvider, LLMRequest, LLMResponse } from '../llm/provider.js';
import {
  EmitFindingsPayload,
  emitFindingsJsonSchema,
  normalizeLlmFindings,
  summarizeIssues,
} from '../schemas.js';
import { runStaticAnalysis } from '../static/index.js';
import type { Finding, Logger, ReviewInput, ReviewResult, ReviewStats, Usage } from '../types.js';
import { SEVERITY_RANK } from '../types.js';
import { mergeFindings } from './merge.js';

const TOOL_NAME = 'emit_findings';
const TOOL_DESCRIPTION =
  'Emit the code-review findings for the changed files. Call this tool exactly once with all findings (or an empty list when the change is clean).';

export interface ReviewDeps {
  /** Null runs the review static-only (not degraded - the LLM was not configured). */
  provider: LLMProvider | null;
  log?: Logger;
  disableStatic?: boolean;
}

interface LlmAttemptOutcome {
  findings: Finding[];
  dropped: number;
  retries: number;
  degraded: boolean;
  usage: Usage | null;
  note: string | null;
}

export async function runReview(
  input: ReviewInput,
  config: WardenOptions,
  deps: ReviewDeps,
): Promise<ReviewResult> {
  const log = deps.log ?? (() => {});
  log(`PR-Warden: reviewing ${input.files.length} changed file(s) from ${input.repo}`);

  const notes: string[] = [];
  let staticFindings: Finding[] = [];
  let filesAnalyzed = 0;
  let filesSkipped = 0;

  if (deps.disableStatic) {
    notes.push('static pass disabled by CLI flag');
    filesAnalyzed = input.files.filter((file) => file.content !== '').length;
  } else {
    const staticResult = await runStaticAnalysis(input.files, {
      ignorePaths: config.ignorePaths,
      log,
    });
    staticFindings = staticResult.findings;
    notes.push(...staticResult.notes);
    filesAnalyzed = staticResult.filesAnalyzed;
    filesSkipped = staticResult.filesSkipped;
    log(`PR-Warden: static pass produced ${staticFindings.length} finding(s)`);
  }

  let llmFindings: Finding[] = [];
  let llmDropped = 0;
  let llmRetries = 0;
  let degraded = false;
  let usage: Usage | null = null;
  if (!deps.provider) {
    notes.push('LLM pass not configured - static findings only');
  } else {
    const outcome = await runLlmPass(input, config, deps.provider, log);
    llmFindings = outcome.findings;
    llmDropped = outcome.dropped;
    llmRetries = outcome.retries;
    degraded = outcome.degraded;
    usage = outcome.usage;
    if (outcome.note) {
      notes.push(outcome.note);
    }
    log(
      `PR-Warden: LLM pass produced ${llmFindings.length} finding(s)${outcome.retries > 0 ? ` (${outcome.retries} retry)` : ''}`,
    );
  }

  const merged = mergeFindings(staticFindings, llmFindings);
  const filtered = merged.findings
    .filter((finding) => config.categories.includes(finding.category))
    .filter((finding) => SEVERITY_RANK[finding.severity] >= SEVERITY_RANK[config.minSeverity])
    .filter((finding) => !matchesIgnorePath(finding.file, config.ignorePaths));

  const stats: ReviewStats = {
    filesAnalyzed,
    filesSkipped,
    staticFindings: staticFindings.length,
    llmFindings: llmFindings.length,
    invalidLlmFindingsDropped: llmDropped,
    llmRetries,
  };

  const provider = deps.provider;
  return {
    repo: input.repo,
    pr: input.pr,
    title: input.title,
    provider: provider ? provider.name : 'none',
    model: provider ? provider.model : 'none',
    degraded,
    findings: filtered,
    usage,
    costUsd: usage && provider ? estimateCost(provider.model, usage) : null,
    stats,
    notes,
  };
}

async function runLlmPass(
  input: ReviewInput,
  config: WardenOptions,
  provider: LLMProvider,
  log: Logger,
): Promise<LlmAttemptOutcome> {
  const system = buildSystemPrompt(config.customRules);
  const user = buildUserPrompt(input);
  const baseRequest: LLMRequest = {
    system,
    user,
    toolName: TOOL_NAME,
    toolDescription: TOOL_DESCRIPTION,
    toolParameters: emitFindingsJsonSchema,
    temperature: 0.1,
  };

  let usage: Usage | null = null;
  try {
    const first = await provider.complete(baseRequest);
    usage = combineUsage(usage, first.usage);
    const firstOutcome = parseAttempt(first, input.files);
    if (firstOutcome.ok) {
      return { ...firstOutcome, retries: 0, degraded: false, usage, note: null };
    }

    log(`PR-Warden: LLM schema violation (${firstOutcome.reason}); retrying once`);
    const second = await provider.complete({
      ...baseRequest,
      retryHint: firstOutcome.reason,
    });
    usage = combineUsage(usage, second.usage);
    const secondOutcome = parseAttempt(second, input.files);
    if (secondOutcome.ok) {
      return { ...secondOutcome, retries: 1, degraded: false, usage, note: null };
    }

    log('PR-Warden: LLM output still invalid after one retry - degrading to static findings only');
    return {
      findings: [],
      dropped: 0,
      retries: 1,
      degraded: true,
      usage,
      note: `LLM pass failed after one retry (${secondOutcome.reason}); static findings only`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log(`PR-Warden: LLM provider error - ${message}`);
    return {
      findings: [],
      dropped: 0,
      retries: 0,
      degraded: true,
      usage,
      note: `LLM provider error (${message.slice(0, 300)}); static findings only`,
    };
  }
}

interface AttemptParse {
  ok: boolean;
  findings: Finding[];
  dropped: number;
  reason: string;
}

function parseAttempt(response: LLMResponse, files: ReviewInput['files']): AttemptParse {
  if (
    !response.toolCall ||
    response.toolCall.name !== TOOL_NAME ||
    response.toolCall.args === null
  ) {
    return {
      ok: false,
      findings: [],
      dropped: 0,
      reason: 'no emit_findings tool call in the response',
    };
  }
  const parsed = EmitFindingsPayload.safeParse(response.toolCall.args);
  if (!parsed.success) {
    return {
      ok: false,
      findings: [],
      dropped: 0,
      reason: `schema violation: ${summarizeIssues(parsed.error)}`,
    };
  }
  const normalized = normalizeLlmFindings(parsed.data, files);
  return { ok: true, findings: normalized.findings, dropped: normalized.dropped, reason: '' };
}

function combineUsage(current: Usage | null, addition: Usage | null): Usage | null {
  if (!current && !addition) {
    return null;
  }
  return {
    promptTokens: (current?.promptTokens ?? 0) + (addition?.promptTokens ?? 0),
    completionTokens: (current?.completionTokens ?? 0) + (addition?.completionTokens ?? 0),
  };
}
