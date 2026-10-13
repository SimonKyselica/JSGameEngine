import { assert, RowanError } from '../core/assert';
import { Signal } from '../core/signal';
import { generateUuid } from '../core/uuid';
import {
  compareAssetPaths,
  getBaseName,
  getDirectoryName,
  getFileExtension,
  getNameWithoutExtension,
  isInFolder,
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

/**
 * Holds a project's assets: their records and their raw content, and the folders they are
 * organized in.
 *
 * The name of an asset is its path, and the folders of that path exist from then on. A
 * folder is more than a part of a name, though: it stays when the last asset leaves it,
 * and it can be made, moved, renamed and removed by itself.
 */
export class AssetDatabase {
  readonly onAdded = new Signal<AssetRecord>();
  readonly onRemoved = new Signal<AssetRecord>();
  /** Emitted when an asset's content changes. */
  readonly onChanged = new Signal<AssetRecord>();
  /** Emitted when an asset has a new name, which includes being moved to another folder. */
  readonly onRenamed = new Signal<AssetRecord>();
  /**
   * Emitted when a folder was made, moved, renamed or removed. A folder that comes into
   * being because an asset was put into it is announced by the signal of that asset alone.
   */
  readonly onFoldersChanged = new Signal();

  private readonly records = new Map<string, AssetRecord>();
  private readonly contents = new Map<string, AssetData>();
  private readonly folders = new Set<string>();

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
    this.addFolders(getDirectoryName(record.name));
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
      this.addFolders(getDirectoryName(record.name));
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

  // --- Folders ---------------------------------------------------------------------------

  /**
   * Every folder of the project in the order of a tree: a folder comes before what is in
   * it. The top level is not listed; it is the folder with the empty name.
   */
  listFolders(): string[] {
    return [...this.folders].sort(compareAssetPaths);
  }

  hasFolder(path: string): boolean {
    return this.folders.has(path);
  }

  /**
   * Makes a folder, together with the folders above it that do not exist yet. Making a
   * folder that is already there changes nothing. Returns its path, cleaned up the way the
   * name of an asset is.
   */
  createFolder(path: string): string {
    const folder = normalizeAssetName(path);
    if (this.addFolders(folder)) {
      this.onFoldersChanged.emit();
    }
    return folder;
  }

  /**
   * Gives a folder a new path, and with it every folder and asset inside. This renames a
   * folder as well as moving it into another one. Returns the new path.
   *
   * Throws when there is no such folder, when the new path is inside the folder itself,
   * or when a folder with the new path exists already: two folders are never merged.
   */
  moveFolder(from: string, to: string): string {
    const source = normalizeAssetName(from);
    const target = normalizeAssetName(to);
    if (!this.folders.has(source)) {
      throw new RowanError(`There is no folder "${source}"`);
    }
    if (target === source) {
      return target;
    }
    if (isInFolder(target, source)) {
      throw new RowanError(`The folder "${source}" cannot be moved into itself`);
    }
    if (this.folders.has(target)) {
      throw new RowanError(`There is already a folder "${target}". Choose another name.`);
    }

    for (const folder of [...this.folders]) {
      if (folder === source || isInFolder(folder, source)) {
        this.folders.delete(folder);
        this.folders.add(target + folder.slice(source.length));
      }
    }
    this.addFolders(getDirectoryName(target));
    // Nothing was at the new path, so none of the new names can be taken.
    const moved = [...this.records.values()].filter((record) => isInFolder(record.name, source));
    for (const record of moved) {
      record.name = target + record.name.slice(source.length);
    }
    // Announced when all of it is in place, so that a listener never sees half a move.
    for (const record of moved) {
      this.onRenamed.emit(record);
    }
    this.onFoldersChanged.emit();
    return target;
  }

  /**
   * Removes a folder with every folder and asset inside. Returns the assets that went
   * with it, which is none when there is no such folder.
   */
  removeFolder(path: string): AssetRecord[] {
    if (!this.folders.has(path)) {
      return [];
    }
    const removed = [...this.records.values()].filter((record) => isInFolder(record.name, path));
    for (const record of removed) {
      this.records.delete(record.id);
      this.contents.delete(record.id);
    }
    for (const folder of [...this.folders]) {
      if (folder === path || isInFolder(folder, path)) {
        this.folders.delete(folder);
      }
    }
    for (const record of removed) {
      this.onRemoved.emit(record);
    }
    this.onFoldersChanged.emit();
    return removed;
  }

  /** Makes sure a folder and the folders above it exist. Returns whether any was missing. */
  private addFolders(path: string): boolean {
    let added = false;
    for (let folder = path; folder !== '' && !this.folders.has(folder);) {
      this.folders.add(folder);
      added = true;
      folder = getDirectoryName(folder);
    }
    return added;
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
