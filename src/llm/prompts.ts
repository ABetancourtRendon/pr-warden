import type { ChangedFile, ReviewInput } from '../types.js';

const MAX_PROMPT_CHARS = 90_000;
const MAX_FILE_LINES = 400;
const MAX_FILE_CHARS = 8_000;

/**
 * System prompt for the strict senior reviewer persona. Custom natural-language
 * rules from .warden.yml are appended verbatim.
 */
export function buildSystemPrompt(customRules: string[]): string {
  const rules =
    customRules.length === 0
      ? ''
      : `\n\nRules from the repository's .warden.yml (treat them as house style, on top of everything above):\n${customRules
          .map((rule, index) => `${index + 1}. ${rule}`)
          .join('\n')}`;
  return `You are PR-Warden, a strict senior code reviewer performing pull-request review.
Review the changed code like a principal engineer who cares about correctness, security, and maintainability.

Calibration rules:
- Report ONLY defects you can point to in the provided files with concrete line numbers (new-file numbering).
- Prefer precision over recall: never invent issues to seem thorough. If the change is clean, return an empty findings list.
- Never report missing tests, missing documentation, or stylistic nitpicks that a configured linter would already catch.
- Do not report issues in files or lines outside the provided changed files; such findings are dropped automatically.

Severity taxonomy:
- critical: exploitable security flaw, data loss, or a defect that breaks the system outright.
- major: logic bug, breaking contract, or a realistic runtime failure.
- minor: correctness risk at boundaries, edge-case handling, or a clear performance smell.
- info: noteworthy but low-risk observation.

Category taxonomy: bug | security | performance | maintainability | style.

For every finding: title is a short imperative summary; detail explains the defect and its impact;
suggested_fix_diff is a small unified diff (--- a/<file> / +++ b/<file>) when you are confident in the fix, otherwise omit it;
confidence is your subjective probability (0.0-1.0) that the finding is real.${rules}

Respond exclusively by calling the emit_findings tool with the findings array. No prose.`;
}

function numberLines(content: string): string {
  const lines = content.split('\n');
  if (lines.length > 1 && lines[lines.length - 1] === '') {
    lines.pop();
  }
  return lines.map((line, index) => `${String(index + 1).padStart(4, ' ')} | ${line}`).join('\n');
}

/** Build the user prompt containing PR metadata plus per-file numbered content or hunks, with a hard size cap. */
export function buildUserPrompt(input: ReviewInput): string {
  const sections: string[] = [];
  const header: string[] = [`Repository: ${input.repo}`];
  if (input.pr !== null) {
    header.push(`Pull request #${input.pr}`);
  }
  header.push(`Title: ${input.title}`);
  sections.push(header.join('\n'));

  const body = input.body.trim().slice(0, 600);
  if (body !== '') {
    sections.push(`PR description (trimmed):\n${body}`);
  }

  const summary = input.files
    .map(
      (file) =>
        `- ${file.path} (${file.status}, +${file.additions}/-${file.deletions}${file.content === '' ? ', content unavailable' : ''})`,
    )
    .join('\n');
  sections.push(`Changed files (${input.files.length}):\n${summary}`);

  let budget = MAX_PROMPT_CHARS - sections.join('\n\n').length;
  for (const file of input.files) {
    if (budget <= 0) {
      sections.push('[prompt truncated: total size cap reached]');
      break;
    }
    const section = renderFileSection(file, budget);
    budget -= section.length;
    sections.push(section);
  }

  sections.push(
    'Line numbers in findings MUST reference the NEW version of each file, exactly as numbered above. Findings for files not listed here are dropped.',
  );

  return sections.join('\n\n');
}

function renderFileSection(file: ChangedFile, budget: number): string {
  const title = `## File: ${file.path} (${file.status})`;
  if (file.content === '') {
    return `${title}\n(content unavailable - binary or too large to fetch)`;
  }
  const numbered = numberLines(file.content);
  if (numbered.length <= MAX_FILE_CHARS && numbered.length <= budget) {
    return `${title}\n\`\`\`\n${numbered}\n\`\`\``;
  }
  if (file.patch && file.patch.length <= budget) {
    return `${title}\nFile too large for full listing; hunks only:\n\`\`\`diff\n${file.patch}\n\`\`\``;
  }
  const approxLines =
    numbered.length > MAX_FILE_CHARS || countApproxLines(file.content) > MAX_FILE_LINES;
  if (approxLines) {
    return `${title}\n(file exceeds ${MAX_FILE_LINES} lines - omitted from prompt)`;
  }
  return `${title}\n(file omitted from prompt)`;
}

function countApproxLines(content: string): number {
  return content === '' ? 0 : content.split('\n').length;
}
