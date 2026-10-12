import {
  getFileExtension,
  isTextAssetType,
  type AssetData,
  type AssetRecord,
} from '../assets/asset';
import { parseManifest, Project, PROJECT_FORMAT, type ProjectSettings } from '../assets/project';
import { RowanError } from '../core/assert';
import { decodeBase64, encodeBase64 } from '../core/base64';
import { ENGINE_VERSION } from '../version';

export const GAME_BUNDLE_FORMAT = 'rowan.game';
/** Bump when the bundle layout changes in a way older players cannot read. */
export const GAME_BUNDLE_VERSION = 1;

/** An asset inside an exported game. Exactly one of `text`, `file` and `base64` is set. */
export interface GameBundleAsset extends AssetRecord {
  /** Content of a scene or prefab. Scripts ship precompiled and carry an empty string. */
  text?: string;
  /** Path of a binary asset, relative to the bundle manifest. */
  file?: string;
  /** Content of a binary asset embedded in the manifest. */
  base64?: string;
}

/** The manifest of an exported game: everything the player needs to run it. */
export interface GameBundle {
  format: typeof GAME_BUNDLE_FORMAT;
  version: number;
  engineVersion: string;
  projectId: string;
  settings: ProjectSettings;
  assets: GameBundleAsset[];
}

export interface CreateBundleOptions {
  /** Embed binary assets in the manifest instead of referring to separate files. */
  readonly inlineBinaryAssets: boolean;
}

export interface CreatedBundle {
  readonly bundle: GameBundle;
  /** Binary assets to store next to the manifest, keyed by their `file` path. */
  readonly files: Map<string, Uint8Array>;
}

/** Packs a project for distribution. Script sources are left out; they ship compiled. */
export function createGameBundle(project: Project, options: CreateBundleOptions): CreatedBundle {
  const files = new Map<string, Uint8Array>();
  const assets = project.assets.list().map((record): GameBundleAsset => {
    const base: AssetRecord = { ...record, meta: { ...record.meta } };
    if (record.type === 'script') {
      return { ...base, text: '' };
    }
    if (isTextAssetType(record.type)) {
      return { ...base, text: project.assets.getText(record.id) };
    }
    const bytes = project.assets.getBytes(record.id);
    if (options.inlineBinaryAssets) {
      return { ...base, base64: encodeBase64(bytes) };
    }
    const extension = getFileExtension(record.name);
    const file = `assets/${record.id}${extension ? `.${extension}` : ''}`;
    files.set(file, bytes);
    return { ...base, file };
  });

  return {
    bundle: {
      format: GAME_BUNDLE_FORMAT,
      version: GAME_BUNDLE_VERSION,
      engineVersion: ENGINE_VERSION,
      projectId: project.id,
      settings: structuredClone(project.settings),
      assets,
    },
    files,
  };
}

/**
 * Rebuilds a project from an exported game bundle.
 *
 * @param readFile Loads a binary asset by the `file` path recorded in the manifest.
 */
export async function loadGameBundle(
  data: unknown,
  readFile: (path: string) => Promise<Uint8Array>,
): Promise<Project> {
  if (typeof data !== 'object' || data === null) {
    throw new RowanError('game bundle: expected an object');
  }
  const bundle = data as Partial<GameBundle>;
  if (bundle.format !== GAME_BUNDLE_FORMAT) {
    throw new RowanError(`game bundle: expected format "${GAME_BUNDLE_FORMAT}"`);
  }
  if (typeof bundle.version !== 'number' || bundle.version > GAME_BUNDLE_VERSION) {
    throw new RowanError(
      `game bundle: version ${String(bundle.version)} is not supported by this player ` +
        `(it reads up to version ${GAME_BUNDLE_VERSION})`,
    );
  }
  if (!Array.isArray(bundle.assets)) {
    throw new RowanError('game bundle: expected an array of assets');
  }

  // The asset records share the project manifest layout, so validate them the same way.
  const manifest = parseManifest({
    format: PROJECT_FORMAT,
    version: 1,
    id: bundle.projectId,
    settings: bundle.settings,
    assets: bundle.assets,
  });

  const entries = bundle.assets;
  const contents = await Promise.all(
    manifest.assets.map(async (record, index): Promise<[string, AssetData]> => {
      const entry = entries[index]!;
      if (isTextAssetType(record.type)) {
        return [record.id, typeof entry.text === 'string' ? entry.text : ''];
      }
      if (typeof entry.base64 === 'string') {
        return [record.id, decodeBase64(entry.base64)];
      }
      if (typeof entry.file === 'string') {
        return [record.id, await readFile(entry.file)];
      }
      throw new RowanError(`game bundle: asset "${record.name}" has no content`);
    }),
  );
  return Project.fromArchive({ manifest, files: new Map(contents) });
}
