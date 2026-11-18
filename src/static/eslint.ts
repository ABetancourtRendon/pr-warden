import { pathToFileURL } from 'node:url';
import type { ChangedFile, Finding, Logger } from '../types.js';
import { asNumber, asString, isRecord } from './parse-utils.js';
import { mapEslintDiagnostic } from './severity.js';
import {
  createWorkspace,
  execToFile,
  removeWorkspace,
  resolveModuleFile,
  safeRelativePath,
  writeWorkspaceFiles,
} from './spawn.js';

const ESLINT_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.jsx']);

/**
 * The eslint pass is opportunistic: it activates only when both eslint and
 * @eslint/js happen to be resolvable in the runtime environment (for example
 * when PR-Warden is installed next to a project that uses eslint). It never
 * fails a review; unavailability just skips the pass.
 */
export function eslintRunnerAvailable(): {
  command: string;
  binPath: string;
  config: string;
} | null {
  const binPath = resolveModuleFile('eslint/bin/eslint.js');
  const jsPackage = resolveModuleFile('@eslint/js');
  if (!binPath || !jsPackage) {
    return null;
  }
  const importPath = pathToFileURL(jsPackage).href;
  const config = [
    `import js from '${importPath}';`,
    "export default [js.configs.recommended, { languageOptions: { ecmaVersion: 'latest', sourceType: 'module' } }];",
    '',
  ].join('\n');
  return { command: process.execPath, binPath, config };
}

export async function runEslint(
  files: ChangedFile[],
  options: { timeoutMs?: number; log?: Logger } = {},
): Promise<Finding[]> {
  const runner = eslintRunnerAvailable();
  if (!runner) {
    return [];
  }
  const targets = files.filter(
    (file) => ESLINT_EXTENSIONS.has(extension(file.path)) && file.content !== '',
  );
  if (targets.length === 0) {
    return [];
  }
  const workspace = await createWorkspace('pr-warden-eslint');
  try {
    await writeWorkspaceFiles(
      workspace,
      targets.map((file) => ({ path: file.path, content: file.content })),
    );
    await writeWorkspaceFiles(workspace, [{ path: 'eslint.config.mjs', content: runner.config }]);
    const relative = targets.map((file) => safeRelativePath(file.path));
    const result = await execToFile(
      runner.command,
      [runner.binPath, '--format', 'json', '--no-warn-ignored', ...relative],
      { cwd: workspace, timeoutMs: options.timeoutMs ?? 60_000 },
    );
    if (result.spawnFailed || result.stdout === '') {
      options.log?.(`eslint pass failed: ${result.stderr.slice(0, 300)}`);
      return [];
    }
    return parseEslintReport(result.stdout, workspace);
  } finally {
    await removeWorkspace(workspace);
  }
}

/** Parse eslint's --format json payload into findings. */
export function parseEslintReport(stdout: string, workspaceRoot: string): Finding[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout) as unknown;
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) {
    return [];
  }
  const findings: Finding[] = [];
  for (const entry of parsed) {
    if (!isRecord(entry)) {
      continue;
    }
    const absolutePath = asString(entry.filePath);
    if (!absolutePath) {
      continue;
    }
    const file = stripWorkspaceRoot(absolutePath, workspaceRoot);
    const messages = Array.isArray(entry.messages) ? entry.messages : [];
    for (const message of messages) {
      if (!isRecord(message)) {
        continue;
      }
      const ruleId = asString(message.ruleId);
      const severity = asNumber(message.severity);
      const text = asString(message.message) ?? 'ESLint diagnostic';
      const line = asNumber(message.line);
      if (severity === null || line === null) {
        continue;
      }
      const endLine = asNumber(message.endLine) ?? line;
      const mapped = mapEslintDiagnostic(ruleId, severity);
      findings.push({
        id: `eslint:${ruleId ?? 'unknown'}:${file}:${line}`,
        file,
        start_line: line,
        end_line: endLine,
        severity: mapped.severity,
        category: mapped.category,
        title: text.slice(0, 200),
        detail: `${text}\nSource: ESLint rule ${ruleId ?? 'unknown'}.`,
        confidence: mapped.confidence,
        source: 'static',
        rule: `eslint:${ruleId ?? 'unknown'}`,
      });
    }
  }
  return findings;
}

function stripWorkspaceRoot(file: string, workspaceRoot: string): string {
  for (const separator of ['/', '\\']) {
    const prefix = `${workspaceRoot}${separator}`;
    if (file.startsWith(prefix)) {
      return file.slice(prefix.length).replaceAll('\\', '/');
    }
  }
  return file;
}

function extension(path: string): string {
  const dot = path.lastIndexOf('.');
  return dot === -1 ? '' : path.slice(dot).toLowerCase();
}
