import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';

export const ManifestBugSchema = z
  .object({
    file: z.string().min(1),
    start_line: z.number().int().min(1),
    end_line: z.number().int().min(1),
    category: z.enum(['bug', 'security', 'performance']),
    description: z.string().min(1),
  })
  .strict();

export const ManifestSchema = z
  .object({
    name: z.string().min(1),
    description: z.string().min(1),
    bugs: z.array(ManifestBugSchema).min(1),
  })
  .strict();

export type Manifest = z.infer<typeof ManifestSchema>;
export type ManifestBug = z.infer<typeof ManifestBugSchema>;

export class BenchManifestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BenchManifestError';
  }
}

/** Load and validate a fixture's manifest.json. */
export async function loadManifest(fixtureDir: string): Promise<Manifest> {
  const manifestPath = path.join(fixtureDir, 'manifest.json');
  let text: string;
  try {
    text = await readFile(manifestPath, 'utf8');
  } catch {
    throw new BenchManifestError(`fixture manifest not readable: ${manifestPath}`);
  }
  const parsed: unknown = JSON.parse(text) as unknown;
  const result = ManifestSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues
      .slice(0, 5)
      .map((issue) => `${issue.path.map(String).join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    throw new BenchManifestError(`fixture manifest failed validation (${manifestPath}): ${issues}`);
  }
  return result.data;
}

/** Discover fixture directories (any direct child of root containing manifest.json), sorted by name. */
export async function discoverFixtures(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const fixtures: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const manifestPath = path.join(root, entry.name, 'manifest.json');
    if (await fileExists(manifestPath)) {
      fixtures.push(path.join(root, entry.name));
    }
  }
  return fixtures.sort();
}

const CODE_EXTENSIONS = new Set([
  '.js',
  '.mjs',
  '.cjs',
  '.jsx',
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
  '.py',
  '.go',
  '.java',
  '.rb',
  '.rs',
  '.sql',
  '.sh',
]);

/** Collect every code file in a fixture (recursively), with paths relative to the fixture root. */
export async function collectFixtureFiles(
  fixtureDir: string,
): Promise<Array<{ path: string; content: string }>> {
  const files: Array<{ path: string; content: string }> = [];
  await walk(fixtureDir, fixtureDir, files);
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return files;
}

async function walk(
  root: string,
  current: string,
  files: Array<{ path: string; content: string }>,
): Promise<void> {
  const entries = await readdir(current, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(current, entry.name);
    if (entry.isDirectory()) {
      await walk(root, entryPath, files);
      continue;
    }
    if (entry.name === 'manifest.json' || entry.name === 'README.md') {
      continue;
    }
    if (!CODE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      continue;
    }
    const content = await readFile(entryPath, 'utf8');
    files.push({ path: path.relative(root, entryPath).replaceAll('\\', '/'), content });
  }
}

async function fileExists(target: string): Promise<boolean> {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}
