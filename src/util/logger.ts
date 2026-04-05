const COLORS = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  bold: '\x1b[1m',
};

export function log(message: string): void {
  console.error(`${COLORS.dim}[heron]${COLORS.reset} ${message}`);
}

export function success(message: string): void {
  console.error(`${COLORS.green}\u2713${COLORS.reset} ${message}`);
}

export function warn(message: string): void {
  console.error(`${COLORS.yellow}\u26A0${COLORS.reset} ${message}`);
}

export function error(message: string): void {
  console.error(`${COLORS.red}\u2717${COLORS.reset} ${message}`);
}

export function step(n: number, total: number, message: string): void {
  console.error(`${COLORS.cyan}[${n}/${total}]${COLORS.reset} ${message}`);
}

export function heading(message: string): void {
  console.error(`\n${COLORS.bold}${message}${COLORS.reset}`);
}

/** Raw output without [heron] prefix — for banners and formatted blocks */
export function raw(message: string): void {
  console.error(message);
}
