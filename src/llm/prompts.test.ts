import { describe, expect, it } from 'vitest';
import { syntheticChangedFile } from '../diff.js';
import type { ReviewInput } from '../types.js';
import { buildSystemPrompt, buildUserPrompt } from './prompts.js';

describe('buildSystemPrompt', () => {
  it('contains the strict reviewer persona and taxonomy', () => {
    const prompt = buildSystemPrompt([]);
    expect(prompt).toContain('PR-Warden');
    expect(prompt).toContain('critical');
    expect(prompt).toContain('maintainability');
    expect(prompt).toContain('empty findings list');
  });

  it('appends custom rules verbatim', () => {
    const prompt = buildSystemPrompt([
      'Never suggest renaming public exports.',
      'Prefer table-driven tests.',
    ]);
    expect(prompt).toContain('Never suggest renaming public exports.');
    expect(prompt).toContain('Prefer table-driven tests.');
    expect(prompt).toContain('.warden.yml');
  });
});

describe('buildUserPrompt', () => {
  const input: ReviewInput = {
    repo: 'octocat/example',
    pr: 42,
    title: 'Fix login flow',
    body: 'This PR repairs the session cookie path.',
    files: [
      syntheticChangedFile(
        'src/login.ts',
        'export function login(user: string) {\n  return user;\n}\n',
      ),
      syntheticChangedFile('src/util.ts', 'export const id = (x: number) => x;\n'),
    ],
  };

  it('includes repository, PR metadata, and file inventory', () => {
    const prompt = buildUserPrompt(input);
    expect(prompt).toContain('Repository: octocat/example');
    expect(prompt).toContain('Pull request #42');
    expect(prompt).toContain('Fix login flow');
    expect(prompt).toContain('session cookie path');
    expect(prompt).toContain('## File: src/login.ts');
    expect(prompt).toContain('src/util.ts');
  });

  it('numbers file content lines and pins new-file numbering', () => {
    const prompt = buildUserPrompt(input);
    expect(prompt).toContain('1 | export function login(user: string) {');
    expect(prompt).toContain('2 |   return user;');
    expect(prompt).toContain('MUST reference the NEW version');
  });

  it('falls back to hunks for oversized files', () => {
    const longLine = `${'x'.repeat(120)}`;
    const content = Array.from({ length: 100 }, (_, index) => `line ${index} ${longLine}`).join(
      '\n',
    );
    const big = syntheticChangedFile('src/big.ts', content);
    const prompt = buildUserPrompt({
      repo: 'octocat/example',
      pr: 1,
      title: 'Big PR',
      body: '',
      files: [{ ...big, patch: '@@ -1,2 +1,2 @@\n context\n+changed\n' }],
    });
    expect(prompt).toContain('hunks only');
    expect(prompt).toContain('@@ -1,2 +1,2 @@');
    expect(prompt).toContain('changed');
  });

  it('truncates the prompt at the total cap', () => {
    const files = Array.from({ length: 40 }, (_, index) =>
      syntheticChangedFile(`src/file${index}.ts`, 'export const a = 1;\n'),
    );
    // Fill the budget with one large legitimate file first, then many files.
    files.unshift(
      syntheticChangedFile(
        'src/huge.ts',
        Array.from({ length: 350 }, () => 'export const line = 1;').join('\n'),
      ),
    );
    const prompt = buildUserPrompt({ repo: 'r', pr: 1, title: 't', body: '', files });
    expect(prompt.length).toBeLessThanOrEqual(95_000);
  });
});
