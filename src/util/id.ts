import { randomBytes } from 'node:crypto';

export function generateId(prefix = 'heron'): string {
  return `${prefix}_${randomBytes(8).toString('hex')}`;
}
