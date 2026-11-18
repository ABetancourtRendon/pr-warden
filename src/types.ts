export const SEVERITIES = ['critical', 'major', 'minor', 'info'] as const;
export type Severity = (typeof SEVERITIES)[number];

export const CATEGORIES = ['bug', 'security', 'performance', 'maintainability', 'style'] as const;
export type Category = (typeof CATEGORIES)[number];

export const SEVERITY_RANK: Record<Severity, number> = {
  critical: 3,
  major: 2,
  minor: 1,
  info: 0,
};

export function severityAtLeast(actual: Severity, threshold: Severity): boolean {
  return SEVERITY_RANK[actual] >= SEVERITY_RANK[threshold];
}

export type FindingSource = 'static' | 'llm' | 'both';

export interface Finding {
  id: string;
  file: string;
  start_line: number;
  end_line: number;
  severity: Severity;
  category: Category;
  title: string;
  detail: string;
  suggested_fix_diff?: string;
  confidence: number;
  source: FindingSource;
  rule?: string;
}

export type ChangedFileStatus =
  | 'added'
  | 'modified'
  | 'removed'
  | 'renamed'
  | 'changed'
  | 'unchanged';

export interface ChangedFile {
  path: string;
  status: ChangedFileStatus;
  /** Full content of the new version of the file. Empty string when unavailable (binary or unfetchable). */
  content: string;
  /** Raw unified diff hunks for this file, when known. */
  patch?: string;
  additions: number;
  deletions: number;
  /** New-file line numbers that appear in the diff (added or context lines) and can receive inline comments. */
  commentableLines: Set<number>;
}

export interface Usage {
  promptTokens: number;
  completionTokens: number;
}

export interface ReviewStats {
  filesAnalyzed: number;
  filesSkipped: number;
  staticFindings: number;
  llmFindings: number;
  invalidLlmFindingsDropped: number;
  llmRetries: number;
}

export interface ReviewResult {
  repo: string;
  pr: number | null;
  title: string;
  provider: string;
  model: string;
  /** True when the LLM pass was attempted but failed and only static findings remain. */
  degraded: boolean;
  findings: Finding[];
  usage: Usage | null;
  costUsd: number | null;
  stats: ReviewStats;
  notes: string[];
}

export interface ReviewInput {
  repo: string;
  pr: number | null;
  title: string;
  body: string;
  files: ChangedFile[];
}

export type Logger = (message: string) => void;
