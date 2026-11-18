// Public library surface for programmatic use.

export type { Manifest, ManifestBug } from './bench/manifest.js';
export {
  BenchManifestError,
  collectFixtureFiles,
  discoverFixtures,
  loadManifest,
  ManifestSchema,
} from './bench/manifest.js';
export type { Metrics, ScoreOptions } from './bench/score.js';
export {
  aggregateMetrics,
  categoryMetrics,
  DEFAULT_SCORE_OPTIONS,
  round4,
  scoreFixture,
} from './bench/score.js';
export type { ProviderConfig, ResolvedConfig, WardenFile, WardenOptions } from './config.js';
export {
  DEFAULT_PRESET,
  globToRegExp,
  loadDotEnv,
  loadWardenFile,
  matchesIgnorePath,
  mergeWardenOptions,
  PROVIDER_PRESETS,
  parseWardenFile,
  resolveConfig,
  WardenConfigError,
} from './config.js';
export { estimateCost, lookupPrice, priceNote } from './costs.js';
export { commentableLinesFromPatch, parseDiffFiles, syntheticChangedFile } from './diff.js';
export type { GitHubApi, GitHubContent, GitHubPullsFile, PostReviewResult } from './github.js';
export {
  buildReviewPayload,
  createGitHubApi,
  fetchPullRequest,
  postPullRequestReview,
} from './github.js';
export type { MockScenario } from './llm/mock.js';
export { invalidToolCallResponse, MOCK_USAGE, MockProvider, toolCallResponse } from './llm/mock.js';
export { OpenAICompatProvider } from './llm/openai-compat.js';
export { buildSystemPrompt, buildUserPrompt } from './llm/prompts.js';
export type { LLMProvider, LLMRequest, LLMResponse, LLMToolCall } from './llm/provider.js';
export type { InlineComment, ReviewPayload } from './review/comment.js';
export { compareFindings, mergeFindings } from './review/merge.js';
export { runReview } from './review/pipeline.js';
export { renderJson, renderTerminal } from './review/render.js';
export {
  countLines,
  EmitFindingsPayload,
  emitFindingsJsonSchema,
  LlmFindingSchema,
  normalizeLlmFindings,
  summarizeIssues,
} from './schemas.js';
export { parseBiomeReport } from './static/biome.js';
export { parseEslintReport } from './static/eslint.js';
export type { StaticAnalysisOptions, StaticAnalysisResult } from './static/index.js';
export { runStaticAnalysis } from './static/index.js';
export { parseRuffReport } from './static/ruff.js';
export { parseTscOutput } from './static/tsc.js';
export type {
  Category,
  ChangedFile,
  ChangedFileStatus,
  Finding,
  FindingSource,
  Logger,
  ReviewInput,
  ReviewResult,
  ReviewStats,
  Severity,
  Usage,
} from './types.js';
export { CATEGORIES, SEVERITIES, SEVERITY_RANK, severityAtLeast } from './types.js';
