import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { GitHubApi, GitHubContent, GitHubPullsFile } from './github.js';
import { fetchPullRequest, postPullRequestReview } from './github.js';
import { buildReviewPayload } from './review/comment.js';
import type { Finding, ReviewResult } from './types.js';

interface RecordedFixture {
  pull: { title: string; body: string | null; head: { sha: string } };
  files: GitHubPullsFile[];
  contents: Record<string, string>;
}

const fixturePath = path.resolve('test/fixtures/github/pr-42.json');
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as RecordedFixture;

/** A fake GitHubApi that serves recorded fixture data and captures review submissions. */
class RecordingGitHubApi implements GitHubApi {
  public readonly capturedReviews: Array<{
    owner: string;
    repo: string;
    pull_number: number;
    body: string;
    event: string;
    comments: Array<{ path: string; line: number; side: string }>;
  }> = [];
  public failPosting = false;

  pulls = {
    get: async () => ({ data: fixture.pull }),
    listFiles: async () => ({ data: fixture.files }),
    createReview: async (params: {
      owner: string;
      repo: string;
      pull_number: number;
      body: string;
      event: 'COMMENT';
      comments: Array<{ path: string; line: number; side: 'RIGHT' }>;
    }) => {
      if (this.failPosting) {
        throw new Error('403 Resource not accessible by integration');
      }
      this.capturedReviews.push(params);
      return {
        data: {
          id: 867,
          html_url: 'https://github.com/octocat/example/pull/42#pullrequestreview-867',
        },
      };
    },
  };

  repos = {
    getContent: async (params: { path: string }): Promise<{ data: GitHubContent }> => {
      const content = fixture.contents[params.path];
      if (content === undefined) {
        return { data: { type: 'dir' } };
      }
      return {
        data: {
          type: 'file',
          encoding: 'base64',
          size: Buffer.byteLength(content, 'utf8'),
          content: Buffer.from(content, 'utf8').toString('base64'),
        },
      };
    },
  };
}

describe('fetchPullRequest (recorded fixtures)', () => {
  it('assembles the review input from the recorded API data', async () => {
    const api = new RecordingGitHubApi();
    const input = await fetchPullRequest(api, 'octocat', 'example', 42);
    expect(input.title).toBe('Add pagination utilities');
    expect(input.body).toContain('total() helper');
    expect(input.pr).toBe(42);
    expect(input.files.map((file) => file.path)).toEqual(['src/sum.js', 'src/app.js', 'logo.png']);

    const sum = input.files[0];
    expect(sum?.content).toContain('i <= nums.length');
    expect([...(sum?.commentableLines ?? new Set<number>())].sort((a, b) => a - b)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9,
    ]);

    const logo = input.files[2];
    expect(logo?.content).toBe('');
    expect(logo?.commentableLines.size).toBe(0);
  });
});

function finding(overrides: Partial<Finding>): Finding {
  return {
    id: 'x',
    file: 'src/sum.js',
    start_line: 5,
    end_line: 6,
    severity: 'major',
    category: 'bug',
    title: 'Loop reads past the end',
    detail: 'The loop condition includes the array length, reading nums[nums.length].',
    suggested_fix_diff:
      '--- a/src/sum.js\n+++ b/src/sum.js\n@@ -5,1 +5,1 @@\n-  for (let i = 0; i <= nums.length; i++) {\n+  for (let i = 0; i < nums.length; i++) {',
    confidence: 0.8,
    source: 'llm',
    ...overrides,
  };
}

function reviewResult(findings: Finding[]): ReviewResult {
  return {
    repo: 'octocat/example',
    pr: 42,
    title: 'Add pagination utilities',
    provider: 'gemini',
    model: 'gemini-2.5-flash',
    degraded: false,
    findings,
    usage: { promptTokens: 12_345, completionTokens: 678 },
    costUsd: 0.0051,
    stats: {
      filesAnalyzed: 2,
      filesSkipped: 1,
      staticFindings: 0,
      llmFindings: findings.length,
      invalidLlmFindingsDropped: 0,
      llmRetries: 0,
    },
    notes: [],
  };
}

/** The files as fetchPullRequest would assemble them (commentable lines come from the recorded patches). */
async function recordedFiles() {
  const api = new RecordingGitHubApi();
  const input = await fetchPullRequest(api, 'octocat', 'example', 42);
  return input.files;
}

describe('buildReviewPayload', () => {
  it('produces inline comments only for findings on diff lines and defers the rest', async () => {
    const files = await recordedFiles();
    const findings = [
      finding({
        id: 'llm-1',
        severity: 'critical',
        category: 'security',
        start_line: 5,
        end_line: 6,
      }),
      finding({
        id: 'llm-2',
        severity: 'minor',
        category: 'style',
        start_line: 7,
        end_line: 7,
        title: 'Style issue',
        file: 'src/sum.js',
      }),
      finding({
        id: 'llm-3',
        severity: 'major',
        category: 'bug',
        file: 'src/app.js',
        start_line: 2,
        end_line: 3,
        title: 'App bug',
        detail: 'The app references items.',
      }),
      finding({
        id: 'llm-4',
        severity: 'info',
        category: 'maintainability',
        start_line: 20,
        end_line: 20,
        title: 'Deep line',
        detail: 'Not part of the diff.',
      }),
    ];
    const payload = buildReviewPayload(reviewResult(findings), files, { maxInlineComments: 20 });
    expect(payload.inline.length).toBe(3);
    expect(payload.deferred).toBe(1);
    expect(payload.inline[0]).toMatchObject({ path: 'src/sum.js', line: 5 });
    expect(payload.inline[2]).toMatchObject({ path: 'src/app.js', line: 2 });
    expect(payload.summary).toContain('**4 findings**');
    expect(payload.summary).toContain('| 1 | critical | security |');
    expect(payload.summary).toContain('`src/sum.js#L5-L6`');
    expect(payload.summary).toContain('+1 summarized');
    expect(payload.inline[0]?.body).toContain('[CRITICAL / security]');
    expect(payload.inline[0]?.body).toContain('```diff');
  });

  it('renders a clean summary when there are no findings', async () => {
    const files = await recordedFiles();
    const payload = buildReviewPayload(reviewResult([]), files, { maxInlineComments: 20 });
    expect(payload.inline).toEqual([]);
    expect(payload.summary).toContain('**No findings**');
  });
});

describe('postPullRequestReview (recorded fixtures)', () => {
  it('posts one grouped review with a capped set of inline comments', async () => {
    const api = new RecordingGitHubApi();
    const files = await recordedFiles();
    const findings = [
      finding({ id: 'llm-1', severity: 'critical', category: 'security' }),
      finding({
        id: 'llm-2',
        severity: 'minor',
        category: 'style',
        start_line: 7,
        end_line: 7,
        title: 'Style issue',
      }),
      finding({
        id: 'llm-3',
        severity: 'major',
        category: 'bug',
        file: 'src/app.js',
        start_line: 2,
        end_line: 3,
        title: 'App bug',
        detail: 'The app references items.',
      }),
      finding({
        id: 'llm-4',
        severity: 'info',
        category: 'maintainability',
        start_line: 8,
        end_line: 8,
        title: 'Cap issue',
        detail: 'Beyond the inline cap.',
      }),
    ];
    const outcome = await postPullRequestReview(
      api,
      'octocat',
      'example',
      42,
      reviewResult(findings),
      files,
      {
        maxInlineComments: 2,
      },
    );
    expect(outcome.posted).toBe(true);
    expect(outcome.reviewUrl).toContain('pullrequestreview-867');
    expect(outcome.inlineComments).toBe(2);
    expect(outcome.deferredToSummary).toBe(2);

    expect(api.capturedReviews.length).toBe(1);
    const review = api.capturedReviews[0];
    expect(review?.event).toBe('COMMENT');
    expect(review?.pull_number).toBe(42);
    expect(review?.comments.length).toBe(2);
    expect(review?.comments[0]).toMatchObject({ path: 'src/sum.js', line: 5, side: 'RIGHT' });
    expect(review?.body).toContain('PR-Warden review');
    expect(review?.body).toContain('Generated by');
  });

  it('reports posting failures without throwing', async () => {
    const api = new RecordingGitHubApi();
    api.failPosting = true;
    const files = await recordedFiles();
    const outcome = await postPullRequestReview(
      api,
      'octocat',
      'example',
      42,
      reviewResult([]),
      files,
      {
        maxInlineComments: 20,
      },
    );
    expect(outcome.posted).toBe(false);
    expect(outcome.error).toContain('403');
  });
});
