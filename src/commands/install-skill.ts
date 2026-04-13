import { mkdirSync, copyFileSync, existsSync, chmodSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import * as logger from '../util/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export async function installSkill(): Promise<void> {
  const skillSource = join(__dirname, '..', '..', 'skills', 'heron-audit');
  const skillTarget = join(homedir(), '.claude', 'skills', 'heron-audit');

  if (!existsSync(join(skillSource, 'SKILL.md'))) {
    logger.error(`Skill source not found: ${skillSource}`);
    logger.raw('  If you cloned the repo, run: bash skills/heron-audit/install.sh');
    process.exit(1);
  }

  mkdirSync(join(skillTarget, 'bin'), { recursive: true });
  mkdirSync(join(homedir(), '.heron'), { recursive: true });

  copyFileSync(join(skillSource, 'SKILL.md'), join(skillTarget, 'SKILL.md'));
  copyFileSync(
    join(skillSource, 'bin', 'heron-update-check'),
    join(skillTarget, 'bin', 'heron-update-check'),
  );
  chmodSync(join(skillTarget, 'bin', 'heron-update-check'), 0o755);

  logger.success(`Installed skill to ${skillTarget}`);
  logger.raw('');
  logger.raw('  Usage: type /heron-audit in any Claude Code session.');
  logger.raw('');
}
