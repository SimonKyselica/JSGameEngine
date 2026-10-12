import type { Unsubscribe } from './signal';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  readonly level: LogLevel;
  readonly message: string;
  /** Milliseconds since the Unix epoch. */
  readonly timestamp: number;
  /** Where the entry came from, for example a script or system name. */
  readonly source?: string;
}

export type LogSink = (entry: LogEntry) => void;

/** Routes engine and script messages to any number of sinks (browser console, editor console...). */
export class Logger {
  private readonly sinks = new Set<LogSink>();

  addSink(sink: LogSink): Unsubscribe {
    this.sinks.add(sink);
    return () => {
      this.sinks.delete(sink);
    };
  }

  debug(message: string, source?: string): void {
    this.write('debug', message, source);
  }

  info(message: string, source?: string): void {
    this.write('info', message, source);
  }

  warn(message: string, source?: string): void {
    this.write('warn', message, source);
  }

  error(message: string, source?: string): void {
    this.write('error', message, source);
  }

  private write(level: LogLevel, message: string, source?: string): void {
    const entry: LogEntry = { level, message, timestamp: Date.now(), source };
    for (const sink of this.sinks) {
      sink(entry);
    }
  }
}

/** A sink that forwards entries to the JavaScript console. */
export function consoleSink(entry: LogEntry): void {
  const text = entry.source ? `[${entry.source}] ${entry.message}` : entry.message;
  switch (entry.level) {
    case 'debug':
      console.debug(text);
      break;
    case 'info':
      console.info(text);
      break;
    case 'warn':
      console.warn(text);
      break;
    case 'error':
      console.error(text);
      break;
  }
}

/** Formats `console.log`-style arguments into one line of text. */
export function formatLogArguments(args: readonly unknown[]): string {
  return args.map(formatLogValue).join(' ');
}

function formatLogValue(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  if (value instanceof Error) {
    return value.stack ?? `${value.name}: ${value.message}`;
  }
  if (typeof value === 'object' && value !== null) {
    // Objects with their own toString, such as Vec2, know best how to print themselves.
    if (value.toString !== Object.prototype.toString && !Array.isArray(value)) {
      return (value as { toString(): string }).toString();
    }
    try {
      return JSON.stringify(value);
    } catch {
      // Circular structures cannot be serialized; fall back to "[object Object]".
      return Object.prototype.toString.call(value);
    }
  }
  return String(value);
}
