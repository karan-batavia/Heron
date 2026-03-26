import { saveCredential, type TokenCredential } from './store.js';
import * as logger from '../util/logger.js';

/**
 * Anthropic doesn't support OAuth for external tools.
 * Instead, users can generate a setup token via `claude setup-token`
 * (tokens starting with `sk-ant-oat01-`).
 *
 * This flow prompts the user to generate and paste the token.
 */
export async function loginAnthropic(): Promise<TokenCredential> {
  logger.heading('Anthropic Authentication');
  logger.log('');
  logger.log('Anthropic does not support OAuth. You have two options:');
  logger.log('');
  logger.log('  Option 1: API Key');
  logger.log('    Get one at https://console.anthropic.com/settings/keys');
  logger.log('');
  logger.log('  Option 2: Claude subscription token (experimental)');
  logger.log('    If you have Claude Pro/Team, run in terminal:');
  logger.log('      claude setup-token');
  logger.log('    Then paste the token below (starts with sk-ant-oat01-)');
  logger.log('');

  const token = await promptForInput('Paste your API key or setup token: ');

  if (!token.startsWith('sk-ant-')) {
    logger.warn('Token does not look like an Anthropic key (expected sk-ant-...)');
    logger.log('Saving anyway — you can re-run `heron login anthropic` to fix it.');
  }

  const credential: TokenCredential = {
    type: 'token',
    provider: 'anthropic',
    token,
  };

  saveCredential('anthropic', credential);
  logger.success('Anthropic credentials saved to ~/.heron/auth.json');
  return credential;
}

export function promptForInput(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    process.stdout.write(prompt);
    process.stdin.setEncoding('utf-8');
    process.stdin.resume();
    process.stdin.once('data', (data) => {
      process.stdin.pause();
      resolve(data.toString().trim());
    });
  });
}
