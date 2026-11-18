import { spawnSync } from 'node:child_process';
import type { ChangedFile, Finding, Logger } from '../types.js';
import { asNumber, asString, isRecord } from './parse-utils.js';
import { mapRuffDiagnostic } from './severity.js';
import {
  createWorkspace,
  execToFile,
  removeWorkspace,
  safeRelativePath,
  writeWorkspaceFiles,
} from './spawn.js';

const RUFF_EXTENSIONS = new Set(['.py']);

/** The ruff pass activates only when a ruff binary is on PATH (optional Python support). */
export function ruffRunnerAvailable(): string | null {
  const candidates = process.platform === 'win32' ? ['ruff.exe', 'ruff'] : ['ruff'];
  for (const candidate of candidates) {
    const probe = spawnSync(candidate, ['--version'], { timeout: 5_000, windowsHide: true });
    if (probe.error === undefined) {
      return candidate;
    }
  }
  return null;
}

export async function runRuff(
  files: ChangedFile[],
  options: { timeoutMs?: number; log?: Logger } = {},
): Promise<Finding[]> {
  const command = ruffRunnerAvailable();
  if (!command) {
    return [];
  }
  const targets = files.filter(
    (file) => RUFF_EXTENSIONS.has(extension(file.path)) && file.content !== '',
  );
  if (targets.length === 0) {
    return [];
  }
  const workspace = await createWorkspace('pr-warden-ruff');
  try {
    await writeWorkspaceFiles(
      workspace,
      targets.map((file) => ({ path: file.path, content: file.content })),
    );
    const relative = targets.map((file) => safeRelativePath(file.path));
    const result = await execToFile(command, ['check', '--output-format=json', ...relative], {
      cwd: workspace,
      timeoutMs: options.timeoutMs ?? 60_000,
    });
    if (result.spawnFailed || result.stdout === '') {
      options.log?.(`ruff pass failed: ${result.stderr.slice(0, 300)}`);
      return [];
    }
    return parseRuffReport(result.stdout, workspace);
  } finally {
    await removeWorkspace(workspace);
  }
}

/** Parse ruff's --output-format=json payload (a JSON array of violations). */
export function parseRuffReport(stdout: string, workspaceRoot: string): Finding[] {
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
    const code = asString(entry.code);
    const message = asString(entry.message) ?? 'Ruff diagnostic';
    const filename = asString(entry.filename);
    if (!code || !filename) {
      continue;
    }
    const file = stripWorkspaceRoot(filename, workspaceRoot);
    const location = isRecord(entry.location) ? entry.location : null;
    const row = location ? asNumber(location.row) : null;
    const endLocation = isRecord(entry.end_location) ? entry.end_location : null;
    const endRow = endLocation ? (asNumber(endLocation.row) ?? row) : row;
    if (row === null) {
      continue;
    }
    const mapped = mapRuffDiagnostic(code);
    findings.push({
      id: `ruff:${code}:${file}:${row}`,
      file,
      start_line: row,
      end_line: endRow ?? row,
      severity: mapped.severity,
      category: mapped.category,
      title: message.slice(0, 200),
      detail: `${message}\nSource: Ruff rule ${code}.`,
      confidence: mapped.confidence,
      source: 'static',
      rule: `ruff:${code}`,
    });
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
