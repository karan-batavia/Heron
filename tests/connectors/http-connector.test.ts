import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { HttpConnector } from '../../src/connectors/http-connector.js';
import { startMockAgent } from '../integration/mock-agent.js';

describe('HttpConnector', () => {
  let mockAgent: { url: string; close: () => Promise<void> };

  beforeAll(async () => {
    mockAgent = await startMockAgent(4555);
  });

  afterAll(async () => {
    await mockAgent.close();
  });

  it('connects and gets a response', async () => {
    const connector = new HttpConnector({ type: 'http', url: mockAgent.url });

    const response = await connector.sendMessage('What is your purpose?');
    expect(response).toContain('invoice');

    await connector.close();
  });

  it('maintains conversation history', async () => {
    const connector = new HttpConnector({ type: 'http', url: mockAgent.url });

    await connector.sendMessage('Describe your main purpose.');
    const second = await connector.sendMessage('What data do you connect to?');
    expect(second.length).toBeGreaterThan(0);

    await connector.close();
  });

  it('throws on invalid URL', () => {
    expect(() => new HttpConnector({ type: 'http' })).toThrow('Target URL is required');
  });

  it('returns metadata', async () => {
    const connector = new HttpConnector({ type: 'http', url: mockAgent.url, model: 'test-model' });
    const meta = await connector.getMetadata();
    expect(meta.provider).toBe('http');
    expect(meta.model).toBe('test-model');
    await connector.close();
  });
});
