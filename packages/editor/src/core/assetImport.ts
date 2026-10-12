import {
  describeError,
  detectAssetType,
  getSupportedExtensions,
  parsePrefabData,
  parseSceneData,
  RowanError,
  type AssetData,
  type AssetDatabase,
  type AssetMetaValue,
  type AssetRecord,
  type ImageDecoder,
} from '@rowan/core';

export interface ImportFile {
  readonly name: string;
  readonly bytes: Uint8Array;
}

/**
 * Adds a file to the project as an asset. Images are decoded once to learn their size,
 * and scenes and prefabs are validated, so a broken file is rejected here rather than
 * failing later in the middle of a game.
 *
 * @param folder Project folder to import into; an empty string is the project root.
 */
export async function importAsset(
  assets: AssetDatabase,
  file: ImportFile,
  folder: string,
  decodeImage: ImageDecoder,
): Promise<AssetRecord> {
  const info = detectAssetType(file.name);
  if (!info) {
    throw new RowanError(
      `"${file.name}" is not a supported file type. ` +
        `Supported: ${getSupportedExtensions().join(', ')}`,
    );
  }

  let data: AssetData = file.bytes;
  const meta: Record<string, AssetMetaValue> = {};
  switch (info.type) {
    case 'texture': {
      try {
        const image = await decodeImage(file.bytes, info.mimeType);
        meta.width = image.width;
        meta.height = image.height;
        image.dispose?.();
      } catch (error) {
        throw new RowanError(`Could not read the image "${file.name}": ${describeError(error)}`, {
          cause: error,
        });
      }
      break;
    }
    case 'audio':
      break;
    case 'script':
      data = decodeText(file);
      break;
    case 'scene':
    case 'prefab': {
      data = decodeText(file);
      try {
        const json: unknown = JSON.parse(data);
        if (info.type === 'scene') {
          parseSceneData(json);
        } else {
          parsePrefabData(json);
        }
      } catch (error) {
        throw new RowanError(
          `"${file.name}" is not a valid ${info.type}: ${describeError(error)}`,
          {
            cause: error,
          },
        );
      }
      break;
    }
  }

  return assets.create({
    name: folder ? `${folder}/${file.name}` : file.name,
    type: info.type,
    mimeType: info.mimeType,
    data,
    meta,
  });
}

function decodeText(file: ImportFile): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(file.bytes);
  } catch (error) {
    throw new RowanError(`"${file.name}" is not a UTF-8 text file`, { cause: error });
  }
}
