import { Signal, type LogEntry, type LogLevel } from '@rowan/core';

/** Oldest entries are dropped beyond this, so a script logging every frame cannot exhaust memory. */
const MAX_ENTRIES = 1000;

export interface ConsoleEntry {
  readonly id: number;
  readonly level: LogLevel;
  readonly message: string;
  readonly source?: string;
  readonly timestamp: number;
  /** How many times in a row this exact message was logged. */
  count: number;
}

/** The messages shown in the editor's Console panel. */
export class ConsoleStore {
  readonly onChange = new Signal();
  private items: ConsoleEntry[] = [];
  private nextId = 1;

  get entries(): readonly ConsoleEntry[] {
    return this.items;
  }

  /** Adds a message. Repeats of the previous message only increase its counter. */
  add(entry: LogEntry): void {
    const last = this.items.at(-1);
    if (
      last?.level === entry.level &&
      last.message === entry.message &&
      last.source === entry.source
    ) {
      // Replacing the object lets React notice the change.
      this.items = [...this.items.slice(0, -1), { ...last, count: last.count + 1 }];
    } else {
      const added: ConsoleEntry = {
        id: this.nextId++,
        level: entry.level,
        message: entry.message,
        source: entry.source,
        timestamp: entry.timestamp,
        count: 1,
      };
      this.items = [...this.items.slice(-(MAX_ENTRIES - 1)), added];
    }
    this.onChange.emit();
  }

  /** The number of messages of a level, counting repeats. */
  count(level: LogLevel): number {
    return this.items.reduce(
      (total, entry) => (entry.level === level ? total + entry.count : total),
      0,
    );
  }

  clear(): void {
    if (this.items.length > 0) {
      this.items = [];
      this.onChange.emit();
    }
  }
}
