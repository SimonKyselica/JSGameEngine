import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate';
import {
  describeError,
  isTextAssetType,
  parseManifest,
  RowanError,
  type AssetData,
  type ProjectArchive,
} from '@rowan/core';

/** File extension of a project packed into a single file. */
export const PROJECT_FILE_EXTENSION = 'rowanproject';

const MANIFEST_PATH = 'project.json';
const ASSET_FOLDER = 'assets/';

/**
 * Packs a project into one zip file: `project.json` plus one file per asset. Users
 * share and back up projects in this form.
 */
export function packProject(archive: ProjectArchive): Uint8Array {
  const entries: Zippable = {
    [MANIFEST_PATH]: strToU8(JSON.stringify(archive.manifest, null, 2)),
  };
  for (const [id, data] of archive.files) {
    entries[ASSET_FOLDER + id] = typeof data === 'string' ? strToU8(data) : data;
  }
  return zipSync(entries, { level: 6 });
}

/** Reads a project file written by {@link packProject}. Throws for anything else. */
export function unpackProject(bytes: Uint8Array): ProjectArchive {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes);
  } catch (error) {
    throw new RowanError(`This is not a Rowan project file: ${describeError(error)}`, {
      cause: error,
    });
  }
  const manifestBytes = entries[MANIFEST_PATH];
  if (!manifestBytes) {
    throw new RowanError('This is not a Rowan project file: it has no project.json');
  }

  let manifestJson: unknown;
  try {
    manifestJson = JSON.parse(strFromU8(manifestBytes));
  } catch (error) {
    throw new RowanError('The project file is damaged: project.json is not valid JSON', {
      cause: error,
    });
  }
  const manifest = parseManifest(manifestJson);

  const files = new Map<string, AssetData>();
  for (const record of manifest.assets) {
    const data = entries[ASSET_FOLDER + record.id];
    if (!data) {
      throw new RowanError(`The project file is missing the content of "${record.name}"`);
    }
    files.set(record.id, isTextAssetType(record.type) ? strFromU8(data) : data);
  }
  return { manifest, files };
}
