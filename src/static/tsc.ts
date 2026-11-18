import type { ChangedFile, Finding, Logger } from '../types.js';
import { asString } from './parse-utils.js';
import { mapTscDiagnostic } from './severity.js';
import {
  createWorkspace,
  execToFile,
  removeWorkspace,
  resolveModuleFile,
  safeRelativePath,
  writeWorkspaceFiles,
} from './spawn.js';

const TSC_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts']);

/**
 * The tsc pass is active only when typescript is installed in the runtime
 * environment (it is a devDependency of this repo, so dogfooding and CI get it;
 * published-package consumers without typescript simply skip this pass).
 */
export function tscRunnerAvailable(): string | null {
  return resolveModuleFile('typescript/lib/tsc.js');
}

function buildTsconfig(files: string[]): string {
  return JSON.stringify({
    compilerOptions: {
      noEmit: true,
      skipLibCheck: true,
      strict: false,
      target: 'es2022',
      module: 'esnext',
      moduleResolution: 'bundler',
      allowJs: false,
      checkJs: false,
      types: [],
    },
    files,
  });
}

export async function runTsc(
  files: ChangedFile[],
  options: { timeoutMs?: number; log?: Logger } = {},
): Promise<Finding[]> {
  const tscJs = tscRunnerAvailable();
  if (!tscJs) {
    return [];
  }
  const targets = files.filter(
    (file) => TSC_EXTENSIONS.has(extension(file.path)) && file.content !== '',
  );
  if (targets.length === 0) {
    return [];
  }
  const workspace = await createWorkspace('pr-warden-tsc');
  try {
    await writeWorkspaceFiles(
      workspace,
      targets.map((file) => ({ path: file.path, content: file.content })),
    );
    const relative = targets.map((file) => safeRelativePath(file.path));
    await writeWorkspaceFiles(workspace, [
      { path: 'tsconfig.json', content: buildTsconfig(relative) },
    ]);
    const result = await execToFile(
      process.execPath,
      [tscJs, '-p', workspace, '--pretty', 'false'],
      {
        cwd: workspace,
        timeoutMs: options.timeoutMs ?? 90_000,
      },
    );
    if (result.spawnFailed) {
      options.log?.('tsc pass could not run');
      return [];
    }
    return parseTscOutput(result.stdout + result.stderr);
  } finally {
    await removeWorkspace(workspace);
  }
}

const TSC_LINE = /^([^(]+)\((\d+),\s*(\d+)\): (error|warning) (TS\d+): (.*)$/;

/** Parse plain tsc diagnostic lines like `src/a.ts(1,7): error TS2322: message`. */
export function parseTscOutput(output: string): Finding[] {
  const findings: Finding[] = [];
  for (const rawLine of output.split('\n')) {
    const match = TSC_LINE.exec(rawLine.trim());
    if (!match) {
      continue;
    }
    const file = asString(match[1]);
    const line = Number(match[2]);
    const rawCode = asString(match[5]) ?? '';
    const code = rawCode.replace(/^TS/, '');
    const message = asString(match[6]) ?? 'TypeScript diagnostic';
    if (!file || code === '' || !Number.isFinite(line)) {
      continue;
    }
    const mapped = mapTscDiagnostic(code);
    if (!mapped) {
      continue;
    }
    findings.push({
      id: `tsc:TS${code}:${file}:${line}`,
      file,
      start_line: line,
      end_line: line,
      severity: mapped.severity,
      category: mapped.category,
      title: message.slice(0, 200),
      detail: `${message}\nSource: TypeScript compiler error TS${code}.`,
      confidence: mapped.confidence,
      source: 'static',
      rule: `tsc:TS${code}`,
    });
  }
  return findings;
}

function extension(path: string): string {
  const dot = path.lastIndexOf('.');
  return dot === -1 ? '' : path.slice(dot).toLowerCase();
}
