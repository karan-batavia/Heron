import type { AgentConnector, AgentMetadata } from './types.js';
import type { TargetConfig } from '../config/schema.js';

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/**
 * Connects to an agent via OpenAI-compatible chat API.
 * Works with OpenAI, Anthropic (via proxy), local models (Ollama, LM Studio), etc.
 */
export class HttpConnector implements AgentConnector {
  private url: string;
  private apiKey: string | undefined;
  private model: string | undefined;
  private history: ChatMessage[] = [];

  constructor(config: TargetConfig) {
    if (!config.url) {
      throw new Error('Target URL is required for HTTP connector');
    }
    this.url = config.url;
    this.apiKey = config.apiKey;
    this.model = config.model;
  }

  async sendMessage(message: string): Promise<string> {
    this.history.push({ role: 'user', content: message });

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    const body: Record<string, unknown> = {
      messages: this.history,
    };
    if (this.model) {
      body.model = this.model;
    }

    const response = await fetch(this.url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Agent HTTP error ${response.status}: ${text}`);
    }

    const data = await response.json() as {
      choices?: Array<{ message?: { content?: string } }>;
    };

    const reply = data.choices?.[0]?.message?.content ?? '';
    this.history.push({ role: 'assistant', content: reply });
    return reply;
  }

  async getMetadata(): Promise<AgentMetadata> {
    return {
      provider: 'http',
      model: this.model,
    };
  }

  async close(): Promise<void> {
    this.history = [];
  }
}
