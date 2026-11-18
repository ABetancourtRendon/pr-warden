import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'yaml';
import { z } from 'zod';
import { CategorySchema, SeveritySchema } from './schemas.js';
import type { Category, Severity } from './types.js';

/**
 * Provider presets. Every preset speaks the OpenAI-compatible chat-completions
 * format, so a single thin client covers them all.
 *
 * - gemini is the default: free keys from Google AI Studio (https://aistudio.google.com).
 * - openrouter is the second free-tier-friendly option the repo author already has a key for.
 */
export const PROVIDER_PRESETS = {
  openai: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  anthropic: { baseUrl: 'https://api.anthropic.com/v1/', model: 'claude-sonnet-4' },
  gemini: {
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    model: 'gemini-2.5-flash',
  },
  openrouter: { baseUrl: 'https://openrouter.ai/api/v1', model: 'google/gemini-2.5-flash' },
  groq: { baseUrl: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile' },
} as const;

export type PresetName = keyof typeof PROVIDER_PRESETS;

export const DEFAULT_PRESET: PresetName = 'gemini';

export class WardenConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WardenConfigError';
  }
}

const WardenFileSchema = z.object({
  categories: z.array(CategorySchema).min(1).optional(),
  min_severity: SeveritySchema.optional(),
  ignore_paths: z.array(z.string().min(1)).optional(),
  custom_rules: z.array(z.string().min(1)).optional(),
  max_inline_comments: z.number().int().min(0).max(50).optional(),
  provider: z
    .object({
      preset: z.string().min(1).optional(),
      base_url: z.string().min(1).optional(),
      model: z.string().min(1).optional(),
    })
    .optional(),
});

export interface WardenFile {
  categories?: Category[];
  min_severity?: Severity;
  ignore_paths?: string[];
  custom_rules?: string[];
  max_inline_comments?: number;
  provider?: { preset?: string; base_url?: string; model?: string };
}

/** Parse and validate a .warden.yml document; throws WardenConfigError on invalid YAML or schema violations. */
export function parseWardenFile(text: string): WardenFile {
  let document: unknown;
  try {
    document = parse(text) ?? {};
  } catch (error) {
    throw new WardenConfigError(`.warden.yml is not valid YAML: ${(error as Error).message}`);
  }
  const result = WardenFileSchema.safeParse(document);
  if (!result.success) {
    const issues = result.error.issues
      .slice(0, 5)
      .map((issue) => `${issue.path.map(String).join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    throw new WardenConfigError(`.warden.yml failed validation: ${issues}`);
  }
  return result.data as WardenFile;
}

/** Load .warden.yml from an explicit path, or null when the file does not exist. */
export function loadWardenFile(path: string): WardenFile | null {
  const absolute = resolve(path);
  if (!existsSync(absolute)) {
    return null;
  }
  const text = readFileSync(absolute, 'utf8');
  return parseWardenFile(text);
}

export interface WardenOptions {
  categories: Category[];
  minSeverity: Severity;
  ignorePaths: string[];
  customRules: string[];
  maxInlineComments: number;
}

export const DEFAULT_WARDEN_OPTIONS: WardenOptions = {
  categories: ['bug', 'security', 'performance', 'maintainability', 'style'],
  minSeverity: 'info',
  ignorePaths: ['node_modules/**', 'dist/**', 'coverage/**'],
  customRules: [],
  maxInlineComments: 20,
};

export function mergeWardenOptions(file: WardenFile | null): WardenOptions {
  if (!file) {
    return { ...DEFAULT_WARDEN_OPTIONS };
  }
  return {
    categories: file.categories ?? DEFAULT_WARDEN_OPTIONS.categories,
    minSeverity: file.min_severity ?? DEFAULT_WARDEN_OPTIONS.minSeverity,
    ignorePaths: file.ignore_paths ?? DEFAULT_WARDEN_OPTIONS.ignorePaths,
    customRules: file.custom_rules ?? DEFAULT_WARDEN_OPTIONS.customRules,
    maxInlineComments: file.max_inline_comments ?? DEFAULT_WARDEN_OPTIONS.maxInlineComments,
  };
}

export interface ProviderConfig {
  preset: PresetName | 'custom';
  baseUrl: string;
  model: string;
  apiKey: string;
}

export interface ResolvedConfig {
  options: WardenOptions;
  /** Null when no LLM_API_KEY is configured: the review runs static-only. */
  provider: ProviderConfig | null;
  providerNote: string;
}

type EnvRecord = Record<string, string | undefined>;

/**
 * Resolve the effective configuration. Precedence: CLI provider override > environment
 * variables > .warden.yml provider section > the gemini preset default.
 */
export function resolveConfig(input: {
  file: WardenFile | null;
  env?: EnvRecord;
  providerOverride?: string;
}): ResolvedConfig {
  const env = input.env ?? process.env;

  let presetName: PresetName | 'custom' = DEFAULT_PRESET;
  if (input.providerOverride && input.providerOverride in PROVIDER_PRESETS) {
    presetName = input.providerOverride as PresetName;
  } else if (input.providerOverride === 'custom') {
    presetName = 'custom';
  } else if (input.file?.provider?.preset && input.file.provider.preset in PROVIDER_PRESETS) {
    presetName = input.file.provider.preset as PresetName;
  } else if (input.file?.provider?.base_url || input.file?.provider?.model) {
    presetName = 'custom';
  }

  const preset = presetName === 'custom' ? null : PROVIDER_PRESETS[presetName];
  const baseUrl = env.LLM_BASE_URL ?? input.file?.provider?.base_url ?? preset?.baseUrl ?? '';
  const model = env.LLM_MODEL ?? input.file?.provider?.model ?? preset?.model ?? '';
  const apiKey = env.LLM_API_KEY ?? '';

  const options = mergeWardenOptions(input.file);

  if (!apiKey) {
    return {
      options,
      provider: null,
      providerNote: `LLM disabled: LLM_API_KEY is not set (preset ${presetName}). Static-only review.`,
    };
  }
  return {
    options,
    provider: { preset: presetName, baseUrl, model, apiKey },
    providerNote: `LLM enabled: preset ${presetName}, model ${model || '(unset)'} via ${baseUrl}`,
  };
}

/**
 * Tiny dotenv loader (no dependency): sets variables from a .env file only when
 * they are not already present in the environment.
 */
export function loadDotEnv(path = '.env'): number {
  if (!existsSync(resolve(path))) {
    return 0;
  }
  const text = readFileSync(resolve(path), 'utf8');
  let loaded = 0;
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) {
      continue;
    }
    const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) {
      continue;
    }
    const key = match[1] ?? '';
    let value = match[2] ?? '';
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = value;
      loaded += 1;
    }
  }
  return loaded;
}

/** Convert a simple gitignore-style glob (supports *, ?, **) into a RegExp. */
export function globToRegExp(pattern: string): RegExp {
  let source = '';
  let index = 0;
  while (index < pattern.length) {
    const char = pattern[index];
    if (char === '*') {
      if (pattern.startsWith('**', index)) {
        source += '.*';
        index += 2;
      } else {
        source += '[^/]*';
        index += 1;
      }
    } else if (char === '?') {
      source += '[^/]';
      index += 1;
    } else {
      source += escapeRegExp(char ?? '');
      index += 1;
    }
  }
  return new RegExp(`^${source}$`);
}

function escapeRegExp(char: string): string {
  return char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * True when a repo-relative file path matches any ignore pattern. Patterns that
 * contain a slash are anchored to the path root; bare patterns match the
 * basename at any depth (gitignore-like behavior).
 */
export function matchesIgnorePath(path: string, patterns: string[]): boolean {
  const normalized = path.replaceAll('\\', '/');
  const basename = normalized.slice(normalized.lastIndexOf('/') + 1);
  return patterns.some((pattern) => {
    if (pattern.includes('/')) {
      return globToRegExp(pattern).test(normalized);
    }
    return globToRegExp(pattern).test(basename);
  });
}
