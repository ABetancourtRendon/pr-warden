import type { Category, Severity } from '../types.js';

export interface MappedDiagnostic {
  severity: Severity;
  category: Category;
  confidence: number;
}

/**
 * Map linter-specific diagnostics into PR-Warden's common severity/category
 * taxonomy. Every mapping here is deliberately conservative: static tools rarely
 * know whether something is a real runtime defect.
 */

const BIOME_GROUP_CATEGORY: Record<string, Category> = {
  suspicious: 'bug',
  correctness: 'bug',
  security: 'security',
  performance: 'performance',
  complexity: 'maintainability',
  style: 'style',
  a11y: 'maintainability',
  nursery: 'maintainability',
  parse: 'bug',
};

/** correctness rules that describe hygiene rather than defects */
const BIOME_MAINTAINABILITY_RULES = new Set([
  'noUnusedImports',
  'noUnusedVariables',
  'noUnusedFunctionParameters',
  'noUnusedPrivateClassMembers',
  'noUnusedLabels',
  'noUnreachable',
]);

export function mapBiomeDiagnostic(
  group: string,
  rule: string,
  biomeSeverity: 'error' | 'warning' | 'info',
): MappedDiagnostic {
  let category = BIOME_GROUP_CATEGORY[group] ?? 'maintainability';
  if (group === 'correctness' && BIOME_MAINTAINABILITY_RULES.has(rule)) {
    category = 'maintainability';
  }
  let severity: Severity =
    biomeSeverity === 'error' ? 'major' : biomeSeverity === 'warning' ? 'minor' : 'info';
  if (group === 'security') {
    severity = biomeSeverity === 'error' ? 'critical' : 'major';
  }
  const confidence =
    group === 'security'
      ? 0.9
      : group === 'suspicious'
        ? 0.8
        : group === 'correctness'
          ? 0.75
          : 0.7;
  return { severity, category, confidence };
}

const ESLINT_SECURITY_RULES = new Set([
  'no-eval',
  'no-implied-eval',
  'no-new-func',
  'no-prototype-builtins',
  'no-useless-call',
]);

const ESLINT_STYLE_RULES = new Set([
  'semi',
  'quotes',
  'indent',
  'curly',
  'comma-dangle',
  'eqeqeq',
  'no-tabs',
  'eol-last',
]);

const ESLINT_BUG_RULES = new Set([
  'no-async-promise-executor',
  'no-compare-neg-zero',
  'no-cond-assign',
  'no-constant-binary-expression',
  'no-dupe-keys',
  'no-self-compare',
  'no-template-curly-in-string',
  'no-unreachable',
]);

export function mapEslintDiagnostic(
  ruleId: string | null,
  eslintSeverity: number,
): MappedDiagnostic {
  let category: Category = 'maintainability';
  if (ruleId) {
    if (ruleId.startsWith('security/') || ESLINT_SECURITY_RULES.has(ruleId)) {
      category = 'security';
    } else if (ESLINT_STYLE_RULES.has(ruleId)) {
      category = 'style';
    } else if (ESLINT_BUG_RULES.has(ruleId)) {
      category = 'bug';
    }
  }
  const severity: Severity =
    eslintSeverity === 2 ? 'major' : eslintSeverity === 1 ? 'minor' : 'info';
  if (category === 'security' && eslintSeverity === 2) {
    return { severity: 'critical', category, confidence: 0.85 };
  }
  return { severity, category, confidence: 0.7 };
}

/** tsc error codes that only describe module resolution against code we do not have. */
const TSC_FILTERED_CODES = new Set(['2307', '2305', '2792']);

export function mapTscDiagnostic(code: string): MappedDiagnostic | null {
  if (TSC_FILTERED_CODES.has(code)) {
    return null;
  }
  if (code === '2367' || code === '2531' || code === '2532') {
    return { severity: 'major', category: 'bug', confidence: 0.75 };
  }
  return { severity: 'minor', category: 'bug', confidence: 0.65 };
}

const RUFF_PREFIX_CATEGORY: Array<{ prefix: string; category: Category }> = [
  { prefix: 'S', category: 'security' },
  { prefix: 'B', category: 'bug' },
  { prefix: 'F', category: 'bug' },
  { prefix: 'E', category: 'style' },
  { prefix: 'W', category: 'style' },
  { prefix: 'C4', category: 'performance' },
  { prefix: 'PERF', category: 'performance' },
  { prefix: 'PL', category: 'maintainability' },
  { prefix: 'SIM', category: 'maintainability' },
];

export function mapRuffDiagnostic(code: string): MappedDiagnostic {
  const entry = RUFF_PREFIX_CATEGORY.find((candidate) => code.startsWith(candidate.prefix));
  if (!entry) {
    return { severity: 'minor', category: 'maintainability', confidence: 0.7 };
  }
  if (entry.category === 'security') {
    const severity: Severity = code === 'S608' ? 'critical' : 'major';
    return { severity, category: 'security', confidence: 0.85 };
  }
  const severity: Severity = entry.category === 'style' ? 'info' : 'minor';
  return { severity, category: entry.category, confidence: 0.7 };
}
