import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { countLines } from '../schemas.js';
import {
  BenchManifestError,
  collectFixtureFiles,
  discoverFixtures,
  loadManifest,
  ManifestSchema,
} from './manifest.js';

const fixturesRoot = path.resolve('bench/fixtures');

describe('benchmark fixtures (structural validation against the real files)', () => {
  it('discovers the five planted-bug fixtures', async () => {
    const dirs = await discoverFixtures(fixturesRoot);
    expect(dirs.map((dir) => path.basename(dir))).toEqual([
      '01-sql-injection',
      '02-off-by-one',
      '03-unhandled-promise',
      '04-race-condition',
      '05-type-confusion',
    ]);
  });

  it('every manifest bug points at a real file and a real line range', async () => {
    for (const fixtureDir of await discoverFixtures(fixturesRoot)) {
      const manifest = await loadManifest(fixtureDir);
      expect(manifest.bugs.length).toBeGreaterThan(0);
      const files = await collectFixtureFiles(fixtureDir);
      const byPath = new Map(files.map((file) => [file.path, file.content]));
      for (const planted of manifest.bugs) {
        const content = byPath.get(planted.file);
        if (content === undefined) {
          throw new Error(
            `${path.basename(fixtureDir)}: manifest references missing file ${planted.file}`,
          );
        }
        const total = countLines(content);
        expect(planted.start_line).toBeGreaterThanOrEqual(1);
        expect(planted.end_line).toBeGreaterThanOrEqual(planted.start_line);
        expect(planted.end_line).toBeLessThanOrEqual(total);
      }
    }
  });

  it('rejects manifests with schema violations', () => {
    const invalidCategory = {
      name: 'broken',
      description: 'bad fixture',
      bugs: [
        { file: 'src/a.js', start_line: 1, end_line: 1, category: 'chore', description: 'nope' },
      ],
    };
    expect(ManifestSchema.safeParse(invalidCategory).success).toBe(false);

    const missingBugs = { name: 'broken', description: 'bad fixture', bugs: [] };
    expect(ManifestSchema.safeParse(missingBugs).success).toBe(false);

    const extraKeys = {
      name: 'broken',
      description: 'bad fixture',
      bugs: [
        {
          file: 'src/a.js',
          start_line: 1,
          end_line: 1,
          category: 'bug',
          description: 'nope',
          extra: 'x',
        },
      ],
    };
    expect(ManifestSchema.safeParse(extraKeys).success).toBe(false);
  });

  it('throws a BenchManifestError for unreadable manifests', async () => {
    await expect(loadManifest('/definitely/not/a/fixture')).rejects.toBeInstanceOf(
      BenchManifestError,
    );
  });
});
