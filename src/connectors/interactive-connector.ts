import { createInterface } from 'node:readline';
import type { AgentConnector, AgentMetadata } from './types.js';
import * as logger from '../util/logger.js';

/**
 * Interactive connector — the user manually relays questions to the agent
 * and pastes back responses. Useful when the agent doesn't have an HTTP API.
 */
export class InteractiveConnector implements AgentConnector {
  private rl: ReturnType<typeof createInterface>;

  constructor() {
    this.rl = createInterface({
      input: process.stdin,
      output: process.stderr, // use stderr so stdout stays clean for report output
    });
  }

  async sendMessage(message: string): Promise<string> {
    logger.heading('Question for the agent:');
    console.error(`\n${message}\n`);
    console.error('---');

    return new Promise<string>((resolve) => {
      console.error('Paste the agent\'s response below (end with an empty line):');
      const lines: string[] = [];
      const lineHandler = (line: string) => {
        if (line === '' && lines.length > 0) {
          this.rl.removeListener('line', lineHandler);
          resolve(lines.join('\n'));
        } else {
          lines.push(line);
        }
      };
      this.rl.on('line', lineHandler);
    });
  }

  async getMetadata(): Promise<AgentMetadata> {
    return {
      provider: 'interactive',
      description: 'Manual relay — user copies questions to the agent',
    };
  }

  async close(): Promise<void> {
    this.rl.close();
  }
}
