import { Command, InvalidArgumentError } from 'commander';
import { loadDotEnv, loadWardenFile, resolveConfig } from './config.js';
import type { GitHubApi } from './github.js';
import { createGitHubApi, fetchPullRequest, postPullRequestReview } from './github.js';
import { MockProvider } from './llm/mock.js';
import { OpenAICompatProvider } from './llm/openai-compat.js';
import type { LLMProvider } from './llm/provider.js';
import { runReview } from './review/pipeline.js';
import { renderJson, renderTerminal } from './review/render.js';
import type { ReviewInput, Severity } from './types.js';
import { SEVERITIES, severityAtLeast } from './types.js';

export interface ReviewCommandFlags {
  repo: string;
  pr: number;
  json: boolean;
  config?: string;
  provider?: string;
  noStatic: boolean;
  noLlm: boolean;
  post: boolean;
  failOn?: Severity;
  color: boolean;
  verbose: boolean;
}

export interface ReviewCommandDeps {
  api?: GitHubApi;
  provider?: LLMProvider;
  log?: (message: string) => void;
  write?: (output: string) => void;
}

function parseRepo(value: string): string {
  if (!/^[^/\s]+\/[^/\s]+$/.test(value)) {
    throw new InvalidArgumentError('repo must look like owner/name');
  }
  return value;
}

function parsePr(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new InvalidArgumentError('pr must be a positive integer');
  }
  return parsed;
}

function parseFailOn(value: string): Severity {
  if (!(SEVERITIES as readonly string[]).includes(value)) {
    throw new InvalidArgumentError(`fail-on must be one of ${SEVERITIES.join('|')}`);
  }
  return value as Severity;
}

export function buildProgram(): Command {
  const program = new Command();
  program.name('pr-warden').description('Self-evaluating AI code reviewer').version('0.1.0');

  const review = program.command('review');
  review.description('Review a pull request with static analysis plus an LLM pass');
  review
    .requiredOption('-r, --repo <owner/name>', 'GitHub repository in owner/name form', parseRepo)
    .requiredOption('--pr <number>', 'Pull request number', parsePr)
    .option('--json', 'Print the review as JSON instead of a terminal table')
    .option('--config <path>', 'Path to a .warden.yml config file')
    .option(
      '--provider <preset>',
      'LLM preset (openai|anthropic|gemini|openrouter|groq) or "mock" for offline runs',
    )
    .option('--no-static', 'Skip the static analysis pass')
    .option('--no-llm', 'Skip the LLM pass (static-only review)')
    .option(
      '--fail-on <severity>',
      'Exit with code 1 when findings at this severity or higher exist',
      parseFailOn,
    )
    .option('--no-color', 'Disable colored terminal output')
    .option('--verbose', 'Print full finding details below the table')
    .option(
      '--post',
      'Post the review to the pull request (one grouped summary plus inline comments; needs GITHUB_TOKEN)',
    )
    .action((options: Record<string, unknown>) => {
      void runReviewCommand({
        repo: options.repo as string,
        pr: options.pr as number,
        json: Boolean(options.json),
        config: options.config as string | undefined,
        provider: options.provider as string | undefined,
        noStatic: options.static === false,
        noLlm: options.llm === false,
        post: Boolean(options.post),
        failOn: options.failOn as Severity | undefined,
        color: options.color !== false,
        verbose: Boolean(options.verbose),
      }).then((exitCode: number) => {
        process.exitCode = exitCode === 0 ? undefined : exitCode;
      });
    });
  return program;
}

export async function runReviewCommand(
  flags: ReviewCommandFlags,
  deps: ReviewCommandDeps = {},
): Promise<number> {
  const log = deps.log ?? ((message: string) => console.error(message));
  const write = deps.write ?? ((output: string) => process.stdout.write(output));
  loadDotEnv();

  try {
    const wardenFile = flags.config ? loadWardenFile(flags.config) : loadWardenFile('.warden.yml');
    const resolved = resolveConfig({ file: wardenFile, providerOverride: flags.provider });

    let provider: LLMProvider | null = null;
    if (deps.provider) {
      provider = deps.provider;
    } else if (flags.provider === 'mock') {
      provider = new MockProvider();
    } else if (!flags.noLlm && resolved.provider) {
      provider = new OpenAICompatProvider({
        baseUrl: resolved.provider.baseUrl,
        apiKey: resolved.provider.apiKey,
        model: resolved.provider.model,
        name: resolved.provider.preset,
      });
    } else if (!flags.noLlm) {
      log(`PR-Warden: ${resolved.providerNote}`);
    }

    const [owner, name] = flags.repo.split('/');
    if (!owner || !name) {
      log('PR-Warden: review failed - repo must look like owner/name');
      return 2;
    }
    const api = deps.api ?? createGitHubApi(process.env.GITHUB_TOKEN);
    const input: ReviewInput = await fetchPullRequest(api, owner, name, flags.pr, {
      ignorePaths: resolved.options.ignorePaths,
      log,
    });

    const result = await runReview(input, resolved.options, {
      provider,
      log,
      disableStatic: flags.noStatic,
    });

    if (flags.json) {
      write(renderJson(result));
    } else {
      write(`${renderTerminal(result, { color: flags.color, verbose: flags.verbose })}\n`);
    }

    if (flags.post) {
      const postResult = await postPullRequestReview(
        api,
        owner,
        name,
        flags.pr,
        result,
        input.files,
        {
          maxInlineComments: resolved.options.maxInlineComments,
          log,
        },
      );
      if (!postResult.posted) {
        log(
          `PR-Warden: review posting failed (${postResult.error ?? 'unknown error'}) - the review completed locally`,
        );
      }
    }

    if (
      flags.failOn &&
      result.findings.some((finding) => severityAtLeast(finding.severity, flags.failOn as Severity))
    ) {
      return 1;
    }
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log(`PR-Warden: review failed - ${message}`);
    return 2;
  }
}

export { buildProgram as buildCliProgram };

export function main(argv: string[]): Promise<void> {
  const program = buildProgram();
  return program.parseAsync(argv).then(() => undefined);
}

// Run when invoked directly (node dist/cli.js ...). The bin wrapper calls main() itself.
import { pathToFileURL } from 'node:url';

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  void main(process.argv).catch((error: unknown) => {
    console.error(`PR-Warden: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 2;
  });
}
