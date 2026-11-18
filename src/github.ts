import { Octokit } from '@octokit/rest';
import { matchesIgnorePath } from './config.js';
import { commentableLinesFromPatch } from './diff.js';
import type { InlineComment, ReviewPayload } from './review/comment.js';
import { buildReviewPayload } from './review/comment.js';
import type { ChangedFile, ChangedFileStatus, Logger, ReviewInput, ReviewResult } from './types.js';

/** Minimal structural interface over the pieces of @octokit/rest we use; tests inject fakes that satisfy it. */
export interface GitHubApi {
  pulls: {
    get(params: {
      owner: string;
      repo: string;
      pull_number: number;
    }): Promise<{ data: { title: string; body: string | null; head: { sha: string } } }>;
    listFiles(params: {
      owner: string;
      repo: string;
      pull_number: number;
      per_page: number;
      page: number;
    }): Promise<{ data: GitHubPullsFile[] }>;
    createReview(params: {
      owner: string;
      repo: string;
      pull_number: number;
      body: string;
      event: 'COMMENT';
      comments: Array<{ path: string; line: number; side: 'RIGHT' }>;
    }): Promise<{ data: { id: number; html_url: string } }>;
  };
  repos: {
    getContent(params: {
      owner: string;
      repo: string;
      path: string;
      ref: string;
    }): Promise<{ data: GitHubContent }>;
  };
}

export interface GitHubPullsFile {
  filename: string;
  status?: string;
  additions?: number;
  deletions?: number;
  patch?: string;
}

export interface GitHubContent {
  type: string;
  content?: string;
  encoding?: string;
  size?: number;
}

export function createGitHubApi(token?: string): GitHubApi {
  const octokit = new Octokit({
    auth: token && token !== '' ? token : undefined,
    userAgent: 'pr-warden',
  });
  // Cast justification: the Octokit instance structurally satisfies GitHubApi (methods are
  // bivariant, response types are supersets), but the generated types are too rich to
  // prove it to the compiler without a widening cast.
  return octokit as unknown as GitHubApi;
}

const TEXT_EXTENSIONS = new Set([
  '.js',
  '.mjs',
  '.cjs',
  '.jsx',
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
  '.py',
  '.go',
  '.java',
  '.rs',
  '.c',
  '.h',
  '.cpp',
  '.hpp',
  '.cs',
  '.rb',
  '.php',
  '.swift',
  '.kt',
  '.scala',
  '.sh',
  '.sql',
  '.json',
  '.yml',
  '.yaml',
  '.toml',
  '.md',
  '.txt',
  '.css',
  '.scss',
  '.html',
  '.xml',
  '.proto',
]);

const MAX_FILES = 300;
const MAX_FILE_BYTES = 1_000_000;
const MAX_CONTENT_CHARS = 120_000;

/**
 * Fetch a pull request's metadata, changed-file list, diff hunks, and (for text
 * files) full new-file content, assembling a ReviewInput for the pipeline.
 */
export async function fetchPullRequest(
  api: GitHubApi,
  owner: string,
  repo: string,
  pr: number,
  options: { ignorePaths?: string[]; log?: Logger } = {},
): Promise<ReviewInput> {
  const log = options.log ?? (() => {});
  const pull = await api.pulls.get({ owner, repo, pull_number: pr });

  const files: GitHubPullsFile[] = [];
  const perPage = 100;
  for (let page = 1; page <= 30; page += 1) {
    const batch = await api.pulls.listFiles({
      owner,
      repo,
      pull_number: pr,
      per_page: perPage,
      page,
    });
    files.push(...batch.data);
    if (batch.data.length < perPage || files.length >= MAX_FILES) {
      break;
    }
  }
  log(`PR-Warden: fetched ${files.length} changed file(s) from ${owner}/${repo}#${pr}`);

  const changedFiles: ChangedFile[] = [];
  for (const file of files.slice(0, MAX_FILES)) {
    const path = file.filename;
    const status = toStatus(file.status ?? 'modified');
    const commentableLines = file.patch
      ? commentableLinesFromPatch(patchWithHeader(path, file.patch))
      : new Set<number>();
    let content = '';
    if (
      status !== 'removed' &&
      !matchesIgnorePath(path, options.ignorePaths ?? []) &&
      hasTextExtension(path)
    ) {
      content = await fetchContent(api, owner, repo, path, pull.data.head.sha, log);
    }
    changedFiles.push({
      path,
      status,
      content,
      patch: file.patch,
      additions: file.additions ?? 0,
      deletions: file.deletions ?? 0,
      commentableLines,
    });
  }

  return {
    repo: `${owner}/${repo}`,
    pr,
    title: pull.data.title,
    body: pull.data.body ?? '',
    files: changedFiles,
  };
}

async function fetchContent(
  api: GitHubApi,
  owner: string,
  repo: string,
  path: string,
  ref: string,
  log: Logger,
): Promise<string> {
  try {
    const response = await api.repos.getContent({ owner, repo, path, ref });
    const data = response.data;
    if (data.type !== 'file' || data.encoding !== 'base64' || typeof data.content !== 'string') {
      return '';
    }
    if ((data.size ?? 0) > MAX_FILE_BYTES) {
      log(`PR-Warden: skipping ${path} (${data.size ?? 0} bytes exceeds cap)`);
      return '';
    }
    return Buffer.from(data.content, 'base64').toString('utf8').slice(0, MAX_CONTENT_CHARS);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log(`PR-Warden: could not fetch content of ${path}: ${message}`);
    return '';
  }
}

function toStatus(status: string): ChangedFileStatus {
  if (
    status === 'added' ||
    status === 'removed' ||
    status === 'renamed' ||
    status === 'changed' ||
    status === 'unchanged'
  ) {
    return status;
  }
  return 'modified';
}

function hasTextExtension(path: string): boolean {
  const dot = path.lastIndexOf('.');
  return dot !== -1 && TEXT_EXTENSIONS.has(path.slice(dot).toLowerCase());
}

function patchWithHeader(path: string, patch: string): string {
  return `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n${patch}`;
}

export interface PostReviewResult {
  posted: boolean;
  reviewUrl: string | null;
  inlineComments: number;
  deferredToSummary: number;
  error: string | null;
}

/**
 * Post one grouped review to the PR: a summary comment (severity table plus
 * details) and inline line comments via a single GitHub review API call.
 * Findings whose lines are outside the diff, or beyond the inline cap, appear
 * in the summary only.
 */
export async function postPullRequestReview(
  api: GitHubApi,
  owner: string,
  repo: string,
  pr: number,
  result: ReviewResult,
  files: ChangedFile[],
  options: { maxInlineComments?: number; log?: Logger } = {},
): Promise<PostReviewResult> {
  const log = options.log ?? (() => {});
  const maxInlineComments = options.maxInlineComments ?? 20;
  const payload: ReviewPayload = buildReviewPayload(result, files, { maxInlineComments });
  const inline: InlineComment[] = payload.inline.slice(0, maxInlineComments);
  const deferred = payload.deferred + Math.max(0, payload.inline.length - inline.length);
  try {
    const response = await api.pulls.createReview({
      owner,
      repo,
      pull_number: pr,
      body: payload.summary,
      event: 'COMMENT',
      comments: inline.map((comment) => ({
        path: comment.path,
        line: comment.line,
        side: 'RIGHT',
      })),
    });
    log(`PR-Warden: posted review ${response.data.html_url} (${inline.length} inline comments)`);
    return {
      posted: true,
      reviewUrl: response.data.html_url,
      inlineComments: inline.length,
      deferredToSummary: deferred,
      error: null,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log(`PR-Warden: could not post review - ${message}`);
    return {
      posted: false,
      reviewUrl: null,
      inlineComments: 0,
      deferredToSummary: deferred,
      error: message,
    };
  }
}

export { buildReviewPayload };
