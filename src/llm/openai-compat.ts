import OpenAI from 'openai';
import type { LLMProvider, LLMRequest, LLMResponse } from './provider.js';

function safeJsonParse(text: string | undefined | null): unknown {
  if (typeof text !== 'string' || text === '') {
    return null;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

/**
 * The one thin LLM client every provider goes through. It speaks the
 * OpenAI-compatible chat-completions format, which covers OpenAI, Anthropic's
 * compatibility endpoint, Google Gemini's OpenAI-compatible endpoint, OpenRouter,
 * Groq, and anything else that mimics the same shape.
 */
export class OpenAICompatProvider implements LLMProvider {
  readonly name: string;
  readonly model: string;
  private readonly client: OpenAI;

  constructor(config: {
    baseUrl: string;
    apiKey: string;
    model: string;
    name?: string;
    timeoutMs?: number;
  }) {
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseUrl,
      maxRetries: 0,
      timeout: config.timeoutMs ?? 120_000,
    });
    this.model = config.model;
    this.name = config.name ?? 'openai-compatible';
  }

  async complete(request: LLMRequest): Promise<LLMResponse> {
    const messages: Array<{ role: 'system' | 'user'; content: string }> = [
      { role: 'system', content: request.system },
      { role: 'user', content: request.user },
    ];
    if (request.retryHint) {
      messages.push({
        role: 'user',
        content: `Your previous emit_findings response failed validation: ${request.retryHint}\nRespond again with a corrected emit_findings tool call.`,
      });
    }

    const response = await this.client.chat.completions.create({
      model: this.model,
      messages,
      temperature: request.temperature ?? 0.1,
      tools: [
        {
          type: 'function',
          function: {
            name: request.toolName,
            description: request.toolDescription,
            parameters: request.toolParameters,
          },
        },
      ],
      tool_choice: { type: 'function', function: { name: request.toolName } },
    });

    const message = response.choices[0]?.message;
    const toolCall = message?.tool_calls?.[0];
    const usage = response.usage
      ? {
          promptTokens: response.usage.prompt_tokens ?? 0,
          completionTokens: response.usage.completion_tokens ?? 0,
        }
      : null;

    if (toolCall && toolCall.type === 'function' && typeof toolCall.function?.name === 'string') {
      return {
        toolCall: {
          name: toolCall.function.name,
          args: safeJsonParse(toolCall.function.arguments),
        },
        content: message?.content ?? null,
        usage,
      };
    }
    return { toolCall: null, content: message?.content ?? null, usage };
  }
}
