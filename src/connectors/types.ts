export interface AgentMetadata {
  name?: string;
  model?: string;
  provider?: string;
  description?: string;
}

export interface AgentConnector {
  /** Send a message to the target agent and get a response */
  sendMessage(message: string): Promise<string>;

  /** Get metadata about the target agent, if available */
  getMetadata?(): Promise<AgentMetadata>;

  /** Clean up connection resources */
  close(): Promise<void>;
}
