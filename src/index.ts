import { createConnector } from './connectors/index.js';
import { createLLMClient } from './llm/client.js';
import { runInterview } from './interview/interviewer.js';
import { generateReport } from './report/generator.js';
import type { HeronConfig } from './config/schema.js';
import * as logger from './util/logger.js';
import { writeFileSync } from 'node:fs';

export interface RunOptions {
  verbose?: boolean;
  maxFollowUps?: number;
}

/**
 * Main entry point — runs the full interrogation pipeline:
 * connect → interview → analyze → report
 */
export async function run(config: HeronConfig, options: RunOptions = {}): Promise<string> {
  const { verbose = false, maxFollowUps = 3 } = options;

  // 1. Create LLM client for analysis
  const llmClient = createLLMClient(config.llm);

  // 2. Connect to target agent
  const connector = createConnector(config.target);
  const targetLabel = config.target.url ?? config.target.type;

  logger.heading(`Heron Agent Interrogator`);
  logger.log(`Target: ${targetLabel}`);
  logger.log(`LLM: ${config.llm.provider}/${config.llm.model}`);
  logger.log(`Mode: ${config.target.type}`);

  try {
    // 3. Run interview
    const session = await runInterview(connector, llmClient, {
      maxFollowUps,
      verbose,
    });

    // 4. Generate report
    const report = await generateReport(session, llmClient, {
      target: targetLabel,
      format: config.output.format,
    });

    // 5. Output
    if (config.output.path) {
      writeFileSync(config.output.path, report, 'utf-8');
      logger.success(`Report saved: ${config.output.path}`);
    } else {
      process.stdout.write(report);
    }

    // 6. Hint about Heron UI (only if not already configured)
    if (!config.heron) {
      console.error('');
      console.error('  Want team review? Send reports to Heron UI:');
      console.error('    npx heron-ai --target ... --heron-url https://app.heron.dev');
      console.error('');
    }

    return report;
  } finally {
    await connector.close();
  }
}
