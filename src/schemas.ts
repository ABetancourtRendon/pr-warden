import { z } from 'zod';
import type { ChangedFile, Finding } from './types.js';
import { CATEGORIES, SEVERITIES } from './types.js';

export const SeveritySchema = z.enum(SEVERITIES);
export const CategorySchema = z.enum(CATEGORIES);

/**
 * Shape of each item the LLM must emit inside the `emit_findings` tool call.
 * `id` is optional because the model is bad at generating stable ids; we assign our own.
 */
export const LlmFindingSchema = z.object({
  id: z.string().min(1).optional(),
  file: z.string().min(1),
  start_line: z.number().int().min(1),
  end_line: z.number().int().min(1),
  severity: SeveritySchema,
  category: CategorySchema,
  title: z.string().min(3).max(200),
  detail: z.string().min(5).max(4000),
  suggested_fix_diff: z.string().max(20000).optional(),
  confidence: z.number().min(0).max(1).optional(),
});

export const EmitFindingsPayload = z.object({
  findings: z.array(LlmFindingSchema),
});

export type EmitFindingsPayload = z.infer<typeof EmitFindingsPayload>;

/** JSON Schema (draft-7) for the `emit_findings` tool parameters, derived from the zod schema so both stay in sync. */
export const emitFindingsJsonSchema: Record<string, unknown> = z.toJSONSchema(EmitFindingsPayload, {
  io: 'input',
  target: 'draft-7',
}) as unknown as Record<string, unknown>;

/** Short, human-readable summary of zod issues, used as feedback for the one retry. */
export function summarizeIssues(error: z.ZodError): string {
  const issues = error.issues.slice(0, 5).map((issue) => {
    const path = issue.path.map(String).join('.') || '(root)';
    return `${path}: ${issue.message}`;
  });
  const suffix =
    error.issues.length > issues.length ? ` (+${error.issues.length - issues.length} more)` : '';
  return issues.join('; ') + suffix;
}

export function countLines(content: string): number {
  if (content === '') {
    return 0;
  }
  const lines = content.split('\n');
  if (lines.length > 1 && lines[lines.length - 1] === '') {
    lines.pop();
  }
  return lines.length;
}

/**
 * Convert validated LLM payload items into Findings, dropping items that point at
 * files we did not review and clamping line ranges to the real file length.
 */
export function normalizeLlmFindings(
  payload: EmitFindingsPayload,
  files: ChangedFile[],
): { findings: Finding[]; dropped: number } {
  const byPath = new Map<string, ChangedFile>();
  for (const file of files) {
    byPath.set(file.path, file);
    byPath.set(normalizePath(file.path), file);
  }

  const findings: Finding[] = [];
  let dropped = 0;
  let sequence = 0;

  for (const raw of payload.findings) {
    const file = byPath.get(raw.file) ?? byPath.get(normalizePath(raw.file));
    if (!file || file.content === '') {
      dropped += 1;
      continue;
    }
    const totalLines = countLines(file.content);
    if (totalLines === 0) {
      dropped += 1;
      continue;
    }
    let start = Math.max(1, Math.min(raw.start_line, totalLines));
    let end = Math.max(1, Math.min(raw.end_line, totalLines));
    if (end < start) {
      const swap = start;
      start = end;
      end = swap;
    }
    sequence += 1;
    findings.push({
      id: `llm-${sequence}`,
      file: file.path,
      start_line: start,
      end_line: end,
      severity: raw.severity,
      category: raw.category,
      title: raw.title.slice(0, 200),
      detail: raw.detail.slice(0, 4000),
      suggested_fix_diff: raw.suggested_fix_diff,
      confidence: raw.confidence ?? 0.5,
      source: 'llm',
    });
  }
  return { findings, dropped };
}

function normalizePath(path: string): string {
  return path.replaceAll('\\', '/').replace(/^\.\//, '');
}
