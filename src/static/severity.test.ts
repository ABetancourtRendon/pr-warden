import { describe, expect, it } from 'vitest';
import {
  mapBiomeDiagnostic,
  mapEslintDiagnostic,
  mapRuffDiagnostic,
  mapTscDiagnostic,
} from './severity.js';

describe('mapBiomeDiagnostic', () => {
  it('maps suspicious errors to major bugs', () => {
    const mapped = mapBiomeDiagnostic('suspicious', 'noDoubleEquals', 'error');
    expect(mapped).toEqual({ severity: 'major', category: 'bug', confidence: 0.8 });
  });

  it('escalates the security group', () => {
    expect(mapBiomeDiagnostic('security', 'noDangerouslySetInnerHtml', 'error').severity).toBe(
      'critical',
    );
    expect(mapBiomeDiagnostic('security', 'noDangerouslySetInnerHtml', 'warning').severity).toBe(
      'major',
    );
    expect(mapBiomeDiagnostic('security', 'noDangerouslySetInnerHtml', 'error').category).toBe(
      'security',
    );
  });

  it('routes unused-symbol correctness rules to maintainability', () => {
    const mapped = mapBiomeDiagnostic('correctness', 'noUnusedImports', 'warning');
    expect(mapped.category).toBe('maintainability');
    expect(mapped.severity).toBe('minor');
  });

  it('routes unreachable-code hygiene rules to maintainability', () => {
    expect(mapBiomeDiagnostic('correctness', 'noUnreachable', 'error').category).toBe(
      'maintainability',
    );
  });

  it('keeps other correctness rules as bugs', () => {
    expect(mapBiomeDiagnostic('correctness', 'noInvalidConstructorSuper', 'error').category).toBe(
      'bug',
    );
  });

  it('maps style rules to the style category', () => {
    const mapped = mapBiomeDiagnostic('style', 'useConst', 'error');
    expect(mapped.category).toBe('style');
    expect(mapped.severity).toBe('major');
  });

  it('falls back to maintainability for unknown groups', () => {
    const mapped = mapBiomeDiagnostic('nursery', 'someRule', 'warning');
    expect(mapped.category).toBe('maintainability');
  });
});

describe('mapEslintDiagnostic', () => {
  it('maps error severity to major', () => {
    expect(mapEslintDiagnostic('no-eval', 2)).toEqual({
      severity: 'critical',
      category: 'security',
      confidence: 0.85,
    });
  });

  it('maps warnings to minor', () => {
    expect(mapEslintDiagnostic('semi', 1).severity).toBe('minor');
  });

  it('classifies known bug rules', () => {
    expect(mapEslintDiagnostic('no-self-compare', 2).category).toBe('bug');
  });

  it('classifies style rules', () => {
    expect(mapEslintDiagnostic('semi', 2).category).toBe('style');
    expect(mapEslintDiagnostic('security/detect-object-injection', 2).category).toBe('security');
  });

  it('defaults to maintainability for unknown rules', () => {
    expect(mapEslintDiagnostic('some-plugin/rule', 1).category).toBe('maintainability');
  });

  it('handles a missing rule id', () => {
    expect(mapEslintDiagnostic(null, 1).category).toBe('maintainability');
  });
});

describe('mapTscDiagnostic', () => {
  it('filters module-resolution noise', () => {
    expect(mapTscDiagnostic('2307')).toBeNull();
    expect(mapTscDiagnostic('2305')).toBeNull();
    expect(mapTscDiagnostic('2792')).toBeNull();
  });

  it('escalates invalid comparisons and null access', () => {
    expect(mapTscDiagnostic('2367')?.severity).toBe('major');
    expect(mapTscDiagnostic('2531')?.severity).toBe('major');
    expect(mapTscDiagnostic('2367')?.category).toBe('bug');
  });

  it('maps ordinary type errors to minor bugs', () => {
    const mapped = mapTscDiagnostic('2322');
    expect(mapped?.severity).toBe('minor');
    expect(mapped?.category).toBe('bug');
  });
});

describe('mapRuffDiagnostic', () => {
  it('marks SQL-injection bandit findings as critical security issues', () => {
    expect(mapRuffDiagnostic('S608')).toEqual({
      severity: 'critical',
      category: 'security',
      confidence: 0.85,
    });
  });

  it('maps other bandit rules to security majors', () => {
    const mapped = mapRuffDiagnostic('S101');
    expect(mapped.severity).toBe('major');
    expect(mapped.category).toBe('security');
  });

  it('maps pyflakes and bugbear rules to bugs', () => {
    expect(mapRuffDiagnostic('F821').category).toBe('bug');
    expect(mapRuffDiagnostic('B904').category).toBe('bug');
  });

  it('maps style and perf rules to their categories', () => {
    expect(mapRuffDiagnostic('E501').category).toBe('style');
    expect(mapRuffDiagnostic('E501').severity).toBe('info');
    expect(mapRuffDiagnostic('C401').category).toBe('performance');
  });
});
