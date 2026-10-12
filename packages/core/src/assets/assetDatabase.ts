import { assert, RowanError } from '../core/assert';
import { Signal } from '../core/signal';
import { generateUuid } from '../core/uuid';
import {
  getBaseName,
  getDirectoryName,
  getFileExtension,
  getNameWithoutExtension,
  isTextAssetType,
  type AssetData,
  type AssetMetaValue,
  type AssetRecord,
  type AssetType,
} from './asset';

export interface CreateAssetOptions {
  readonly name: string;
  readonly type: AssetType;
  readonly mimeType: string;
  readonly data: AssetData;
  readonly meta?: Record<string, AssetMetaValue>;
  /** Use a specific id, for example when loading a saved project. */
  readonly id?: string;
}

/** Holds a project's assets: their records and their raw content. */
export class AssetDatabase {
  readonly onAdded = new Signal<AssetRecord>();
  readonly onRemoved = new Signal<AssetRecord>();
  /** Emitted when an asset's content changes. */
  readonly onChanged = new Signal<AssetRecord>();
  readonly onRenamed = new Signal<AssetRecord>();

  private readonly records = new Map<string, AssetRecord>();
  private readonly contents = new Map<string, AssetData>();

  get size(): number {
    return this.records.size;
  }

  /** Adds an asset. Its name is adjusted when another asset already uses it. */
  create(options: CreateAssetOptions): AssetRecord {
    const id = options.id ?? generateUuid();
    assert(!this.records.has(id), `An asset with id ${id} already exists`);
    assertDataMatchesType(options.type, options.data, options.name);

    const record: AssetRecord = {
      id,
      name: this.makeUniqueName(normalizeAssetName(options.name)),
      type: options.type,
      mimeType: options.mimeType,
      meta: { ...options.meta },
    };
    this.records.set(id, record);
    this.contents.set(id, options.data);
    this.onAdded.emit(record);
    return record;
  }

  get(id: string): AssetRecord | undefined {
    return this.records.get(id);
  }

  has(id: string): boolean {
    return this.records.has(id);
  }

  /** Like {@link AssetDatabase.get} but throws when the asset is missing. */
  require(id: string): AssetRecord {
    const record = this.records.get(id);
    if (!record) {
      throw new RowanError(`Asset ${id} does not exist`);
    }
    return record;
  }

  getData(id: string): AssetData {
    const data = this.contents.get(id);
    if (data === undefined) {
      throw new RowanError(`Asset ${id} does not exist`);
    }
    return data;
  }

  /** The content of a text asset (script, scene or prefab). */
  getText(id: string): string {
    const data = this.getData(id);
    if (typeof data !== 'string') {
      throw new RowanError(`Asset "${this.require(id).name}" is not a text asset`);
    }
    return data;
  }

  /** The content of a binary asset (texture or audio). */
  getBytes(id: string): Uint8Array {
    const data = this.getData(id);
    if (typeof data === 'string') {
      throw new RowanError(`Asset "${this.require(id).name}" is not a binary asset`);
    }
    return data;
  }

  /** Replaces an asset's content, optionally merging new metadata. */
  setData(id: string, data: AssetData, meta?: Record<string, AssetMetaValue>): void {
    const record = this.require(id);
    assertDataMatchesType(record.type, data, record.name);
    this.contents.set(id, data);
    if (meta) {
      record.meta = { ...record.meta, ...meta };
    }
    this.onChanged.emit(record);
  }

  /** Renames an asset. Returns the final name, which may be adjusted to stay unique. */
  rename(id: string, name: string): string {
    const record = this.require(id);
    const normalized = normalizeAssetName(name);
    if (normalized !== record.name) {
      record.name = this.makeUniqueName(normalized, id);
      this.onRenamed.emit(record);
    }
    return record.name;
  }

  /** Removes an asset. Returns `false` when it did not exist. */
  remove(id: string): boolean {
    const record = this.records.get(id);
    if (!record) {
      return false;
    }
    this.records.delete(id);
    this.contents.delete(id);
    this.onRemoved.emit(record);
    return true;
  }

  /** All assets, optionally of one type, sorted by name. */
  list(type?: AssetType): AssetRecord[] {
    const records = [...this.records.values()].filter(
      (record) => type === undefined || record.type === type,
    );
    return records.sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Finds an asset by name. A full path such as `Sprites/player.png` must match exactly.
   * A bare name such as `player.png` or `player` also matches an asset in any folder.
   */
  findByName(name: string, type?: AssetType): AssetRecord | undefined {
    const normalized = normalizeAssetName(name);
    // Names are unique, so an exact match needs no ordering. This is the path scripts
    // take every time they refer to an asset by its full name.
    for (const record of this.records.values()) {
      if (record.name === normalized && (type === undefined || record.type === type)) {
        return record;
      }
    }
    if (normalized.includes('/')) {
      return undefined;
    }
    // A bare name can match several assets; sorting makes the choice deterministic.
    const candidates = this.list(type);
    return (
      candidates.find((record) => getBaseName(record.name) === normalized) ??
      candidates.find((record) => getNameWithoutExtension(record.name) === normalized)
    );
  }

  /**
   * Resolves a reference that is either an asset id or an asset name.
   * Ids win over names, so a reference stored by the editor never changes meaning.
   */
  resolve(reference: string, type?: AssetType): AssetRecord | undefined {
    const byId = this.records.get(reference);
    if (byId && (type === undefined || byId.type === type)) {
      return byId;
    }
    return this.findByName(reference, type);
  }

  /** Returns `name`, or a numbered variation of it when another asset already uses it. */
  makeUniqueName(name: string, ignoreId?: string): string {
    const isTaken = (candidate: string): boolean => {
      for (const record of this.records.values()) {
        if (record.name === candidate && record.id !== ignoreId) {
          return true;
        }
      }
      return false;
    };
    if (!isTaken(name)) {
      return name;
    }

    const directory = getDirectoryName(name);
    const stem = getNameWithoutExtension(name);
    const extension = getFileExtension(name);
    for (let counter = 1; ; counter++) {
      const baseName = extension ? `${stem} ${counter}.${extension}` : `${stem} ${counter}`;
      const candidate = directory ? `${directory}/${baseName}` : baseName;
      if (!isTaken(candidate)) {
        return candidate;
      }
    }
  }
}

/** Cleans up a user-supplied asset path: forward slashes only, no empty or dot segments. */
export function normalizeAssetName(name: string): string {
  const segments = name
    .replace(/\\/g, '/')
    .split('/')
    .map((segment) => segment.trim())
    .filter((segment) => segment !== '' && segment !== '.' && segment !== '..');
  if (segments.length === 0) {
    throw new RowanError(`Invalid asset name "${name}"`);
  }
  return segments.join('/');
}

function assertDataMatchesType(type: AssetType, data: AssetData, name: string): void {
  const isText = typeof data === 'string';
  if (isText !== isTextAssetType(type)) {
    throw new RowanError(
      `Asset "${name}" of type ${type} needs ${isTextAssetType(type) ? 'text' : 'binary'} content`,
    );
  }
}
