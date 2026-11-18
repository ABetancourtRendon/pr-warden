import { countLines } from './schemas.js';
import type { ChangedFile, ChangedFileStatus } from './types.js';

export interface ParsedFileDiff {
  path: string;
  previousPath: string | null;
  status: ChangedFileStatus;
  additions: number;
  deletions: number;
  commentableLines: Set<number>;
}

const HUNK_HEADER = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/;
const DIFF_GIT = /^diff --git a\/(.+?) b\/(.+)$/;
const RENAME_FROM = /^rename from (.+)$/;
const RENAME_TO = /^rename to (.+)$/;

/**
 * Deterministic unified-diff walker. Self-contained on purpose: parse-diff 0.12
 * mishandles multi-hunk patches (content after a second hunk header gets lost),
 * so PR-Warden ships its own small parser instead.
 */
export function parseDiffFiles(diffText: string): ParsedFileDiff[] {
  const lines = diffText.split('\n');
  const files: ParsedFileDiff[] = [];

  let oldPath: string | null = null;
  let newPath: string | null = null;
  let isNew = false;
  let isDeleted = false;
  let renamedFrom: string | null = null;
  let renamedTo: string | null = null;
  let sawFile = false;
  let newCounter: number | null = null;
  const commentableLines = new Set<number>();
  let additions = 0;
  let deletions = 0;

  const commit = () => {
    if (!sawFile) {
      return;
    }
    const path = renamedTo ?? newPath ?? oldPath ?? '';
    if (path === '' || path === '/dev/null') {
      return;
    }
    const status: ChangedFileStatus = isDeleted
      ? 'removed'
      : isNew
        ? 'added'
        : renamedTo !== null && renamedFrom !== null && renamedFrom !== renamedTo
          ? 'renamed'
          : 'modified';
    files.push({
      path,
      previousPath: status === 'renamed' ? renamedFrom : null,
      status,
      additions,
      deletions,
      commentableLines,
    });
  };

  const resetFile = () => {
    oldPath = null;
    newPath = null;
    isNew = false;
    isDeleted = false;
    renamedFrom = null;
    renamedTo = null;
    sawFile = true;
    newCounter = null;
    additions = 0;
    deletions = 0;
  };

  for (const rawLine of lines) {
    const line = rawLine.replace(/\r$/, '');

    const diffMatch = DIFF_GIT.exec(line);
    if (diffMatch) {
      commit();
      resetFile();
      oldPath = diffMatch[1] ?? null;
      newPath = diffMatch[2] ?? null;
      continue;
    }
    if (line.startsWith('new file mode')) {
      isNew = true;
      continue;
    }
    if (line.startsWith('deleted file mode')) {
      isDeleted = true;
      continue;
    }
    const renameFrom = RENAME_FROM.exec(line);
    if (renameFrom) {
      renamedFrom = renameFrom[1] ?? null;
      continue;
    }
    const renameTo = RENAME_TO.exec(line);
    if (renameTo) {
      renamedTo = renameTo[1] ?? null;
      continue;
    }
    if (line.startsWith('--- ')) {
      const target = stripAbMarker(line.slice(4));
      if (target === '/dev/null') {
        isNew = true;
      } else if (oldPath === null) {
        oldPath = target;
      }
      sawFile = true;
      continue;
    }
    if (line.startsWith('+++ ')) {
      const target = stripAbMarker(line.slice(4));
      if (target === '/dev/null') {
        isDeleted = true;
      } else {
        newPath = target;
      }
      sawFile = true;
      continue;
    }
    if (
      line.startsWith('index ') ||
      line.startsWith('old mode') ||
      line.startsWith('new mode') ||
      line.startsWith('similarity index') ||
      line.startsWith('dissimilarity index')
    ) {
      continue;
    }

    const hunkMatch = HUNK_HEADER.exec(line);
    if (hunkMatch) {
      newCounter = Number.parseInt(hunkMatch[1] ?? '1', 10);
      continue;
    }
    if (newCounter === null) {
      continue;
    }
    if (line.startsWith('+')) {
      commentableLines.add(newCounter);
      newCounter += 1;
      additions += 1;
      continue;
    }
    if (line.startsWith('-')) {
      deletions += 1;
      continue;
    }
    if (line.startsWith(' ')) {
      commentableLines.add(newCounter);
      newCounter += 1;
    }
    // Empty lines and "\ No newline at end of file" markers carry no line content.
  }
  commit();
  return files;
}

/** Parse a single file's raw patch hunks (GitHub list-files patch format) into commentable new-file lines. */
export function commentableLinesFromPatch(patch: string): Set<number> {
  const lines = patch.split('\n');
  const commentableLines = new Set<number>();
  let newCounter: number | null = null;
  for (const rawLine of lines) {
    const line = rawLine.replace(/\r$/, '');
    const hunkMatch = HUNK_HEADER.exec(line);
    if (hunkMatch) {
      newCounter = Number.parseInt(hunkMatch[1] ?? '1', 10);
      continue;
    }
    if (newCounter === null) {
      continue;
    }
    if (line.startsWith('+')) {
      commentableLines.add(newCounter);
      newCounter += 1;
      continue;
    }
    if (line.startsWith(' ')) {
      commentableLines.add(newCounter);
      newCounter += 1;
    }
  }
  return commentableLines;
}

/** Build a synthetic ChangedFile where the whole file content counts as newly added (used by the benchmark). */
export function syntheticChangedFile(path: string, content: string): ChangedFile {
  const lineCount = countLines(content);
  const commentableLines = new Set<number>();
  for (let line = 1; line <= lineCount; line += 1) {
    commentableLines.add(line);
  }
  return {
    path,
    status: 'added',
    content,
    additions: lineCount,
    deletions: 0,
    commentableLines,
  };
}

function stripAbMarker(value: string): string {
  const trimmed = value.trim();
  return trimmed.startsWith('a/') || trimmed.startsWith('b/') ? trimmed.slice(2) : trimmed;
}
