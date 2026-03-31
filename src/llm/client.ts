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
      max_tokens: 8192,
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
    this.client = new OpenAI({ apiKey, timeout: 90_000 });
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
      signal: AbortSignal.timeout(90_000),
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: 'user', parts: [{ text: userMessage }] }],
        generationConfig: { maxOutputTokens: 8192 },
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
 * Auto-detect LLM provider from API key format.
 */
function detectProvider(apiKey: string): 'anthropic' | 'openai' | 'gemini' {
  if (apiKey.startsWith('sk-ant-')) return 'anthropic';
  if (apiKey.startsWith('sk-')) return 'openai';
  if (apiKey.startsWith('AIza')) return 'gemini';
  return 'anthropic'; // fallback
}

const DEFAULT_MODELS: Record<string, string> = {
  anthropic: 'claude-sonnet-4-20250514',
  openai: 'gpt-5.4-mini',
  gemini: 'gemini-2.0-flash',
};

/**
 * Create an LLM client. Resolves API key in this order:
 * 1. Explicit config.apiKey (from --llm-key flag or config file)
 * 2. HERON_LLM_API_KEY env var
 *
 * If provider is not explicitly set, auto-detects from API key format.
 */
export async function createLLMClient(config: LLMConfig): Promise<LLMClient> {
  const apiKey = config.apiKey ?? process.env.HERON_LLM_API_KEY;

  if (!apiKey) {
    throw new Error(
      `No API key found. Use one of:\n` +
      `  1. --llm-key <key>\n` +
      `  2. HERON_LLM_API_KEY env var`,
    );
  }

  // Auto-detect provider if using default
  const detected = detectProvider(apiKey);
  const provider = config.provider === 'anthropic' && !process.env.HERON_LLM_PROVIDER
    ? detected
    : config.provider;
  const model = provider !== config.provider
    ? DEFAULT_MODELS[provider]
    : config.model;

  switch (provider) {
    case 'anthropic':
      return new AnthropicLLMClient(apiKey, model);
    case 'openai':
      return new OpenAILLMClient(apiKey, model);
    case 'gemini':
      return new GeminiLLMClient(apiKey, model);
    default:
      throw new Error(`Unknown LLM provider: ${provider}`);
  }
}
