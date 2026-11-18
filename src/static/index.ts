import { matchesIgnorePath } from '../config.js';
import type { ChangedFile, Finding, Logger } from '../types.js';
import { biomeRunnerAvailable, runBiome } from './biome.js';
import { eslintRunnerAvailable, runEslint } from './eslint.js';
import { ruffRunnerAvailable, runRuff } from './ruff.js';
import { runTsc, tscRunnerAvailable } from './tsc.js';

export interface StaticAnalysisOptions {
  ignorePaths: string[];
  maxFileBytes?: number;
  maxFiles?: number;
  timeoutMs?: number;
  log?: Logger;
}

export interface StaticAnalysisResult {
  findings: Finding[];
  notes: string[];
  filesAnalyzed: number;
  filesSkipped: number;
}

/**
 * Deterministic static analysis pass: copy changed files into an isolated
 * workspace, run every available linter there, and normalize their output into
 * the common Finding format. Tool availability: biome is bundled as a runtime
 * dependency; tsc and eslint run when resolvable in the environment; ruff runs
 * when a binary is on PATH.
 */
export async function runStaticAnalysis(
  files: ChangedFile[],
  options: StaticAnalysisOptions,
): Promise<StaticAnalysisResult> {
  const notes: string[] = [];
  const maxFileBytes = options.maxFileBytes ?? 150_000;
  const maxFiles = options.maxFiles ?? 50;

  const eligible: ChangedFile[] = [];
  let skipped = 0;
  for (const file of files) {
    if (matchesIgnorePath(file.path, options.ignorePaths)) {
      skipped += 1;
      continue;
    }
    if (file.content === '') {
      skipped += 1;
      continue;
    }
    if (Buffer.byteLength(file.content, 'utf8') > maxFileBytes) {
      skipped += 1;
      continue;
    }
    eligible.push(file);
  }
  const analyzed = eligible.slice(0, maxFiles);
  skipped += eligible.length - analyzed.length;

  const findings: Finding[] = [];
  if (analyzed.length === 0) {
    return { findings, notes, filesAnalyzed: 0, filesSkipped: skipped };
  }

  if (!biomeRunnerAvailable()) {
    notes.push('biome pass skipped: bundled binary not resolvable');
  } else {
    const biomeFindings = await runBiome(analyzed, {
      timeoutMs: options.timeoutMs,
      log: options.log,
    });
    findings.push(...biomeFindings);
  }

  if (!tscRunnerAvailable()) {
    notes.push('tsc pass skipped: typescript not installed in the environment');
  } else {
    const tscFindings = await runTsc(analyzed, { timeoutMs: options.timeoutMs, log: options.log });
    findings.push(...tscFindings);
  }

  if (!eslintRunnerAvailable()) {
    notes.push('eslint pass skipped: eslint not installed in the environment');
  } else {
    const eslintFindings = await runEslint(analyzed, {
      timeoutMs: options.timeoutMs,
      log: options.log,
    });
    findings.push(...eslintFindings);
  }

  if (!ruffRunnerAvailable()) {
    notes.push('ruff pass skipped: ruff binary not on PATH');
  } else {
    const ruffFindings = await runRuff(analyzed, {
      timeoutMs: options.timeoutMs,
      log: options.log,
    });
    findings.push(...ruffFindings);
  }

  return { findings, notes, filesAnalyzed: analyzed.length, filesSkipped: skipped };
}
