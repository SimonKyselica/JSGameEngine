import { describeError, RowanError } from '../core/assert';
import type { Logger } from '../core/logger';

/** A value that can be saved: anything made of numbers, strings, booleans, `null`, arrays and plain objects. */
export type SaveValue =
  string | number | boolean | null | SaveValue[] | { [key: string]: SaveValue };

/**
 * Where a game's save data is kept between runs. The data is one piece of text; what is in
 * it is the business of {@link SaveData}. Every method may throw when the place is not
 * available, for example when a browser blocks storage.
 */
export interface StorageBackend {
  /** The stored text, or `null` when nothing has been stored yet. */
  read(): string | null;
  /** Replaces what is stored. */
  write(text: string): void;
  /** Removes what is stored. */
  clear(): void;
}

/** Keeps save data in memory only. Used for tests and for running games without a browser. */
export class MemoryStorageBackend implements StorageBackend {
  /** What is stored at the moment. */
  text: string | null = null;
  /** How often the data was written, to check that it is not written more than needed. */
  writes = 0;

  read(): string | null {
    return this.text;
  }

  write(text: string): void {
    this.text = text;
    this.writes++;
  }

  clear(): void {
    this.text = null;
  }
}

/** The name save data is stored under in a browser, for the project with this id. */
export function getSaveKey(projectId: string): string {
  return `rowan.save.${projectId}`;
}

/**
 * Keeps save data in the browser's local storage, where it survives closing the page. The
 * storage is only touched when it is used, because merely asking for it throws in a browser
 * that blocks it.
 */
export class LocalStorageBackend implements StorageBackend {
  constructor(
    private readonly key: string,
    private readonly getStorage: () => Storage = () => window.localStorage,
  ) {}

  read(): string | null {
    return this.getStorage().getItem(this.key);
  }

  write(text: string): void {
    this.getStorage().setItem(this.key, text);
  }

  clear(): void {
    this.getStorage().removeItem(this.key);
  }
}

/** Throws unless `value` can be saved and read back unchanged. `path` says where it is. */
function assertSaveValue(value: unknown, path: string): asserts value is SaveValue {
  switch (typeof value) {
    case 'string':
    case 'boolean':
      return;
    case 'number':
      if (!Number.isFinite(value)) {
        throw new RowanError(`${path} is ${value}, which cannot be saved. Save a finite number.`);
      }
      return;
    case 'object': {
      if (value === null) {
        return;
      }
      if (Array.isArray(value)) {
        value.forEach((item, index) => assertSaveValue(item, `${path}[${index}]`));
        return;
      }
      const prototype: unknown = Object.getPrototypeOf(value);
      if (prototype !== Object.prototype && prototype !== null) {
        throw new RowanError(
          `${path} is an object of a class, which cannot be saved. Save its numbers instead, ` +
            'for example position.toArray() for a Vec2.',
        );
      }
      for (const [key, item] of Object.entries(value)) {
        assertSaveValue(item, `${path}.${key}`);
      }
      return;
    }
    default:
      throw new RowanError(
        `${path} is ${value === undefined ? 'undefined' : `a ${typeof value}`}, which cannot be ` +
          'saved. Save numbers, strings, booleans, null, arrays or plain objects.',
      );
  }
}

function cloneSaveValue<T extends SaveValue>(value: T): T {
  return typeof value === 'object' && value !== null
    ? (JSON.parse(JSON.stringify(value)) as T)
    : value;
}

/**
 * The save data of a game: named values that outlive the scene, and the page. It is read
 * once, kept in memory, and written back at the end of a frame in which it changed.
 *
 * A game must keep running when its data cannot be stored, so problems with the backend
 * are reported once and the data then lives in memory for as long as the game is open.
 */
export class SaveData {
  private values = new Map<string, SaveValue>();
  private dirty = false;
  private reportedWriteFailure = false;

  constructor(
    private readonly backend: StorageBackend,
    private readonly logger: Logger,
  ) {
    this.load();
  }

  get(key: string): SaveValue | undefined {
    const value = this.values.get(key);
    // A copy, so that changing what was read does not change what is saved.
    return value === undefined ? undefined : cloneSaveValue(value);
  }

  set(key: string, value: unknown): void {
    if (typeof key !== 'string' || key === '') {
      throw new RowanError(
        'A saved value needs a name: pass a string that is not empty as the key',
      );
    }
    assertSaveValue(value, `The value for "${key}"`);
    this.values.set(key, cloneSaveValue(value));
    this.dirty = true;
  }

  has(key: string): boolean {
    return this.values.has(key);
  }

  remove(key: string): boolean {
    const removed = this.values.delete(key);
    this.dirty ||= removed;
    return removed;
  }

  keys(): string[] {
    return [...this.values.keys()];
  }

  clear(): void {
    this.dirty ||= this.values.size > 0;
    this.values.clear();
  }

  /** Writes the data to the backend if it has changed since it was last written. */
  flush(): void {
    if (!this.dirty) {
      return;
    }
    this.dirty = false;
    try {
      this.backend.write(JSON.stringify(Object.fromEntries(this.values)));
      this.reportedWriteFailure = false;
    } catch (error) {
      if (!this.reportedWriteFailure) {
        this.reportedWriteFailure = true;
        this.logger.warn(
          `Save data could not be stored and will be lost when the game is closed: ${describeError(error)}`,
        );
      }
    }
  }

  private load(): void {
    let text: string | null;
    try {
      text = this.backend.read();
    } catch (error) {
      this.logger.warn(
        `Save data could not be read, so the game starts without it: ${describeError(error)}`,
      );
      return;
    }
    if (text === null) {
      return;
    }
    try {
      const data: unknown = JSON.parse(text);
      if (typeof data !== 'object' || data === null || Array.isArray(data)) {
        throw new RowanError('expected an object of saved values');
      }
      for (const [key, value] of Object.entries(data)) {
        assertSaveValue(value, `"${key}"`);
        this.values.set(key, value);
      }
    } catch (error) {
      this.values.clear();
      this.logger.warn(
        `The stored save data is damaged, so the game starts without it: ${describeError(error)}`,
      );
    }
  }
}

/**
 * Save data as seen by scripts (`this.storage`): named values that are still there after a
 * scene change and the next time the game is opened. High scores, unlocked levels and
 * settings go here.
 *
 * A value can be a number, a string, a boolean, `null`, or an array or plain object of
 * those. In a browser the data is kept in the browser's local storage, separately for every
 * project. It is written at the end of each frame in which it changed.
 */
export class StorageApi {
  constructor(private readonly data: SaveData) {}

  /**
   * The value saved under `key`, or `fallback` when there is none. Arrays and objects are
   * returned as copies: change them and call `set` to save the change.
   */
  get(key: string, fallback: number): number;
  get(key: string, fallback: string): string;
  get(key: string, fallback: boolean): boolean;
  get<T extends SaveValue>(key: string, fallback: T): T;
  get(key: string): SaveValue | undefined;
  get(key: string, fallback?: SaveValue): SaveValue | undefined {
    const value = this.data.get(key);
    return value === undefined ? fallback : value;
  }

  /**
   * Saves a value under `key`, replacing what was there. Throws when the value cannot be
   * saved, such as a function, `NaN`, or an object of a class like `Vec2`; save
   * `position.toArray()` instead.
   */
  set(key: string, value: SaveValue): void {
    this.data.set(key, value);
  }

  /** True when a value is saved under `key`. */
  has(key: string): boolean {
    return this.data.has(key);
  }

  /** Forgets the value saved under `key`. Returns `false` when there was none. */
  remove(key: string): boolean {
    return this.data.remove(key);
  }

  /** The names of everything that is saved. */
  keys(): string[] {
    return this.data.keys();
  }

  /** Forgets everything that is saved. */
  clear(): void {
    this.data.clear();
  }
}
