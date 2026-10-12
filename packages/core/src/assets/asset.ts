/** The kinds of asset a project can contain. */
export type AssetType = 'texture' | 'audio' | 'script' | 'scene' | 'prefab';

export const ASSET_TYPES: readonly AssetType[] = ['texture', 'audio', 'script', 'scene', 'prefab'];

export type AssetMetaValue = number | string | boolean;

/** Describes one asset. The asset's content is stored separately in the {@link AssetDatabase}. */
export interface AssetRecord {
  /** Stable unique id. References between assets and scenes always use this id. */
  readonly id: string;
  /** Project-relative path with forward slashes, for example `Sprites/player.png`. */
  name: string;
  readonly type: AssetType;
  readonly mimeType: string;
  /** Import-time facts about the content, such as a texture's `width` and `height`. */
  meta: Record<string, AssetMetaValue>;
}

/** Text assets (scripts, scenes, prefabs) hold strings; binary assets hold bytes. */
export type AssetData = string | Uint8Array;

export interface AssetTypeInfo {
  readonly type: AssetType;
  readonly mimeType: string;
}

const EXTENSION_TYPES: Readonly<Record<string, AssetTypeInfo>> = {
  png: { type: 'texture', mimeType: 'image/png' },
  jpg: { type: 'texture', mimeType: 'image/jpeg' },
  jpeg: { type: 'texture', mimeType: 'image/jpeg' },
  webp: { type: 'texture', mimeType: 'image/webp' },
  gif: { type: 'texture', mimeType: 'image/gif' },
  bmp: { type: 'texture', mimeType: 'image/bmp' },
  avif: { type: 'texture', mimeType: 'image/avif' },
  svg: { type: 'texture', mimeType: 'image/svg+xml' },
  wav: { type: 'audio', mimeType: 'audio/wav' },
  mp3: { type: 'audio', mimeType: 'audio/mpeg' },
  ogg: { type: 'audio', mimeType: 'audio/ogg' },
  oga: { type: 'audio', mimeType: 'audio/ogg' },
  m4a: { type: 'audio', mimeType: 'audio/mp4' },
  aac: { type: 'audio', mimeType: 'audio/aac' },
  flac: { type: 'audio', mimeType: 'audio/flac' },
  weba: { type: 'audio', mimeType: 'audio/webm' },
  ts: { type: 'script', mimeType: 'text/typescript' },
  js: { type: 'script', mimeType: 'text/javascript' },
  scene: { type: 'scene', mimeType: 'application/json' },
  prefab: { type: 'prefab', mimeType: 'application/json' },
};

/** True for asset types whose content is text rather than bytes. */
export function isTextAssetType(type: AssetType): boolean {
  return type === 'script' || type === 'scene' || type === 'prefab';
}

/** The lower-case extension of a file name without the dot, or an empty string. */
export function getFileExtension(fileName: string): string {
  const baseName = getBaseName(fileName);
  const dot = baseName.lastIndexOf('.');
  return dot <= 0 ? '' : baseName.slice(dot + 1).toLowerCase();
}

/** The last segment of a path. */
export function getBaseName(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash === -1 ? path : path.slice(slash + 1);
}

/** The folder part of a path without a trailing slash, or an empty string for the root. */
export function getDirectoryName(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash === -1 ? '' : path.slice(0, slash);
}

/** The base name of a path without its extension. */
export function getNameWithoutExtension(path: string): string {
  const baseName = getBaseName(path);
  const dot = baseName.lastIndexOf('.');
  return dot <= 0 ? baseName : baseName.slice(0, dot);
}

/** Works out the asset type for a file from its extension. Returns `null` when unsupported. */
export function detectAssetType(fileName: string): AssetTypeInfo | null {
  return EXTENSION_TYPES[getFileExtension(fileName)] ?? null;
}

/** File extensions the engine can import, without dots. */
export function getSupportedExtensions(type?: AssetType): string[] {
  return Object.entries(EXTENSION_TYPES)
    .filter(([, info]) => type === undefined || info.type === type)
    .map(([extension]) => extension);
}
