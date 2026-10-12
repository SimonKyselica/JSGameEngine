import { RowanError } from '../core/assert';
import { generateUuid } from '../core/uuid';
import { ASSET_TYPES, type AssetData, type AssetMetaValue, type AssetRecord } from './asset';
import { AssetDatabase } from './assetDatabase';

export const PROJECT_FORMAT = 'rowan.project';
/** Bump when the project manifest layout changes, and add a migration in `parseManifest`. */
export const PROJECT_VERSION = 1;

export interface PhysicsSettings {
  gravity: [x: number, y: number];
  /** Seconds per physics step. */
  fixedTimeStep: number;
}

export interface RenderingSettings {
  /** Reference resolution. Its aspect ratio is kept by the player and the game view. */
  width: number;
  height: number;
  /** Use nearest-neighbor texture filtering so pixel art stays crisp. */
  pixelArt: boolean;
}

export interface ProjectSettings {
  name: string;
  /** Asset id of the scene the game starts in. */
  startScene: string | null;
  physics: PhysicsSettings;
  rendering: RenderingSettings;
}

/** The serializable description of a project: everything except asset content. */
export interface ProjectManifest {
  format: typeof PROJECT_FORMAT;
  version: number;
  id: string;
  settings: ProjectSettings;
  assets: AssetRecord[];
}

/** A project in its storage-neutral form: a manifest plus each asset's content by id. */
export interface ProjectArchive {
  manifest: ProjectManifest;
  files: Map<string, AssetData>;
}

export function createDefaultSettings(name = 'New Project'): ProjectSettings {
  return {
    name,
    startScene: null,
    physics: { gravity: [0, -9.81], fixedTimeStep: 1 / 60 },
    rendering: { width: 1280, height: 720, pixelArt: false },
  };
}

/** A game project: settings plus the assets (scenes, scripts, textures...) that make it up. */
export class Project {
  readonly assets = new AssetDatabase();

  constructor(
    public settings: ProjectSettings = createDefaultSettings(),
    readonly id: string = generateUuid(),
  ) {}

  /** Captures the project for saving or exporting. Asset content is shared, not copied. */
  toArchive(): ProjectArchive {
    const records = this.assets.list();
    return {
      manifest: {
        format: PROJECT_FORMAT,
        version: PROJECT_VERSION,
        id: this.id,
        settings: structuredClone(this.settings),
        assets: records.map((record) => ({ ...record, meta: { ...record.meta } })),
      },
      files: new Map(records.map((record) => [record.id, this.assets.getData(record.id)])),
    };
  }

  /** Rebuilds a project from an archive. Throws a {@link RowanError} for malformed data. */
  static fromArchive(archive: {
    manifest: unknown;
    files: ReadonlyMap<string, AssetData>;
  }): Project {
    const manifest = parseManifest(archive.manifest);
    const project = new Project(manifest.settings, manifest.id);
    for (const record of manifest.assets) {
      const data = archive.files.get(record.id);
      if (data === undefined) {
        throw new RowanError(`Project is missing the content of asset "${record.name}"`);
      }
      project.assets.create({ ...record, data });
    }
    return project;
  }
}

/** Validates a project manifest loaded from JSON and fills in defaults for missing settings. */
export function parseManifest(data: unknown): ProjectManifest {
  if (!isRecord(data)) {
    throw new RowanError('project: expected an object');
  }
  if (data.format !== PROJECT_FORMAT) {
    throw new RowanError(
      `project: expected format "${PROJECT_FORMAT}" but found "${String(data.format)}"`,
    );
  }
  if (typeof data.version !== 'number' || !Number.isInteger(data.version) || data.version < 1) {
    throw new RowanError('project: missing or invalid version');
  }
  if (data.version > PROJECT_VERSION) {
    throw new RowanError(
      `project: version ${data.version} was saved by a newer version of Rowan ` +
        `(this build reads up to version ${PROJECT_VERSION})`,
    );
  }
  if (!Array.isArray(data.assets)) {
    throw new RowanError('project.assets: expected an array');
  }
  return {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    id: typeof data.id === 'string' && data.id !== '' ? data.id : generateUuid(),
    settings: parseSettings(data.settings),
    assets: data.assets.map((asset: unknown, index) =>
      parseAssetRecord(asset, `project.assets[${index}]`),
    ),
  };
}

/** Validates project settings, replacing anything missing or invalid with its default. */
export function parseSettings(data: unknown): ProjectSettings {
  const defaults = createDefaultSettings();
  if (!isRecord(data)) {
    return defaults;
  }
  const physics = isRecord(data.physics) ? data.physics : {};
  const rendering = isRecord(data.rendering) ? data.rendering : {};
  const gravity = physics.gravity;
  return {
    name: typeof data.name === 'string' && data.name.trim() !== '' ? data.name : defaults.name,
    startScene: typeof data.startScene === 'string' ? data.startScene : null,
    physics: {
      gravity:
        Array.isArray(gravity) && gravity.length === 2 && gravity.every(isFiniteNumber)
          ? [gravity[0]!, gravity[1]!]
          : defaults.physics.gravity,
      fixedTimeStep: positiveOr(physics.fixedTimeStep, defaults.physics.fixedTimeStep),
    },
    rendering: {
      width: Math.round(positiveOr(rendering.width, defaults.rendering.width)),
      height: Math.round(positiveOr(rendering.height, defaults.rendering.height)),
      pixelArt: rendering.pixelArt === true,
    },
  };
}

function parseAssetRecord(data: unknown, path: string): AssetRecord {
  if (!isRecord(data)) {
    throw new RowanError(`${path}: expected an object`);
  }
  const { id, name, type, mimeType, meta } = data;
  if (typeof id !== 'string' || id === '') {
    throw new RowanError(`${path}.id: expected a non-empty string`);
  }
  if (typeof name !== 'string' || name === '') {
    throw new RowanError(`${path}.name: expected a non-empty string`);
  }
  const assetType = ASSET_TYPES.find((candidate) => candidate === type);
  if (!assetType) {
    throw new RowanError(`${path}.type: unknown asset type "${String(type)}"`);
  }
  const parsedMeta: Record<string, AssetMetaValue> = {};
  if (isRecord(meta)) {
    for (const [key, value] of Object.entries(meta)) {
      if (typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean') {
        parsedMeta[key] = value;
      }
    }
  }
  return {
    id,
    name,
    type: assetType,
    mimeType: typeof mimeType === 'string' ? mimeType : 'application/octet-stream',
    meta: parsedMeta,
  };
}

function positiveOr(value: unknown, fallback: number): number {
  return isFiniteNumber(value) && value > 0 ? value : fallback;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
