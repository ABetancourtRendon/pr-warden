import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);

export interface ExecResult {
  stdout: string;
  stderr: string;
  /** Process exit code, or null when the command could not be spawned at all. */
  exitCode: number | null;
  spawnFailed: boolean;
}

/** Run a command capturing output; linter exit code 1 (diagnostics found) is a normal outcome. */
export function execToFile(
  command: string,
  args: string[],
  options: { cwd?: string; timeoutMs: number },
): Promise<ExecResult> {
  return new Promise((resolvePromise) => {
    execFile(
      command,
      args,
      {
        cwd: options.cwd,
        timeout: options.timeoutMs,
        maxBuffer: 20 * 1024 * 1024,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        const code = (error as NodeJS.ErrnoException | null)?.code;
        if (error && typeof code !== 'number') {
          resolvePromise({ stdout: '', stderr: String(stderr), exitCode: null, spawnFailed: true });
          return;
        }
        resolvePromise({
          stdout: String(stdout),
          stderr: String(stderr),
          exitCode: typeof code === 'number' ? code : 0,
          spawnFailed: false,
        });
      },
    );
  });
}

/** Resolve a file inside an installed package (works from both src and dist). */
export function resolveModuleFile(specifier: string): string | null {
  try {
    return require.resolve(specifier);
  } catch {
    return null;
  }
}

export async function createWorkspace(prefix: string): Promise<string> {
  return mkdtemp(path.join(tmpdir(), `${prefix}-`));
}

export async function removeWorkspace(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
}

/** Normalize a repo-relative path so it can never escape the workspace directory. */
export function safeRelativePath(input: string): string {
  const normalized = input
    .replaceAll('\\', '/')
    .replace(/^\/+/, '')
    .replace(/^\.?\//, '');
  const parts = normalized
    .split('/')
    .filter((part) => part !== '' && part !== '.' && part !== '..');
  return parts.join('/');
}

export async function writeWorkspaceFiles(
  dir: string,
  files: Array<{ path: string; content: string }>,
): Promise<void> {
  for (const file of files) {
    const relative = safeRelativePath(file.path);
    if (relative === '') {
      continue;
    }
    const target = path.join(dir, relative);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, file.content, 'utf8');
  }
}
