import { describe, expect, it } from 'vitest';
import { syntheticChangedFile } from './diff.js';
import {
  countLines,
  EmitFindingsPayload,
  emitFindingsJsonSchema,
  normalizeLlmFindings,
  summarizeIssues,
} from './schemas.js';

function validFinding(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    file: 'src/app.js',
    start_line: 2,
    end_line: 2,
    severity: 'major',
    category: 'bug',
    title: 'Off-by-one loop bound',
    detail: 'The loop reads past the end of the array.',
    ...overrides,
  };
}

describe('EmitFindingsPayload', () => {
  it('accepts a well-formed findings payload', () => {
    const result = EmitFindingsPayload.safeParse({ findings: [validFinding()] });
    expect(result.success).toBe(true);
  });

  it('accepts an empty findings list', () => {
    const result = EmitFindingsPayload.safeParse({ findings: [] });
    expect(result.success).toBe(true);
  });

  it('rejects an invalid severity', () => {
    const result = EmitFindingsPayload.safeParse({
      findings: [validFinding({ severity: 'blocker' })],
    });
    expect(result.success).toBe(false);
  });

  it('rejects a missing title', () => {
    const { title: _title, ...withoutTitle } = validFinding() as Record<string, unknown>;
    const result = EmitFindingsPayload.safeParse({ findings: [withoutTitle] });
    expect(result.success).toBe(false);
  });

  it('rejects out-of-range confidence', () => {
    const result = EmitFindingsPayload.safeParse({ findings: [validFinding({ confidence: 1.5 })] });
    expect(result.success).toBe(false);
  });

  it('rejects a payload without the findings key', () => {
    const result = EmitFindingsPayload.safeParse({ items: [] });
    expect(result.success).toBe(false);
  });
});

describe('summarizeIssues', () => {
  it('names the offending fields', () => {
    const result = EmitFindingsPayload.safeParse({ findings: [validFinding({ start_line: 0 })] });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(summarizeIssues(result.error)).toContain('findings');
      expect(summarizeIssues(result.error)).toContain('start_line');
    }
  });
});

describe('emitFindingsJsonSchema', () => {
  it('requires the core fields in the derived JSON schema', () => {
    const serialized = JSON.stringify(emitFindingsJsonSchema);
    expect(serialized).toContain('"file"');
    expect(serialized).toContain('"severity"');
    expect(serialized).toContain('"required"');
    expect(serialized).toContain('critical');
    expect(serialized).toContain('maintainability');
  });
});

describe('countLines', () => {
  it('counts with and without trailing newlines', () => {
    expect(countLines('')).toBe(0);
    expect(countLines('a')).toBe(1);
    expect(countLines('a\nb')).toBe(2);
    expect(countLines('a\nb\n')).toBe(2);
  });
});

describe('normalizeLlmFindings', () => {
  const files = [syntheticChangedFile('src/app.js', 'line one\nline two\nline three\n')];

  it('maps valid findings onto reviewed files with generated ids', () => {
    const { findings, dropped } = normalizeLlmFindings(
      { findings: [validFinding() as never] },
      files,
    );
    expect(dropped).toBe(0);
    expect(findings.length).toBe(1);
    expect(findings[0]?.id).toBe('llm-1');
    expect(findings[0]?.source).toBe('llm');
    expect(findings[0]?.confidence).toBe(0.5);
  });

  it('keeps an explicit confidence when provided', () => {
    const { findings } = normalizeLlmFindings(
      { findings: [validFinding({ confidence: 0.9 }) as never] },
      files,
    );
    expect(findings[0]?.confidence).toBe(0.9);
  });

  it('clamps line ranges to the file length', () => {
    const { findings } = normalizeLlmFindings(
      { findings: [validFinding({ start_line: 2, end_line: 99 }) as never] },
      files,
    );
    expect(findings[0]?.end_line).toBe(3);
  });

  it('swaps reversed line ranges', () => {
    const { findings } = normalizeLlmFindings(
      { findings: [validFinding({ start_line: 3, end_line: 1 }) as never] },
      files,
    );
    expect(findings[0]?.start_line).toBeLessThanOrEqual(findings[0]?.end_line ?? 0);
  });

  it('drops findings for files that were not reviewed', () => {
    const { findings, dropped } = normalizeLlmFindings(
      { findings: [validFinding({ file: 'src/other.js' }) as never] },
      files,
    );
    expect(findings.length).toBe(0);
    expect(dropped).toBe(1);
  });
});
