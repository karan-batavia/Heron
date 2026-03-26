#!/usr/bin/env node

import { Command } from 'commander';
import { loadConfigFromFlags } from '../src/config/loader.js';
import { run } from '../src/index.js';
import { startServer } from '../src/server/index.js';
import { login, logout, showStatus, type AuthProvider } from '../src/auth/index.js';
import * as logger from '../src/util/logger.js';

const program = new Command();

program
  .name('heron')
  .description('Open-source agent checkpoint — vet AI agents before granting production access')
  .version('0.1.0');

// ─── login: authenticate with LLM providers ────────────────────────────────

program
  .command('login')
  .description('Authenticate with an LLM provider (anthropic, openai, gemini)')
  .argument('<provider>', 'Provider: anthropic, openai, or gemini')
  .action(async (provider: string) => {
    try {
      const validProviders = ['anthropic', 'openai', 'gemini'];
      if (!validProviders.includes(provider)) {
        console.error(`Unknown provider: ${provider}. Use: ${validProviders.join(', ')}`);
        process.exit(1);
      }
      await login(provider as AuthProvider);
    } catch (err) {
      logger.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

// ─── logout: remove stored credentials ─────────────────────────────────────

program
  .command('logout')
  .description('Remove stored credentials for a provider')
  .argument('<provider>', 'Provider: anthropic, openai, or gemini')
  .action((provider: string) => {
    try {
      logout(provider as AuthProvider);
    } catch (err) {
      logger.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

// ─── auth-status: show credential status ────────────────────────────────────

program
  .command('auth-status')
  .description('Show authentication status for all providers')
  .action(() => {
    showStatus();
  });

// ─── scan: active mode (Heron → Agent) ───────────────────────────────────

program
  .command('scan')
  .description('Interrogate an agent by connecting to its API')
  .option('-t, --target <url>', 'Target agent URL (OpenAI-compatible chat API)')
  .option('--target-type <type>', 'Connection type: http or interactive', 'http')
  .option('--llm-provider <provider>', 'LLM provider: anthropic, openai, or gemini', 'anthropic')
  .option('--llm-model <model>', 'LLM model for analysis', 'claude-sonnet-4-20250514')
  .option('--llm-key <key>', 'LLM API key (or use `heron login` / HERON_LLM_API_KEY)')
  .option('-o, --output <path>', 'Save report to file (default: stdout)')
  .option('-f, --format <format>', 'Output format: markdown or json', 'markdown')
  .option('-c, --config <path>', 'Path to heron.yaml config file')
  .option('--max-followups <n>', 'Max follow-up questions per category', '3')
  .option('-v, --verbose', 'Show detailed interview progress')
  .action(async (opts) => {
    try {
      if (!opts.target && !opts.config && opts.targetType !== 'interactive') {
        console.error('Either --target <url>, --config <path>, or --target-type interactive is required');
        process.exit(1);
      }

      const config = loadConfigFromFlags({
        target: opts.target,
        targetType: opts.targetType,
        llmProvider: opts.llmProvider,
        llmModel: opts.llmModel,
        llmKey: opts.llmKey,
        output: opts.output,
        format: opts.format,
        config: opts.config,
      });

      await run(config, {
        verbose: opts.verbose ?? false,
        maxFollowUps: parseInt(opts.maxFollowups ?? '3', 10),
      });
    } catch (err) {
      logger.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

// ─── serve: passive mode (Agent → Heron) ─────────────────────────────────

program
  .command('serve')
  .description('Start Heron server — agents connect to be interrogated')
  .option('-p, --port <port>', 'Port to listen on', '3700')
  .option('-H, --host <host>', 'Host to bind to', '0.0.0.0')
  .option('--llm-provider <provider>', 'LLM provider: anthropic, openai, or gemini', 'anthropic')
  .option('--llm-model <model>', 'LLM model for analysis', 'claude-sonnet-4-20250514')
  .option('--llm-key <key>', 'LLM API key (or use `heron login` / HERON_LLM_API_KEY)')
  .option('--max-followups <n>', 'Max follow-up questions per category', '3')
  .option('--report-dir <dir>', 'Directory to save reports', './reports')
  .action(async (opts) => {
    try {
      await startServer({
        port: parseInt(opts.port, 10),
        host: opts.host,
        llm: {
          provider: opts.llmProvider as 'anthropic' | 'openai' | 'gemini',
          apiKey: opts.llmKey,
          model: opts.llmModel,
        },
        maxFollowUps: parseInt(opts.maxFollowups ?? '3', 10),
        reportDir: opts.reportDir,
      });
    } catch (err) {
      logger.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  });

// ─── Default: show help if no command ─────────────────────────────────────

const args = process.argv.slice(2);
const hasSubcommand = args.length > 0 && ['scan', 'serve', 'login', 'logout', 'auth-status', 'help', '--help', '-h', '--version', '-V'].includes(args[0]);

if (!hasSubcommand && args.length > 0) {
  // Legacy: flags without subcommand → scan
  process.argv.splice(2, 0, 'scan');
}

program.parse();
