import { describe, expect, it } from 'vitest';
import { syntheticChangedFile } from '../diff.js';
import { parseTscOutput, runTsc } from './tsc.js';

describe('runTsc (subprocess)', () => {
  it('reports a type error with its code and line', async () => {
    const content = 'const count: number = 5;\nconst label: number = "5";\n';
    const file = syntheticChangedFile('src/types.ts', content);
    const findings = await runTsc([file]);
    const mismatch = findings.find((entry) => entry.rule === 'tsc:TS2322');
    expect(mismatch).toBeDefined();
    expect(mismatch?.file).toBe('src/types.ts');
    expect(mismatch?.start_line).toBe(2);
    expect(mismatch?.category).toBe('bug');
  });

  it('filters module-resolution errors for packages we do not have', async () => {
    const file = syntheticChangedFile('src/importer.ts', 'import "nonexistent-package-xyz";\n');
    const findings = await runTsc([file]);
    expect(findings.length).toBe(0);
  });
});

describe('parseTscOutput', () => {
  it('parses diagnostic lines and applies code mapping', () => {
    const output = [
      "src/a.ts(1,7): error TS2322: Type 'string' is not assignable to type 'number'.",
      'src/b.ts(12,5): error TS2367: This comparison appears unintentional.',
      "src/c.ts(3,1): error TS2307: Cannot find module 'missing'.",
      'Something that is not a diagnostic at all',
    ].join('\n');
    const findings = parseTscOutput(output);
    expect(findings.length).toBe(2);
    expect(findings[0]?.file).toBe('src/a.ts');
    expect(findings[0]?.start_line).toBe(1);
    expect(findings[1]?.severity).toBe('major');
  });
});
