import { describe, expect, it } from 'vitest';
import { commentableLinesFromPatch, parseDiffFiles, syntheticChangedFile } from './diff.js';

const PATCH = [
  'diff --git a/src/app.js b/src/app.js',
  'index 111..222 100644',
  '--- a/src/app.js',
  '+++ b/src/app.js',
  '@@ -1,4 +1,5 @@',
  ' function hello() {',
  '-  return 1;',
  '+  const two = 2;',
  '+  return two;',
  ' }',
  ' function bye() {',
  '@@ -10,2 +12,3 @@',
  '   keep();',
  '+  added();',
  ' }',
  '',
].join('\n');

describe('parseDiffFiles', () => {
  it('extracts file path, status, and change counts', () => {
    const files = parseDiffFiles(PATCH);
    expect(files.length).toBe(1);
    const file = files[0];
    expect(file?.path).toBe('src/app.js');
    expect(file?.status).toBe('modified');
    expect(file?.additions).toBe(3);
    expect(file?.deletions).toBe(1);
  });

  it('collects new-file line numbers for added and context lines across hunks', () => {
    const files = parseDiffFiles(PATCH);
    const lines = files[0]?.commentableLines ?? new Set<number>();
    expect([...lines].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 12, 13, 14]);
  });

  it('recognizes added and removed files', () => {
    const patch = [
      'diff --git a/new.js b/new.js',
      'new file mode 100644',
      '--- /dev/null',
      '+++ b/new.js',
      '@@ -0,0 +1,1 @@',
      '+hello();',
      'diff --git a/gone.js b/gone.js',
      'deleted file mode 100644',
      '--- a/gone.js',
      '+++ /dev/null',
      '@@ -1,1 +0,0 @@',
      '-bye();',
    ].join('\n');
    const files = parseDiffFiles(patch);
    expect(files.map((file) => file.status)).toEqual(['added', 'removed']);
    expect(files[0]?.path).toBe('new.js');
    expect(files[1]?.path).toBe('gone.js');
  });

  it('recognizes renames', () => {
    const patch = [
      'diff --git a/src/old.js b/src/new.js',
      'similarity index 95%',
      'rename from src/old.js',
      'rename to src/new.js',
      '@@ -1,1 +1,1 @@',
      ' keep();',
    ].join('\n');
    const files = parseDiffFiles(patch);
    expect(files[0]?.status).toBe('renamed');
    expect(files[0]?.path).toBe('src/new.js');
    expect(files[0]?.previousPath).toBe('src/old.js');
  });
});

describe('commentableLinesFromPatch', () => {
  it('parses bare hunks (GitHub list-files patch format)', () => {
    const lines = commentableLinesFromPatch('@@ -1,2 +1,3 @@\n keep()\n+added()\n');
    expect([...lines]).toEqual([1, 2]);
  });

  it('handles multiple bare hunks with correct line offsets', () => {
    const lines = commentableLinesFromPatch(
      '@@ -1,1 +1,2 @@\n+first()\n ctx()\n@@ -20,1 +40,2 @@\n ctx2()\n+second()\n',
    );
    expect([...lines]).toEqual([1, 2, 40, 41]);
  });
});

describe('syntheticChangedFile', () => {
  it('marks every line as newly added', () => {
    const file = syntheticChangedFile('src/a.js', 'one\ntwo\nthree\n');
    expect(file.status).toBe('added');
    expect(file.additions).toBe(3);
    expect([...file.commentableLines]).toEqual([1, 2, 3]);
  });

  it('handles empty content', () => {
    const file = syntheticChangedFile('src/empty.js', '');
    expect(file.additions).toBe(0);
    expect(file.commentableLines.size).toBe(0);
  });
});
