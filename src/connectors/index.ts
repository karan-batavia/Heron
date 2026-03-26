import type { TargetConfig } from '../config/schema.js';
import type { AgentConnector } from './types.js';
import { HttpConnector } from './http-connector.js';
import { InteractiveConnector } from './interactive-connector.js';

export function createConnector(config: TargetConfig): AgentConnector {
  switch (config.type) {
    case 'http':
      return new HttpConnector(config);
    case 'interactive':
      return new InteractiveConnector();
    default:
      throw new Error(`Unknown connector type: ${config.type}`);
  }
}

export type { AgentConnector, AgentMetadata } from './types.js';
