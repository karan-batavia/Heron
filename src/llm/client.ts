import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import type { LLMConfig } from '../config/schema.js';
import { resolveApiKey } from '../auth/index.js';

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

class GeminiLLMClient implements LLMClient {
  private apiKey: string;
  private model: string;

  constructor(apiKey: string, model: string) {
    this.apiKey = apiKey;
    this.model = model;
  }

  async chat(systemPrompt: string, userMessage: string): Promise<string> {
    // Use Gemini REST API directly to avoid extra dependency
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: 'user', parts: [{ text: userMessage }] }],
        generationConfig: { maxOutputTokens: 4096 },
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Gemini API error (${response.status}): ${err}`);
    }

    const data = await response.json() as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };

    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      throw new Error('No text in Gemini response');
    }
    return text;
  }
}

/**
 * Create an LLM client. Resolves API key in this order:
 * 1. Explicit config.apiKey (from --llm-key flag or config file)
 * 2. HERON_LLM_API_KEY env var
 * 3. Stored credentials from `heron login` (~/.heron/auth.json)
 */
export async function createLLMClient(config: LLMConfig): Promise<LLMClient> {
  let apiKey = config.apiKey ?? process.env.HERON_LLM_API_KEY;

  // Fallback to stored credentials
  if (!apiKey) {
    apiKey = await resolveApiKey(config.provider);
  }

  if (!apiKey) {
    throw new Error(
      `No API key found for ${config.provider}. Use one of:\n` +
      `  1. --llm-key <key>\n` +
      `  2. HERON_LLM_API_KEY env var\n` +
      `  3. heron login ${config.provider}`,
    );
  }

  switch (config.provider) {
    case 'anthropic':
      return new AnthropicLLMClient(apiKey, config.model);
    case 'openai':
      return new OpenAILLMClient(apiKey, config.model);
    case 'gemini':
      return new GeminiLLMClient(apiKey, config.model);
    default:
      throw new Error(`Unknown LLM provider: ${config.provider}`);
  }
}
