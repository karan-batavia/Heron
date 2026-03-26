import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import type { LLMConfig } from '../config/schema.js';

export interface LLMClient {
  chat(systemPrompt: string, userMessage: string): Promise<string>;
}

class AnthropicLLMClient implements LLMClient {
  private client: Anthropic;
  private model: string;

  constructor(apiKey: string, model: string) {
    this.client = new Anthropic({ apiKey });
    this.model = model;
  }

  async chat(systemPrompt: string, userMessage: string): Promise<string> {
    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    });

    const block = response.content[0];
    if (block.type !== 'text') {
      throw new Error('Unexpected response type from Anthropic');
    }
    return block.text;
  }
}

class OpenAILLMClient implements LLMClient {
  private client: OpenAI;
  private model: string;

  constructor(apiKey: string, model: string) {
    this.client = new OpenAI({ apiKey });
    this.model = model;
  }

  async chat(systemPrompt: string, userMessage: string): Promise<string> {
    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
    });

    return response.choices[0]?.message?.content ?? '';
  }
}

export function createLLMClient(config: LLMConfig): LLMClient {
  const apiKey = config.apiKey ?? process.env.HERON_LLM_API_KEY;
  if (!apiKey) {
    throw new Error(
      'LLM API key is required. Set it in config, --llm-key flag, or HERON_LLM_API_KEY env var.',
    );
  }

  if (config.provider === 'anthropic') {
    return new AnthropicLLMClient(apiKey, config.model);
  }
  return new OpenAILLMClient(apiKey, config.model);
}
