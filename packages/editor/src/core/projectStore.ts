import { RowanError, type AssetData, type ProjectArchive } from '@rowan/core';

export interface ProjectSummary {
  readonly id: string;
  readonly name: string;
  /** Milliseconds since the Unix epoch. */
  readonly updatedAt: number;
}

/** Where the editor keeps projects between sessions. */
export interface ProjectStore {
  /** All stored projects, most recently saved first. */
  list(): Promise<ProjectSummary[]>;
  load(id: string): Promise<ProjectArchive | null>;
  save(archive: ProjectArchive): Promise<void>;
  delete(id: string): Promise<void>;
}

interface StoredProject extends ProjectSummary {
  readonly manifest: ProjectArchive['manifest'];
  readonly files: [id: string, data: AssetData][];
}

function toStored(archive: ProjectArchive, updatedAt: number): StoredProject {
  return {
    id: archive.manifest.id,
    name: archive.manifest.settings.name,
    updatedAt,
    manifest: archive.manifest,
    files: [...archive.files],
  };
}

function toArchive(stored: StoredProject): ProjectArchive {
  return { manifest: stored.manifest, files: new Map(stored.files) };
}

function byMostRecent(a: ProjectSummary, b: ProjectSummary): number {
  return b.updatedAt - a.updatedAt;
}

/** Keeps projects in memory only. Used in tests and when IndexedDB is unavailable. */
export class MemoryProjectStore implements ProjectStore {
  private readonly projects = new Map<string, StoredProject>();

  constructor(private readonly now: () => number = Date.now) {}

  list(): Promise<ProjectSummary[]> {
    const summaries = [...this.projects.values()].map(({ id, name, updatedAt }) => ({
      id,
      name,
      updatedAt,
    }));
    return Promise.resolve(summaries.sort(byMostRecent));
  }

  load(id: string): Promise<ProjectArchive | null> {
    const stored = this.projects.get(id);
    return Promise.resolve(stored ? toArchive(structuredClone(stored)) : null);
  }

  save(archive: ProjectArchive): Promise<void> {
    this.projects.set(archive.manifest.id, structuredClone(toStored(archive, this.now())));
    return Promise.resolve();
  }

  delete(id: string): Promise<void> {
    this.projects.delete(id);
    return Promise.resolve();
  }
}

const STORE_NAME = 'projects';
const DATABASE_VERSION = 1;

/** Keeps projects in the browser's IndexedDB, so they survive closing the tab. */
export class IndexedDbProjectStore implements ProjectStore {
  private database: Promise<IDBDatabase> | null = null;

  constructor(
    private readonly factory: IDBFactory = indexedDB,
    private readonly databaseName = 'rowan-editor',
    private readonly now: () => number = Date.now,
  ) {}

  async list(): Promise<ProjectSummary[]> {
    const stored = await this.run<StoredProject[]>('readonly', (store) => store.getAll());
    return stored.map(({ id, name, updatedAt }) => ({ id, name, updatedAt })).sort(byMostRecent);
  }

  async load(id: string): Promise<ProjectArchive | null> {
    const stored = await this.run<StoredProject | undefined>('readonly', (store) => store.get(id));
    return stored ? toArchive(stored) : null;
  }

  async save(archive: ProjectArchive): Promise<void> {
    await this.run('readwrite', (store) => store.put(toStored(archive, this.now())));
  }

  async delete(id: string): Promise<void> {
    await this.run('readwrite', (store) => store.delete(id));
  }

  /** Closes the database connection. A later call opens it again. */
  async close(): Promise<void> {
    const database = this.database;
    this.database = null;
    (await database)?.close();
  }

  private open(): Promise<IDBDatabase> {
    this.database ??= new Promise((resolve, reject) => {
      const request = this.factory.open(this.databaseName, DATABASE_VERSION);
      request.onupgradeneeded = () => {
        request.result.createObjectStore(STORE_NAME, { keyPath: 'id' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => {
        this.database = null;
        reject(storageError('open the project database', request.error));
      };
      request.onblocked = () => {
        this.database = null;
        reject(new RowanError('The project database is in use by another tab'));
      };
    });
    return this.database;
  }

  /** Runs one request in its own transaction and resolves once the transaction commits. */
  private async run<T>(
    mode: IDBTransactionMode,
    createRequest: (store: IDBObjectStore) => IDBRequest,
  ): Promise<T> {
    const database = await this.open();
    return new Promise<T>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, mode);
      const request = createRequest(transaction.objectStore(STORE_NAME));
      transaction.oncomplete = () => resolve(request.result as T);
      transaction.onerror = () => reject(storageError('access stored projects', transaction.error));
      transaction.onabort = () =>
        reject(storageError('save the project; storage may be full', transaction.error));
    });
  }
}

function storageError(action: string, cause: DOMException | null): RowanError {
  return new RowanError(`Could not ${action}${cause ? `: ${cause.message}` : ''}`, { cause });
}
