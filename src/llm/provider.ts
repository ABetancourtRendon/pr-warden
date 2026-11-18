import type { Usage } from '../types.js';

export interface LLMToolCall {
  name: string;
  /** Parsed arguments (an unknown payload that the caller validates with zod). */
  args: unknown;
}

export interface LLMRequest {
  system: string;
  user: string;
  toolName: string;
  toolDescription: string;
  toolParameters: Record<string, unknown>;
  temperature?: number;
  /** When non-null this is a retry attempt; the hint explains the previous schema violation. */
  retryHint?: string;
}

export interface LLMResponse {
  toolCall: LLMToolCall | null;
  content: string | null;
  usage: Usage | null;
}

export interface LLMProvider {
  readonly name: string;
  readonly model: string;
  complete(request: LLMRequest): Promise<LLMResponse>;
}
