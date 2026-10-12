import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { ENGINE_VERSION } from '../version';
import { assert, describeError, RowanError } from './assert';
import { decodeBase64, encodeBase64 } from './base64';
import { consoleSink, formatLogArguments, Logger, type LogEntry } from './logger';
import { Signal } from './signal';
import { generateUuid, isUuid } from './uuid';

describe('assert', () => {
  it('throws a RowanError only for falsy conditions', () => {
    expect(() => assert(true, 'fine')).not.toThrow();
    expect(() => assert(0, 'broken')).toThrow(new RowanError('broken'));
  });

  it('describes any thrown value', () => {
    expect(describeError(new Error('boom'))).toBe('boom');
    expect(describeError('plain')).toBe('plain');
    expect(describeError(42)).toBe('42');
  });

  it('keeps the cause of an error', () => {
    const cause = new Error('inner');
    const error = new RowanError('outer', { cause });
    expect(error.name).toBe('RowanError');
    expect(error.cause).toBe(cause);
  });
});

describe('Signal', () => {
  it('calls listeners in connection order with the payload', () => {
    const signal = new Signal<number>();
    const calls: string[] = [];
    signal.connect((value) => calls.push(`a${value}`));
    signal.connect((value) => calls.push(`b${value}`));
    signal.emit(1);
    expect(calls).toEqual(['a1', 'b1']);
    expect(signal.listenerCount).toBe(2);
  });

  it('stops calling a listener after it disconnects', () => {
    const signal = new Signal();
    const listener = vi.fn();
    const disconnect = signal.connect(listener);
    disconnect();
    signal.emit();
    expect(listener).not.toHaveBeenCalled();
  });

  it('skips a listener that an earlier listener removed during the same emit', () => {
    const signal = new Signal();
    const second = vi.fn();
    let disconnectSecond = (): void => {};
    signal.connect(() => disconnectSecond());
    disconnectSecond = signal.connect(second);
    signal.emit();
    expect(second).not.toHaveBeenCalled();
  });

  it('does not call a listener added during the emit until the next one', () => {
    const signal = new Signal();
    const late = vi.fn();
    signal.connect(() => signal.connect(late));
    signal.emit();
    expect(late).not.toHaveBeenCalled();
  });

  it('removes every listener on clear', () => {
    const signal = new Signal();
    const listener = vi.fn();
    signal.connect(listener);
    signal.clear();
    signal.emit();
    expect(listener).not.toHaveBeenCalled();
  });
});

describe('Logger', () => {
  it('sends entries with level, message and source to every sink', () => {
    const logger = new Logger();
    const entries: LogEntry[] = [];
    logger.addSink((entry) => entries.push(entry));
    logger.debug('d');
    logger.info('i', 'Player');
    logger.warn('w');
    logger.error('e');
    expect(entries.map((entry) => [entry.level, entry.message, entry.source])).toEqual([
      ['debug', 'd', undefined],
      ['info', 'i', 'Player'],
      ['warn', 'w', undefined],
      ['error', 'e', undefined],
    ]);
    expect(entries[0]!.timestamp).toBeGreaterThan(0);
  });

  it('stops sending to a removed sink', () => {
    const logger = new Logger();
    const sink = vi.fn();
    logger.addSink(sink)();
    logger.info('ignored');
    expect(sink).not.toHaveBeenCalled();
  });

  it('routes entries to the matching console method', () => {
    const methods = (['debug', 'info', 'warn', 'error'] as const).map((level) =>
      vi.spyOn(console, level).mockImplementation(() => {}),
    );
    for (const level of ['debug', 'info', 'warn', 'error'] as const) {
      consoleSink({ level, message: 'hello', timestamp: 0, source: 'Src' });
    }
    for (const method of methods) {
      expect(method).toHaveBeenCalledExactlyOnceWith('[Src] hello');
    }
  });

  it('formats mixed arguments like console.log', () => {
    expect(formatLogArguments(['score', 3, true, null, undefined])).toBe(
      'score 3 true null undefined',
    );
    expect(formatLogArguments([{ a: 1 }, [1, 2]])).toBe('{"a":1} [1,2]');
    expect(formatLogArguments([{ toString: () => 'custom' }])).toBe('custom');
  });

  it('formats errors with their stack and survives circular objects', () => {
    expect(formatLogArguments([new Error('bad')])).toContain('Error: bad');
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(formatLogArguments([circular])).toBe('[object Object]');
  });
});

describe('uuid', () => {
  it('generates unique, valid version 4 uuids', () => {
    const ids = new Set(Array.from({ length: 200 }, () => generateUuid()));
    expect(ids.size).toBe(200);
    for (const id of ids) {
      expect(isUuid(id)).toBe(true);
      expect(id[14]).toBe('4');
    }
  });

  it('falls back to getRandomValues when randomUUID is unavailable', () => {
    const realCrypto = globalThis.crypto;
    vi.stubGlobal('crypto', {
      getRandomValues: (bytes: Uint8Array<ArrayBuffer>) => realCrypto.getRandomValues(bytes),
    });
    try {
      const id = generateUuid();
      expect(isUuid(id)).toBe(true);
      expect(id[14]).toBe('4');
      expect('89ab').toContain(id[19]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('recognizes what is not a uuid', () => {
    expect(isUuid('not-a-uuid')).toBe(false);
    expect(isUuid(42)).toBe(false);
  });
});

describe('base64', () => {
  it('round-trips binary data, including data larger than one chunk', () => {
    const bytes = Uint8Array.from({ length: 100_000 }, (_, index) => (index * 31) % 256);
    expect(decodeBase64(encodeBase64(bytes))).toEqual(bytes);
  });

  it('matches the standard encoding', () => {
    expect(encodeBase64(new TextEncoder().encode('Rowan'))).toBe('Um93YW4=');
    expect(encodeBase64(new Uint8Array())).toBe('');
  });
});

describe('ENGINE_VERSION', () => {
  it('matches the version in package.json', () => {
    const packageJson = JSON.parse(
      readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
    ) as { version: string };
    expect(ENGINE_VERSION).toBe(packageJson.version);
  });
});
