import type { ChangedFile, Finding, Logger } from '../types.js';
import { asNumber, asString, isRecord } from './parse-utils.js';
import { mapBiomeDiagnostic } from './severity.js';
import {
  createWorkspace,
  execToFile,
  removeWorkspace,
  resolveModuleFile,
  safeRelativePath,
  writeWorkspaceFiles,
} from './spawn.js';

const BIOME_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.mts', '.cts']);

/** biome.json written into the lint workspace: recommended lint rules only, no formatting checks. */
const WORKSPACE_CONFIG = JSON.stringify({
  linter: { enabled: true, rules: { preset: 'recommended' } },
});

export function biomeRunnerAvailable(): { command: string; baseArgs: string[] } | null {
  const binPath = resolveModuleFile('@biomejs/biome/bin/biome');
  if (!binPath) {
    return null;
  }
  // bin/biome is a Node launcher script; running it through the current Node is cross-platform.
  return { command: process.execPath, baseArgs: [binPath] };
}

export async function runBiome(
  files: ChangedFile[],
  options: { timeoutMs?: number; log?: Logger } = {},
): Promise<Finding[]> {
  const runner = biomeRunnerAvailable();
  if (!runner) {
    return [];
  }
  const targets = files.filter(
    (file) => BIOME_EXTENSIONS.has(extension(file.path)) && file.content !== '',
  );
  if (targets.length === 0) {
    return [];
  }
  const workspace = await createWorkspace('pr-warden-biome');
  try {
    await writeWorkspaceFiles(
      workspace,
      targets.map((file) => ({ path: file.path, content: file.content })),
    );
    await writeWorkspaceFiles(workspace, [{ path: 'biome.json', content: WORKSPACE_CONFIG }]);
    const relative = targets.map((file) => safeRelativePath(file.path));
    const result = await execToFile(
      runner.command,
      [...runner.baseArgs, 'lint', '--reporter=json', ...relative],
      { cwd: workspace, timeoutMs: options.timeoutMs ?? 60_000 },
    );
    if (result.spawnFailed || result.stdout === '') {
      options.log?.(`biome pass failed: ${result.stderr.slice(0, 300)}`);
      return [];
    }
    return parseBiomeReport(result.stdout);
  } finally {
    await removeWorkspace(workspace);
  }
}

/** Parse a biome JSON reporter payload (shape verified against Biome 2.6). */
export function parseBiomeReport(stdout: string): Finding[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout) as unknown;
  } catch {
    return [];
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.diagnostics)) {
    return [];
  }
  const findings: Finding[] = [];
  for (const diagnostic of parsed.diagnostics) {
    if (!isRecord(diagnostic)) {
      continue;
    }
    const category = asString(diagnostic.category);
    const rawSeverity = asString(diagnostic.severity);
    const message = asString(diagnostic.message) ?? 'Biome diagnostic';
    const location = isRecord(diagnostic.location) ? diagnostic.location : null;
    const filePath = location ? asString(location.path) : null;
    const startLine = location && isRecord(location.start) ? asNumber(location.start.line) : null;
    const endLine = location && isRecord(location.end) ? asNumber(location.end.line) : null;
    if (!category || !rawSeverity || !filePath || startLine === null) {
      continue;
    }
    // Only lint diagnostics (and parse/syntax failures) count; formatting and assist output is out of scope.
    if (!category.startsWith('lint/') && category !== 'parse') {
      continue;
    }
    const severity: 'error' | 'warning' | 'info' =
      rawSeverity === 'error' || rawSeverity === 'warning' ? rawSeverity : 'info';
    const parts = category.split('/');
    const group = parts[1] ?? 'unknown';
    const rule = parts[parts.length - 1] ?? 'unknown';
    const mapped = mapBiomeDiagnostic(group, rule, severity);
    findings.push({
      id: `biome:${rule}:${filePath}:${startLine}`,
      file: filePath,
      start_line: startLine,
      end_line: endLine ?? startLine,
      severity: mapped.severity,
      category: mapped.category,
      title: message.slice(0, 200),
      detail: `${message}\nSource: Biome rule ${rule}.`,
      confidence: mapped.confidence,
      source: 'static',
      rule: `biome:${rule}`,
    });
  }
  return findings;
}

function extension(path: string): string {
  const dot = path.lastIndexOf('.');
  return dot === -1 ? '' : path.slice(dot).toLowerCase();
}
