import pino from 'pino';

export type Logger = pino.Logger;

/**
 * Create a logger instance
 */
export function createLogger(level: string = 'info', name?: string): Logger {
  return pino({
    level,
    name: name || 'xorng-node',
    transport: {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:standard',
        ignore: 'pid,hostname',
      },
    },
  });
}
