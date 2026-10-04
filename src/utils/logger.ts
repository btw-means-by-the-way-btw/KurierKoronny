type Level = 'debug' | 'info' | 'warn' | 'error';

const ORDER: Record<Level, number> = { debug: 0, info: 1, warn: 2, error: 3 };
const MIN_LEVEL: Level = __DEV__ ? 'debug' : 'warn';

export function createLogger(tag: string) {
  const log = (level: Level, ...args: unknown[]) => {
    if (ORDER[level] < ORDER[MIN_LEVEL]) return;
    const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
    fn(`[${tag}]`, ...args);
  };
  return {
    debug: (...a: unknown[]) => log('debug', ...a),
    info: (...a: unknown[]) => log('info', ...a),
    warn: (...a: unknown[]) => log('warn', ...a),
    error: (...a: unknown[]) => log('error', ...a),
  };
}
