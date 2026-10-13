import { describe, expect, it, vi } from 'vitest';
import { inflateSync } from 'node:zlib';
import { RowanError } from '../core/assert';
import {
  compareAssetPaths,
  detectAssetType,
  getBaseName,
  getDirectoryName,
  getFileExtension,
  getNameWithoutExtension,
  getSupportedExtensions,
  isInFolder,
  isTextAssetType,
  joinAssetPath,
} from './asset';
import { AssetDatabase, normalizeAssetName } from './assetDatabase';
import { encodePng, readPngSize } from './png';
import {
  createDefaultSettings,
  parseManifest,
  parseSettings,
  Project,
  PROJECT_FORMAT,
  PROJECT_VERSION,
} from './project';
import { encodeWav, generateTone } from './wav';

const PNG = { type: 'texture', mimeType: 'image/png' } as const;
const SCRIPT = { type: 'script', mimeType: 'text/typescript' } as const;

describe('asset paths and types', () => {
  it('splits paths', () => {
    expect(getBaseName('Sprites/Hero/idle.png')).toBe('idle.png');
    expect(getBaseName('idle.png')).toBe('idle.png');
    expect(getDirectoryName('Sprites/Hero/idle.png')).toBe('Sprites/Hero');
    expect(getDirectoryName('idle.png')).toBe('');
    expect(getFileExtension('Sprites/idle.PNG')).toBe('png');
    expect(getFileExtension('folder.v2/readme')).toBe('');
    expect(getFileExtension('.hidden')).toBe('');
    expect(getNameWithoutExtension('Sprites/idle.final.png')).toBe('idle.final');
    expect(getNameWithoutExtension('.hidden')).toBe('.hidden');
  });

  it('puts names into folders and tells what is inside a folder', () => {
    expect(joinAssetPath('Sprites/Hero', 'idle.png')).toBe('Sprites/Hero/idle.png');
    expect(joinAssetPath('', 'idle.png')).toBe('idle.png');

    expect(isInFolder('Sprites/Hero/idle.png', 'Sprites')).toBe(true);
    expect(isInFolder('Sprites/Hero', 'Sprites')).toBe(true);
    // A folder is not inside itself, and a longer name is another folder.
    expect(isInFolder('Sprites', 'Sprites')).toBe(false);
    expect(isInFolder('Sprites 2/idle.png', 'Sprites')).toBe(false);
    // Everything is inside the top level.
    expect(isInFolder('idle.png', '')).toBe(true);
    expect(isInFolder('', '')).toBe(false);
  });

  it('orders paths the way a tree shows them', () => {
    const paths = ['Art 2', 'Art/Characters', 'Sounds', 'Art', 'Art/Characters/Hero', 'art'];
    // As plain text "Art 2" would come between "Art" and what is in "Art".
    expect(paths.sort(compareAssetPaths)).toEqual([
      'art',
      'Art',
      'Art/Characters',
      'Art/Characters/Hero',
      'Art 2',
      'Sounds',
    ]);
  });

  it('detects asset types from file extensions', () => {
    expect(detectAssetType('a/hero.png')).toEqual({ type: 'texture', mimeType: 'image/png' });
    expect(detectAssetType('art.SVG')).toEqual({ type: 'texture', mimeType: 'image/svg+xml' });
    expect(detectAssetType('jump.wav')).toEqual({ type: 'audio', mimeType: 'audio/wav' });
    expect(detectAssetType('Player.ts')?.type).toBe('script');
    expect(detectAssetType('Level.scene')?.type).toBe('scene');
    expect(detectAssetType('Crate.prefab')?.type).toBe('prefab');
    expect(detectAssetType('notes.txt')).toBeNull();
  });

  it('lists supported extensions, optionally by type', () => {
    expect(getSupportedExtensions('audio')).toContain('ogg');
    expect(getSupportedExtensions('audio')).not.toContain('png');
    expect(getSupportedExtensions()).toEqual(expect.arrayContaining(['png', 'wav', 'ts']));
  });

  it('knows which asset types are text', () => {
    expect(isTextAssetType('script')).toBe(true);
    expect(isTextAssetType('scene')).toBe(true);
    expect(isTextAssetType('prefab')).toBe(true);
    expect(isTextAssetType('texture')).toBe(false);
    expect(isTextAssetType('audio')).toBe(false);
  });

  it('normalizes asset names', () => {
    expect(normalizeAssetName(' Sprites\\\\Hero//idle.png ')).toBe('Sprites/Hero/idle.png');
    expect(normalizeAssetName('../../etc/./passwd')).toBe('etc/passwd');
    expect(() => normalizeAssetName(' / ')).toThrow(RowanError);
  });
});

describe('AssetDatabase', () => {
  it('creates, reads and lists assets sorted by name', () => {
    const assets = new AssetDatabase();
    const script = assets.create({ name: 'Scripts/Player.ts', ...SCRIPT, data: 'code' });
    const texture = assets.create({
      name: 'Art/hero.png',
      ...PNG,
      data: new Uint8Array([1, 2]),
      meta: { width: 16, height: 8 },
    });

    expect(assets.size).toBe(2);
    expect(assets.get(texture.id)).toBe(texture);
    expect(assets.has(script.id)).toBe(true);
    expect(assets.require(script.id).name).toBe('Scripts/Player.ts');
    expect(texture.meta).toEqual({ width: 16, height: 8 });
    expect(assets.getText(script.id)).toBe('code');
    expect(assets.getBytes(texture.id)).toEqual(new Uint8Array([1, 2]));
    expect(assets.list().map((record) => record.name)).toEqual([
      'Art/hero.png',
      'Scripts/Player.ts',
    ]);
    expect(assets.list('script')).toEqual([script]);
  });

  it('reports missing assets and content of the wrong kind', () => {
    const assets = new AssetDatabase();
    const script = assets.create({ name: 'a.ts', ...SCRIPT, data: '' });
    const texture = assets.create({ name: 'a.png', ...PNG, data: new Uint8Array() });
    expect(assets.get('missing')).toBeUndefined();
    expect(() => assets.require('missing')).toThrow('does not exist');
    expect(() => assets.getData('missing')).toThrow('does not exist');
    expect(() => assets.getBytes(script.id)).toThrow('not a binary asset');
    expect(() => assets.getText(texture.id)).toThrow('not a text asset');
  });

  it('rejects content that does not match the asset type', () => {
    const assets = new AssetDatabase();
    expect(() => assets.create({ name: 'a.png', ...PNG, data: 'text' })).toThrow(
      'needs binary content',
    );
    const script = assets.create({ name: 'a.ts', ...SCRIPT, data: '' });
    expect(() => assets.setData(script.id, new Uint8Array())).toThrow('needs text content');
  });

  it('rejects duplicate ids and makes duplicate names unique', () => {
    const assets = new AssetDatabase();
    assets.create({ id: 'one', name: 'Art/hero.png', ...PNG, data: new Uint8Array() });
    expect(() =>
      assets.create({ id: 'one', name: 'other.png', ...PNG, data: new Uint8Array() }),
    ).toThrow('already exists');
    expect(assets.create({ name: 'Art/hero.png', ...PNG, data: new Uint8Array() }).name).toBe(
      'Art/hero 1.png',
    );
    expect(assets.create({ name: 'Art/hero.png', ...PNG, data: new Uint8Array() }).name).toBe(
      'Art/hero 2.png',
    );
    assets.create({ name: 'README', ...SCRIPT, data: '' });
    expect(assets.makeUniqueName('README')).toBe('README 1');
  });

  it('updates content and merges metadata', () => {
    const assets = new AssetDatabase();
    const changed = vi.fn();
    assets.onChanged.connect(changed);
    const texture = assets.create({
      name: 'a.png',
      ...PNG,
      data: new Uint8Array([1]),
      meta: { width: 1, height: 1 },
    });
    assets.setData(texture.id, new Uint8Array([2, 3]), { width: 2 });
    expect(assets.getBytes(texture.id)).toEqual(new Uint8Array([2, 3]));
    expect(texture.meta).toEqual({ width: 2, height: 1 });
    expect(changed).toHaveBeenCalledExactlyOnceWith(texture);
  });

  it('renames assets, keeping names unique', () => {
    const assets = new AssetDatabase();
    const renamed = vi.fn();
    assets.onRenamed.connect(renamed);
    const first = assets.create({ name: 'a.ts', ...SCRIPT, data: '' });
    const second = assets.create({ name: 'b.ts', ...SCRIPT, data: '' });

    expect(assets.rename(second.id, 'a.ts')).toBe('a 1.ts');
    expect(assets.rename(first.id, 'a.ts')).toBe('a.ts');
    expect(assets.rename(first.id, 'Scripts/main.ts')).toBe('Scripts/main.ts');
    expect(renamed).toHaveBeenCalledTimes(2);
  });

  it('removes assets and announces it', () => {
    const assets = new AssetDatabase();
    const added = vi.fn();
    const removed = vi.fn();
    assets.onAdded.connect(added);
    assets.onRemoved.connect(removed);
    const record = assets.create({ name: 'a.ts', ...SCRIPT, data: '' });
    expect(added).toHaveBeenCalledExactlyOnceWith(record);
    expect(assets.remove(record.id)).toBe(true);
    expect(assets.remove(record.id)).toBe(false);
    expect(assets.has(record.id)).toBe(false);
    expect(removed).toHaveBeenCalledExactlyOnceWith(record);
  });

  it('has the folders its assets are in, and keeps them when they are empty', () => {
    const assets = new AssetDatabase();
    const changed = vi.fn();
    assets.onFoldersChanged.connect(changed);
    expect(assets.listFolders()).toEqual([]);

    const idle = assets.create({ name: 'Sprites/Hero/idle.png', ...PNG, data: new Uint8Array(1) });
    const main = assets.create({ name: 'main.ts', ...SCRIPT, data: '' });
    expect(assets.listFolders()).toEqual(['Sprites', 'Sprites/Hero']);
    expect(assets.hasFolder('Sprites/Hero')).toBe(true);
    expect(assets.hasFolder('Hero')).toBe(false);

    // Renaming an asset into a folder makes the folder, and leaving one does not remove it.
    assets.rename(main.id, 'Scripts/main.ts');
    assets.rename(idle.id, 'idle.png');
    assets.remove(main.id);
    expect(assets.listFolders()).toEqual(['Scripts', 'Sprites', 'Sprites/Hero']);
    // Folders that come with an asset are announced by the asset.
    expect(changed).not.toHaveBeenCalled();
  });

  it('makes folders by themselves, with the folders above them', () => {
    const assets = new AssetDatabase();
    const changed = vi.fn();
    assets.onFoldersChanged.connect(changed);

    expect(assets.createFolder(' Art\\Characters// ')).toBe('Art/Characters');
    expect(assets.listFolders()).toEqual(['Art', 'Art/Characters']);
    expect(changed).toHaveBeenCalledTimes(1);

    // A folder that is there already is left as it is.
    expect(assets.createFolder('Art')).toBe('Art');
    expect(changed).toHaveBeenCalledTimes(1);
    expect(() => assets.createFolder(' / ')).toThrow(RowanError);
  });

  it('moves a folder with everything in it, which is also how it is renamed', () => {
    const assets = new AssetDatabase();
    const idle = assets.create({ name: 'Art/Hero/idle.png', ...PNG, data: new Uint8Array(1) });
    const tree = assets.create({ name: 'Art/tree.png', ...PNG, data: new Uint8Array(1) });
    const other = assets.create({ name: 'Art 2/rock.png', ...PNG, data: new Uint8Array(1) });
    assets.createFolder('Art/Empty');
    const renamed = vi.fn();
    const changed = vi.fn();
    assets.onRenamed.connect(renamed);
    assets.onFoldersChanged.connect(() => {
      // Listeners see the move when all of it is done.
      changed(assets.listFolders(), idle.name);
    });

    expect(assets.moveFolder('Art', 'Game/Graphics')).toBe('Game/Graphics');
    expect(idle.name).toBe('Game/Graphics/Hero/idle.png');
    expect(tree.name).toBe('Game/Graphics/tree.png');
    expect(other.name).toBe('Art 2/rock.png');
    expect(assets.listFolders()).toEqual([
      'Art 2',
      'Game',
      'Game/Graphics',
      'Game/Graphics/Empty',
      'Game/Graphics/Hero',
    ]);
    expect(renamed).toHaveBeenCalledTimes(2);
    expect(renamed).toHaveBeenNthCalledWith(1, idle);
    expect(renamed).toHaveBeenNthCalledWith(2, tree);
    expect(changed).toHaveBeenCalledExactlyOnceWith(
      assets.listFolders(),
      'Game/Graphics/Hero/idle.png',
    );
    // The assets are the same ones: whatever refers to them by id still finds them.
    expect(assets.get(idle.id)).toBe(idle);
  });

  it('refuses to move a folder that is not there, into itself, or onto another one', () => {
    const assets = new AssetDatabase();
    assets.createFolder('Art/Hero');
    assets.createFolder('Sounds');
    const changed = vi.fn();
    assets.onFoldersChanged.connect(changed);

    expect(() => assets.moveFolder('Music', 'Sounds/Music')).toThrow('There is no folder "Music"');
    expect(() => assets.moveFolder('Art', 'Art/Hero/Art')).toThrow('cannot be moved into itself');
    expect(() => assets.moveFolder('Art', 'Sounds')).toThrow(
      'There is already a folder "Sounds". Choose another name.',
    );
    // Moving a folder to where it is changes nothing.
    expect(assets.moveFolder('Art', 'Art')).toBe('Art');
    expect(assets.listFolders()).toEqual(['Art', 'Art/Hero', 'Sounds']);
    expect(changed).not.toHaveBeenCalled();
  });

  it('removes a folder with the folders and the assets in it', () => {
    const assets = new AssetDatabase();
    const idle = assets.create({ name: 'Art/Hero/idle.png', ...PNG, data: new Uint8Array(1) });
    const rock = assets.create({ name: 'Art 2/rock.png', ...PNG, data: new Uint8Array(1) });
    const removed = vi.fn();
    const changed = vi.fn();
    assets.onRemoved.connect(removed);
    assets.onFoldersChanged.connect(changed);

    expect(assets.removeFolder('Art')).toEqual([idle]);
    expect(assets.has(idle.id)).toBe(false);
    expect(() => assets.getData(idle.id)).toThrow(RowanError);
    expect(assets.has(rock.id)).toBe(true);
    expect(assets.listFolders()).toEqual(['Art 2']);
    expect(removed).toHaveBeenCalledExactlyOnceWith(idle);
    expect(changed).toHaveBeenCalledTimes(1);

    expect(assets.removeFolder('Art')).toEqual([]);
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it('finds assets by full path, base name or bare name', () => {
    const assets = new AssetDatabase();
    const hero = assets.create({ name: 'Art/hero.png', ...PNG, data: new Uint8Array() });
    const script = assets.create({ name: 'Scripts/hero.ts', ...SCRIPT, data: '' });
    expect(assets.findByName('Art/hero.png')).toBe(hero);
    expect(assets.findByName('hero.png')).toBe(hero);
    expect(assets.findByName('hero', 'script')).toBe(script);
    expect(assets.findByName('hero', 'texture')).toBe(hero);
    expect(assets.findByName('Other/hero.png')).toBeUndefined();
    expect(assets.findByName('villain')).toBeUndefined();
  });

  it('resolves references by id before name and respects the type', () => {
    const assets = new AssetDatabase();
    const hero = assets.create({ id: 'hero-id', name: 'hero.png', ...PNG, data: new Uint8Array() });
    expect(assets.resolve('hero-id')).toBe(hero);
    expect(assets.resolve('hero')).toBe(hero);
    expect(assets.resolve('hero-id', 'audio')).toBeUndefined();
    expect(assets.resolve('nothing')).toBeUndefined();
  });
});

describe('Project', () => {
  function createProject(): Project {
    const project = new Project(createDefaultSettings('Demo'));
    const scene = project.assets.create({
      name: 'Main.scene',
      type: 'scene',
      mimeType: 'application/json',
      data: '{}',
    });
    project.assets.create({ name: 'a.png', ...PNG, data: new Uint8Array([9]), meta: { width: 1 } });
    project.settings.startScene = scene.id;
    return project;
  }

  it('starts with sensible default settings', () => {
    const settings = createDefaultSettings();
    expect(settings.name).toBe('New Project');
    expect(settings.startScene).toBeNull();
    expect(settings.physics).toEqual({
      gravity: [0, -9.81],
      fixedTimeStep: 1 / 60,
      layers: ['Default'],
      ignoredLayerPairs: [],
    });
    expect(settings.rendering).toEqual({ width: 1280, height: 720, pixelArt: false });
  });

  it('round-trips through an archive', () => {
    const project = createProject();
    const archive = project.toArchive();
    expect(archive.manifest.format).toBe(PROJECT_FORMAT);
    expect(archive.manifest.version).toBe(PROJECT_VERSION);

    const restored = Project.fromArchive({
      manifest: JSON.parse(JSON.stringify(archive.manifest)),
      files: archive.files,
    });
    expect(restored.id).toBe(project.id);
    expect(restored.settings).toEqual(project.settings);
    expect(restored.toArchive().manifest).toEqual(archive.manifest);
    expect(restored.assets.getBytes(restored.assets.findByName('a.png')!.id)).toEqual(
      new Uint8Array([9]),
    );
  });

  it('saves the folders of a project, the empty ones too', () => {
    const project = createProject();
    project.assets.create({ name: 'Scripts/Enemies/Bat.ts', ...SCRIPT, data: '' });
    project.assets.createFolder('Sounds/Music');
    const archive = project.toArchive();
    expect(archive.manifest.folders).toEqual([
      'Scripts',
      'Scripts/Enemies',
      'Sounds',
      'Sounds/Music',
    ]);

    const restored = Project.fromArchive({
      manifest: JSON.parse(JSON.stringify(archive.manifest)),
      files: archive.files,
    });
    expect(restored.assets.listFolders()).toEqual(archive.manifest.folders);
  });

  it('reads a project that was saved before there were folders', () => {
    const { manifest, files } = createProject().toArchive();
    const { folders: _folders, ...older } = manifest;
    older.assets[0]!.name = 'Scenes/Main.scene';
    expect(parseManifest(older).folders).toEqual([]);
    // The folders its assets are in are there all the same.
    expect(Project.fromArchive({ manifest: older, files }).assets.listFolders()).toEqual([
      'Scenes',
    ]);
  });

  it('copies settings into the archive instead of sharing them', () => {
    const project = createProject();
    const archive = project.toArchive();
    project.settings.physics.gravity[1] = 0;
    expect(archive.manifest.settings.physics.gravity[1]).toBe(-9.81);
  });

  it('refuses an archive that is missing asset content', () => {
    const archive = createProject().toArchive();
    expect(() => Project.fromArchive({ manifest: archive.manifest, files: new Map() })).toThrow(
      'missing the content of asset',
    );
  });

  it.each([
    [null, 'project: expected an object'],
    [{ format: 'nope' }, 'expected format "rowan.project"'],
    [{ format: PROJECT_FORMAT, assets: [] }, 'missing or invalid version'],
    [{ format: PROJECT_FORMAT, version: 99, assets: [] }, 'newer version of Rowan'],
    [{ format: PROJECT_FORMAT, version: 1 }, 'project.assets: expected an array'],
    [{ format: PROJECT_FORMAT, version: 1, assets: [1] }, 'assets[0]: expected an object'],
    [{ format: PROJECT_FORMAT, version: 1, assets: [{ id: '' }] }, 'assets[0].id'],
    [{ format: PROJECT_FORMAT, version: 1, assets: [{ id: 'a', name: '' }] }, 'assets[0].name'],
    [
      { format: PROJECT_FORMAT, version: 1, assets: [{ id: 'a', name: 'n', type: 'video' }] },
      'unknown asset type "video"',
    ],
    [{ format: PROJECT_FORMAT, version: 1, assets: [], folders: 'Art' }, 'project.folders'],
    [{ format: PROJECT_FORMAT, version: 1, assets: [], folders: ['Art', 7] }, 'folders[1]'],
    [{ format: PROJECT_FORMAT, version: 1, assets: [], folders: [' '] }, 'folders[0]'],
  ])('rejects a malformed manifest %#', (data, message) => {
    expect(() => parseManifest(data)).toThrow(message);
  });

  it('fills in defaults for missing or invalid manifest values', () => {
    const manifest = parseManifest({
      format: PROJECT_FORMAT,
      version: 1,
      assets: [{ id: 'a', name: 'n.png', type: 'texture', meta: { width: 4, bad: {} } }],
    });
    expect(manifest.id).not.toBe('');
    expect(manifest.settings).toEqual(createDefaultSettings());
    expect(manifest.assets[0]).toEqual({
      id: 'a',
      name: 'n.png',
      type: 'texture',
      mimeType: 'application/octet-stream',
      meta: { width: 4 },
    });
  });

  it('repairs invalid settings one value at a time', () => {
    const settings = parseSettings({
      name: '  ',
      startScene: 5,
      physics: { gravity: [0, 'down'], fixedTimeStep: -1 },
      rendering: { width: 640.4, height: 'tall', pixelArt: true },
    });
    expect(settings.name).toBe('New Project');
    expect(settings.startScene).toBeNull();
    expect(settings.physics).toEqual({
      gravity: [0, -9.81],
      fixedTimeStep: 1 / 60,
      layers: ['Default'],
      ignoredLayerPairs: [],
    });
    expect(settings.rendering).toEqual({ width: 640, height: 720, pixelArt: true });
    expect(parseSettings({ physics: { gravity: [1, 2] } }).physics.gravity).toEqual([1, 2]);
  });
});

describe('encodePng', () => {
  it('writes a valid PNG whose pixel data decodes back to the input', () => {
    const pixels = Uint8Array.from({ length: 3 * 2 * 4 }, (_, index) => index * 7);
    const png = encodePng(3, 2, pixels);

    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(readPngSize(png)).toEqual({ width: 3, height: 2 });

    // Chunk layout: signature (8), IHDR (12 + 13), then IDAT: length, type, data, crc.
    const view = new DataView(png.buffer);
    const idatLength = view.getUint32(33);
    expect(String.fromCharCode(...png.subarray(37, 41))).toBe('IDAT');
    const scanlines = inflateSync(png.subarray(41, 41 + idatLength));
    expect(scanlines).toHaveLength(2 * (1 + 3 * 4));
    expect(scanlines[0]).toBe(0);
    expect([...scanlines.subarray(1, 13)]).toEqual([...pixels.subarray(0, 12)]);
    expect([...scanlines.subarray(14, 26)]).toEqual([...pixels.subarray(12, 24)]);
  });

  it('splits large images into several stored blocks', () => {
    const size = 200;
    const pixels = new Uint8Array(size * size * 4).fill(128);
    const png = encodePng(size, size, pixels);
    const idatLength = new DataView(png.buffer).getUint32(33);
    const scanlines = inflateSync(png.subarray(41, 41 + idatLength));
    expect(scanlines).toHaveLength(size * (1 + size * 4));
  });

  it('validates its arguments', () => {
    expect(() => encodePng(0, 1, new Uint8Array())).toThrow(RowanError);
    expect(() => encodePng(1, 1.5, new Uint8Array(4))).toThrow(RowanError);
    expect(() => encodePng(2, 2, new Uint8Array(4))).toThrow('width * height * 4');
  });

  it('reads no size from data that is not a PNG', () => {
    expect(readPngSize(new Uint8Array(100))).toBeNull();
    expect(readPngSize(new Uint8Array(4))).toBeNull();
  });
});

describe('encodeWav', () => {
  it('writes a 16-bit mono PCM header and clamps samples', () => {
    const wav = encodeWav(new Float32Array([0, 1, -1, 2, 0.5]), 8000);
    const view = new DataView(wav.buffer);
    const tag = (offset: number): string =>
      String.fromCharCode(...wav.subarray(offset, offset + 4));

    expect(tag(0)).toBe('RIFF');
    expect(view.getUint32(4, true)).toBe(wav.length - 8);
    expect(tag(8)).toBe('WAVE');
    expect(tag(12)).toBe('fmt ');
    expect(view.getUint16(20, true)).toBe(1);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(8000);
    expect(view.getUint16(34, true)).toBe(16);
    expect(tag(36)).toBe('data');
    expect(view.getUint32(40, true)).toBe(10);
    expect([0, 1, 2, 3, 4].map((index) => view.getInt16(44 + index * 2, true))).toEqual([
      0, 32767, -32767, 32767, 16384,
    ]);
  });

  it('rejects an invalid sample rate', () => {
    expect(() => encodeWav(new Float32Array(1), 0)).toThrow(RowanError);
  });

  it('generates a fading tone of the requested length', () => {
    const tone = generateTone(440, 0.1, 8000);
    expect(tone).toHaveLength(800);
    expect(Math.max(...tone)).toBeLessThanOrEqual(0.5);
    expect(Math.max(...tone.subarray(0, 100))).toBeGreaterThan(Math.max(...tone.subarray(700)));
  });
});
