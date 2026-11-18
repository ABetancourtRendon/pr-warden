import { describe, expect, it } from 'vitest';
import type { ReviewCommandFlags } from './cli.js';
import { runReviewCommand } from './cli.js';
import type { GitHubApi, GitHubContent, GitHubPullsFile } from './github.js';
import { MockProvider, toolCallResponse } from './llm/mock.js';

function fakeApi(): GitHubApi & { capturedReviews: unknown[] } {
  const files: GitHubPullsFile[] = [
    {
      filename: 'src/app.js',
      status: 'modified',
      additions: 2,
      deletions: 1,
      patch: ['@@ -1,3 +1,4 @@', ' line1', '+added line', ' line3'].join('\n'),
    },
  ];
  const capturedReviews: unknown[] = [];
  const api: GitHubApi = {
    pulls: {
      get: async () => ({
        data: { title: 'Add feature', body: 'PR body', head: { sha: 'deadbeef' } },
      }),
      listFiles: async () => ({ data: files }),
      createReview: async () => {
        capturedReviews.push('called');
        return {
          data: {
            id: 1,
            html_url: 'https://github.com/octocat/example/pull/7#pullrequestreview-1',
          },
        };
      },
    },
    repos: {
      getContent: async (): Promise<{ data: GitHubContent }> => ({
        data: {
          type: 'file',
          encoding: 'base64',
          size: 20,
          content: Buffer.from('export const x = 1;\n').toString('base64'),
        },
      }),
    },
  };
  return Object.assign(api, { capturedReviews });
}

const flags = (overrides: Partial<ReviewCommandFlags> = {}): ReviewCommandFlags => ({
  repo: 'octocat/example',
  pr: 7,
  json: false,
  noStatic: true,
  noLlm: false,
  post: false,
  color: false,
  verbose: false,
  provider: 'mock',
  ...overrides,
});

describe('runReviewCommand', () => {
  it('runs an offline end-to-end review with the mock provider and JSON output', async () => {
    const output: string[] = [];
    const exitCode = await runReviewCommand(flags({ json: true }), {
      api: fakeApi(),
      log: () => {},
      write: (text: string) => {
        output.push(text);
      },
    });
    expect(exitCode).toBe(0);
    const parsed = JSON.parse(output.join('')) as {
      findings: unknown[];
      provider: string;
      pr: number;
      stats: { filesAnalyzed: number };
    };
    expect(parsed.provider).toBe('mock');
    expect(parsed.pr).toBe(7);
    expect(parsed.stats.filesAnalyzed).toBe(1);
    expect(Array.isArray(parsed.findings)).toBe(true);
  });

  it('exits 1 with --fail-on major when a matching finding exists', async () => {
    const provider = new MockProvider([
      {
        match: () => true,
        response: toolCallResponse([
          {
            file: 'src/app.js',
            start_line: 1,
            end_line: 1,
            severity: 'critical',
            category: 'security',
            title: 'Dangerous pattern',
            detail: 'This finding should trip the fail-on gate.',
            confidence: 0.9,
          },
        ]),
      },
    ]);
    const exitCode = await runReviewCommand(flags({ failOn: 'major' }), {
      api: fakeApi(),
      provider,
      log: () => {},
      write: () => {},
    });
    expect(exitCode).toBe(1);
  });

  it('exits 2 on operational errors such as a bad repo slug', async () => {
    const exitCode = await runReviewCommand(
      { ...flags(), repo: 'not-a-slug' },
      {
        api: fakeApi(),
        log: () => {},
        write: () => {},
      },
    );
    expect(exitCode).toBe(2);
  });

  it('posts a grouped review to the PR when --post is set', async () => {
    const api = fakeApi();
    const provider = new MockProvider([
      {
        match: () => true,
        response: toolCallResponse([
          {
            file: 'src/app.js',
            start_line: 1,
            end_line: 1,
            severity: 'major',
            category: 'bug',
            title: 'Finding to post',
            detail: 'This finding should reach the GitHub review API.',
            confidence: 0.9,
          },
        ]),
      },
    ]);
    const output: string[] = [];
    const exitCode = await runReviewCommand(flags({ post: true }), {
      api,
      provider,
      log: () => {},
      write: (text: string) => {
        output.push(text);
      },
    });
    expect(exitCode).toBe(0);
    expect(api.capturedReviews.length).toBe(1);
    expect(output.join('')).toContain('Findings: 1');
  });
});
