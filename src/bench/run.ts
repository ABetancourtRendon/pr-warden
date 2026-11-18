import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import type { WardenOptions } from '../config.js';
import { DEFAULT_WARDEN_OPTIONS, resolveConfig } from '../config.js';
import { syntheticChangedFile } from '../diff.js';
import type { MockScenario } from '../llm/mock.js';
import { MockProvider, toolCallResponse } from '../llm/mock.js';
import { OpenAICompatProvider } from '../llm/openai-compat.js';
import type { LLMProvider } from '../llm/provider.js';
import { runReview } from '../review/pipeline.js';
import type { Finding, ReviewResult } from '../types.js';
import type { Manifest, ManifestBug } from './manifest.js';
import { collectFixtureFiles, discoverFixtures, loadManifest } from './manifest.js';
import type { Metrics, ScoreOptions } from './score.js';
import {
  aggregateMetrics,
  categoryMetrics,
  DEFAULT_SCORE_OPTIONS,
  round4,
  scoreFixture,
} from './score.js';

const BENCH_OPTIONS: WardenOptions = {
  ...DEFAULT_WARDEN_OPTIONS,
  minSeverity: 'info',
  ignorePaths: [],
};

interface RecordingFile {
  [fixture: string]: Array<Record<string, unknown>>;
}

interface ExpectedFile {
  overall: { tp: number; fp: number; fn: number; precision: number; recall: number; f1: number };
  perCategory: Array<{
    category: string;
    tp: number;
    fp: number;
    fn: number;
    precision: number;
    recall: number;
    f1: number;
  }>;
  fixtures: Array<{ name: string; planted: number; found: number; tp: number; fp: number }>;
}

interface FixtureRun {
  dirName: string;
  manifest: Manifest;
  result: ReviewResult;
}

async function main(): Promise<number> {
  const { values } = parseArgs({
    options: {
      provider: { type: 'string', default: 'env' }, // 'env' (real LLM via env vars) or 'mock'
      out: { type: 'string' }, // BENCH.md output path; defaults to docs/BENCH.md unless provider is mock
      assert: { type: 'string' }, // compare against an expected-metrics file (CI determinism guard)
      freeze: { type: 'string' }, // write the expected-metrics file from this run
    },
  });
  const providerMode = values.provider === 'mock' ? 'mock' : 'env';

  const fixturesRoot = path.resolve('bench/fixtures');
  if (!existsSync(fixturesRoot)) {
    console.error(`PR-Warden bench: fixtures directory not found at ${fixturesRoot}`);
    return 2;
  }

  let provider: LLMProvider | null;
  if (providerMode === 'mock') {
    provider = await createMockProvider();
  } else {
    const resolved = resolveConfig({ file: null, env: process.env });
    if (!resolved.provider) {
      console.error(
        [
          'PR-Warden bench: no LLM provider configured - refusing to write static-only numbers as real results.',
          '',
          'Set your key (the free Google AI Studio key you already have) and rerun:',
          '  PowerShell:    $env:LLM_API_KEY = "YOUR_GEMINI_KEY"',
          '  bash:           export LLM_API_KEY=YOUR_GEMINI_KEY',
          '  or create .env (see .env.example).',
          '',
          'Then run: pnpm bench',
        ].join('\n'),
      );
      return 1;
    }
    provider = new OpenAICompatProvider({
      baseUrl: resolved.provider.baseUrl,
      apiKey: resolved.provider.apiKey,
      model: resolved.provider.model,
      name: resolved.provider.preset,
    });
  }

  const fixtureDirs = await discoverFixtures(fixturesRoot);
  if (fixtureDirs.length === 0) {
    console.error('PR-Warden bench: no fixtures found under bench/fixtures');
    return 2;
  }

  console.error(
    `PR-Warden bench: running ${fixtureDirs.length} fixtures with provider ${provider.name} (${provider.model})`,
  );
  const runs: FixtureRun[] = [];
  for (const fixtureDir of fixtureDirs) {
    const manifest = await loadManifest(fixtureDir);
    const files = await collectFixtureFiles(fixtureDir);
    const dirName = path.basename(fixtureDir);
    const input = {
      repo: `bench/${dirName}`,
      pr: null,
      title: `Fixture review: ${dirName} - ${manifest.description}`,
      body: `Benchmark fixture with ${manifest.bugs.length} planted bug(s).`,
      files: files.map((file) => syntheticChangedFile(file.path, file.content)),
    };
    const result = await runReview(input, BENCH_OPTIONS, {
      provider,
      log: (message) => console.error(message),
    });
    runs.push({ dirName, manifest, result });
    console.error(
      `PR-Warden bench: ${dirName} -> ${result.findings.length} finding(s) (${result.stats.staticFindings} static, ${result.stats.llmFindings} llm)`,
    );
  }

  const report = buildReport(runs, DEFAULT_SCORE_OPTIONS);
  printConsoleReport(report, providerMode);

  if (values.freeze) {
    await writeFile(values.freeze, `${JSON.stringify(buildExpected(report), null, 2)}\n`, 'utf8');
    console.error(`PR-Warden bench: froze expected metrics to ${values.freeze}`);
  }

  if (values.assert) {
    const mismatch = await assertAgainstExpected(values.assert, buildExpected(report));
    if (mismatch !== null) {
      console.error(`PR-Warden bench: ASSERTION FAILED - ${mismatch}`);
      return 1;
    }
    console.error(
      'PR-Warden bench: scorer assertions passed (deterministic against recorded mock outputs)',
    );
  }

  const outputPath = values.out ?? (providerMode === 'mock' ? null : 'docs/BENCH.md');
  if (outputPath !== null) {
    const markdown = renderBenchMarkdown(report, provider);
    await writeFile(outputPath, markdown, 'utf8');
    console.error(`PR-Warden bench: wrote ${outputPath}`);
  }
  return 0;
}

async function createMockProvider(): Promise<MockProvider> {
  const recordingsPath = path.resolve('bench/recordings/mock.json');
  if (!existsSync(recordingsPath)) {
    console.error(`PR-Warden bench: mock recordings not found at ${recordingsPath}`);
    process.exit(2);
  }
  const raw = JSON.parse(await readFile(recordingsPath, 'utf8')) as RecordingFile;
  const scenarios: MockScenario[] = Object.entries(raw).map(([fixture, findings]) => ({
    match: (request) => request.user.includes(fixture),
    response: toolCallResponse(findings),
  }));
  return new MockProvider(scenarios);
}

interface AggregateReport {
  overall: Metrics;
  perCategory: Array<{ category: string; metrics: Metrics }>;
  fixtures: Array<{
    dirName: string;
    planted: number;
    found: number;
    metrics: Metrics;
    missed: Array<{ file: string; line: number; description: string }>;
    falsePositives: Array<{ id: string; file: string; line: number; title: string }>;
  }>;
  totalFindings: number;
  totalBugs: number;
}

function buildReport(runs: FixtureRun[], options: ScoreOptions): AggregateReport {
  const allFindings: Finding[] = [];
  const allBugs: ManifestBug[] = [];
  for (const run of runs) {
    allFindings.push(...run.result.findings);
    allBugs.push(...run.manifest.bugs);
  }
  const overall = aggregateMetrics(allFindings, allBugs, options);

  const categories = new Set<string>(allBugs.map((bug) => bug.category));
  for (const finding of allFindings) {
    if (options.categories.includes(finding.category)) {
      categories.add(finding.category);
    }
  }
  const perCategory = [...categories].sort().map((category) => ({
    category,
    metrics: categoryMetrics(category as Finding['category'], allFindings, allBugs, options),
  }));

  const fixtures = runs.map((run) => {
    const score = scoreFixture(run.result.findings, run.manifest.bugs, options);
    return {
      dirName: run.dirName,
      planted: run.manifest.bugs.length,
      found: run.manifest.bugs.length - score.bugs.filter((outcome) => !outcome.found).length,
      metrics: aggregateMetrics(run.result.findings, run.manifest.bugs, options),
      missed: score.bugs
        .filter((outcome) => !outcome.found)
        .map((outcome) => ({
          file: outcome.bug.file,
          line: outcome.bug.start_line,
          description: outcome.bug.description,
        })),
      falsePositives: score.falsePositiveIds.map((id) => {
        const finding = run.result.findings.find((candidate) => candidate.id === id);
        return {
          id,
          file: finding?.file ?? '?',
          line: finding?.start_line ?? 0,
          title: finding?.title ?? '?',
        };
      }),
    };
  });

  return {
    overall,
    perCategory,
    fixtures,
    totalFindings: allFindings.length,
    totalBugs: allBugs.length,
  };
}

function printConsoleReport(report: AggregateReport, providerMode: string): void {
  console.error('');
  console.error(`Provider: ${providerMode}`);
  console.error(
    `Overall: precision ${round4(report.overall.precision)} | recall ${round4(report.overall.recall)} | F1 ${round4(report.overall.f1)} (TP ${report.overall.tp}, FP ${report.overall.fp}, FN ${report.overall.fn})`,
  );
  for (const category of report.perCategory) {
    console.error(
      `${category.category}: precision ${round4(category.metrics.precision)} | recall ${round4(category.metrics.recall)} | F1 ${round4(category.metrics.f1)}`,
    );
  }
}

function buildExpected(report: AggregateReport): ExpectedFile {
  return {
    overall: {
      tp: report.overall.tp,
      fp: report.overall.fp,
      fn: report.overall.fn,
      precision: round4(report.overall.precision),
      recall: round4(report.overall.recall),
      f1: round4(report.overall.f1),
    },
    perCategory: report.perCategory.map((category) => ({
      category: category.category,
      tp: category.metrics.tp,
      fp: category.metrics.fp,
      fn: category.metrics.fn,
      precision: round4(category.metrics.precision),
      recall: round4(category.metrics.recall),
      f1: round4(category.metrics.f1),
    })),
    fixtures: report.fixtures.map((fixture) => ({
      name: fixture.dirName,
      planted: fixture.planted,
      found: fixture.found,
      tp: fixture.metrics.tp,
      fp: fixture.metrics.fp,
    })),
  };
}

async function assertAgainstExpected(
  expectedPath: string,
  actual: ExpectedFile,
): Promise<string | null> {
  if (!existsSync(expectedPath)) {
    return `expected metrics file not found: ${expectedPath}`;
  }
  const expected = JSON.parse(await readFile(expectedPath, 'utf8')) as ExpectedFile;

  const overallMatches =
    expected.overall.tp === actual.overall.tp &&
    expected.overall.fp === actual.overall.fp &&
    expected.overall.fn === actual.overall.fn &&
    expected.overall.precision === actual.overall.precision &&
    expected.overall.recall === actual.overall.recall &&
    expected.overall.f1 === actual.overall.f1;
  if (!overallMatches) {
    return `overall metrics changed: expected ${JSON.stringify(expected.overall)}, got ${JSON.stringify(actual.overall)}`;
  }

  const expectedCategories = new Map(expected.perCategory.map((entry) => [entry.category, entry]));
  for (const actualCategory of actual.perCategory) {
    const expectedCategory = expectedCategories.get(actualCategory.category);
    if (!expectedCategory) {
      return `unexpected category in metrics: ${actualCategory.category}`;
    }
    if (
      expectedCategory.tp !== actualCategory.tp ||
      expectedCategory.fp !== actualCategory.fp ||
      expectedCategory.fn !== actualCategory.fn ||
      expectedCategory.precision !== actualCategory.precision ||
      expectedCategory.recall !== actualCategory.recall ||
      expectedCategory.f1 !== actualCategory.f1
    ) {
      return `category ${actualCategory.category} metrics changed: expected ${JSON.stringify(expectedCategory)}, got ${JSON.stringify(actualCategory)}`;
    }
  }
  if (expectedCategories.size !== actual.perCategory.length) {
    return 'category set changed between expected and actual metrics';
  }

  const expectedFixtures = new Map(expected.fixtures.map((entry) => [entry.name, entry]));
  for (const actualFixture of actual.fixtures) {
    const expectedFixture = expectedFixtures.get(actualFixture.name);
    if (!expectedFixture) {
      return `unexpected fixture in metrics: ${actualFixture.name}`;
    }
    if (
      expectedFixture.planted !== actualFixture.planted ||
      expectedFixture.found !== actualFixture.found ||
      expectedFixture.tp !== actualFixture.tp ||
      expectedFixture.fp !== actualFixture.fp
    ) {
      return `fixture ${actualFixture.name} metrics changed: expected ${JSON.stringify(expectedFixture)}, got ${JSON.stringify(actualFixture)}`;
    }
  }
  if (expectedFixtures.size !== actual.fixtures.length) {
    return 'fixture set changed between expected and actual metrics';
  }
  return null;
}

function renderBenchMarkdown(report: AggregateReport, provider: LLMProvider): string {
  const lines: string[] = [];
  lines.push('# PR-Warden Benchmark Results');
  lines.push('');
  lines.push('> GENERATED by `pnpm bench` - do not edit this file by hand.');
  lines.push('> Regenerate with your own key: `pnpm bench` (see SETUP.md).');
  lines.push('');
  lines.push(`- Generated: ${new Date().toISOString()}`);
  lines.push(`- Provider: ${provider.name} (${provider.model})`);
  lines.push(`- Fixtures: ${report.fixtures.length} (${report.totalBugs} planted bugs)`);
  lines.push(`- Total findings produced: ${report.totalFindings}`);
  lines.push('');
  lines.push('## Methodology');
  lines.push('');
  lines.push(
    [
      'Each fixture is a tiny project with planted bugs listed in its manifest.json (file, line range, category).',
      'The full review pipeline (static analysis + LLM pass, same code path as a real PR review) runs on every fixture.',
      'A finding matches a bug when the file is identical, the category is identical, and the line ranges overlap after widening both by 2 lines (LLMs are often off by a line or two).',
      'Scoring counts findings in the bug, security, and performance categories at minor severity or higher; style and maintainability findings are excluded because the fixtures intentionally contain no such targets.',
      'Precision = matched findings / eligible findings (finding level). Recall = matched bugs / total planted bugs (bug level). F1 is their harmonic mean.',
      'Static-analysis findings (biome, tsc, eslint, ruff) count toward the same metrics as LLM findings.',
    ].join('\n'),
  );
  lines.push('');
  lines.push('## Results');
  lines.push('');
  lines.push('| Metric | Value |');
  lines.push('|---|---|');
  lines.push(`| Precision | ${round4(report.overall.precision).toFixed(4)} |`);
  lines.push(`| Recall | ${round4(report.overall.recall).toFixed(4)} |`);
  lines.push(`| F1 | ${round4(report.overall.f1).toFixed(4)} |`);
  lines.push(`| True positives (findings) | ${report.overall.tp} |`);
  lines.push(`| False positives (findings) | ${report.overall.fp} |`);
  lines.push(`| False negatives (missed bugs) | ${report.overall.fn} |`);
  lines.push('');
  lines.push('### Per category');
  lines.push('');
  lines.push('| Category | Precision | Recall | F1 | TP | FP | FN |');
  lines.push('|---|---|---|---|---|---|---|');
  for (const category of report.perCategory) {
    lines.push(
      `| ${category.category} | ${round4(category.metrics.precision).toFixed(4)} | ${round4(category.metrics.recall).toFixed(4)} | ${round4(category.metrics.f1).toFixed(4)} | ${category.metrics.tp} | ${category.metrics.fp} | ${category.metrics.fn} |`,
    );
  }
  lines.push('');
  lines.push('### Per fixture');
  lines.push('');
  lines.push('| Fixture | Planted bugs | Found | TP | FP | Precision | Recall | F1 |');
  lines.push('|---|---|---|---|---|---|---|---|');
  for (const fixture of report.fixtures) {
    lines.push(
      `| ${fixture.dirName} | ${fixture.planted} | ${fixture.found} | ${fixture.metrics.tp} | ${fixture.metrics.fp} | ${round4(fixture.metrics.precision).toFixed(4)} | ${round4(fixture.metrics.recall).toFixed(4)} | ${round4(fixture.metrics.f1).toFixed(4)} |`,
    );
  }
  lines.push('');
  lines.push('### Missed bugs and false positives');
  lines.push('');
  for (const fixture of report.fixtures) {
    if (fixture.missed.length === 0 && fixture.falsePositives.length === 0) {
      continue;
    }
    lines.push(`#### ${fixture.dirName}`);
    lines.push('');
    for (const missed of fixture.missed) {
      lines.push(`- Missed: \`${missed.file}:${missed.line}\` - ${missed.description}`);
    }
    for (const falsePositive of fixture.falsePositives) {
      lines.push(
        `- False positive: \`${falsePositive.file}:${falsePositive.line}\` - ${falsePositive.title}`,
      );
    }
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}

void main().then((exitCode: number) => {
  process.exitCode = exitCode === 0 ? undefined : exitCode;
});
