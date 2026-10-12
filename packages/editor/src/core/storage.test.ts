import { IDBFactory } from 'fake-indexeddb';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { describe, expect, it, vi } from 'vitest';
import {
  AssetDatabase,
  createDefaultSettings,
  decodeImageHeadless,
  encodePng,
  GAME_BUNDLE_FORMAT,
  loadGameBundle,
  Project,
  Scene,
  serializeScene,
  type GameBundle,
  type LogEntry,
} from '@rowan/core';
import { createFeatureTestProject } from '@rowan/feature-test';
import { importAsset } from './assetImport';
import { ConsoleStore } from './consoleStore';
import { exportGame, toFileName } from './exportGame';
import { History } from './history';
import { packProject, unpackProject } from './projectFile';
import { IndexedDbProjectStore, MemoryProjectStore, type ProjectStore } from './projectStore';
import {
  addSceneAsset,
  createEmptyScene,
  createScriptSource,
  createStarterProject,
  toClassName,
} from './templates';

const log = (message: string, level: LogEntry['level'] = 'info', source?: string): LogEntry => ({
  level,
  message,
  source,
  timestamp: 1,
});

describe('History', () => {
  it('undoes and redoes by exchanging states', () => {
    const history = new History<string>();
    expect([history.canUndo, history.canRedo]).toEqual([false, false]);
    history.record('a');
    history.record('b');

    expect(history.undo('c')).toBe('b');
    expect(history.undo('b')).toBe('a');
    expect(history.undo('a')).toBeUndefined();
    expect(history.canRedo).toBe(true);
    expect(history.redo('a')).toBe('b');
    expect(history.redo('b')).toBe('c');
    expect(history.redo('c')).toBeUndefined();
  });

  it('drops the redo states when a new change is recorded', () => {
    const history = new History<string>();
    history.record('a');
    history.undo('b');
    history.record('a');
    expect(history.canRedo).toBe(false);
  });

  it('merges quick edits that share a key into one step', () => {
    let time = 0;
    const history = new History<string>(100, () => time);
    history.record('a', 'name');
    time = 500;
    history.record('ab', 'name');
    time = 900;
    history.record('abc', 'name');
    expect(history.undo('abcd')).toBe('a');
    expect(history.canUndo).toBe(false);
  });

  it('does not merge across a pause, a different key or an undo', () => {
    let time = 0;
    const history = new History<string>(100, () => time);
    history.record('1', 'x');
    time = 2000;
    history.record('2', 'x');
    history.record('3', 'y');
    history.record('4');
    history.record('5');
    expect(history.undo('6')).toBe('5');
    history.record('5', 'x');
    history.record('7', 'x');
    expect(history.undo('8')).toBe('5');
    expect(history.undo('5')).toBe('4');
    expect(history.undo('4')).toBe('3');
    expect(history.undo('3')).toBe('2');
    expect(history.undo('2')).toBe('1');
  });

  it('forgets the oldest states beyond its limit and clears', () => {
    const history = new History<number>(2);
    history.record(1);
    history.record(2);
    history.record(3);
    expect(history.undo(4)).toBe(3);
    expect(history.undo(3)).toBe(2);
    expect(history.undo(2)).toBeUndefined();
    history.clear();
    expect([history.canUndo, history.canRedo]).toEqual([false, false]);
  });
});

describe('ConsoleStore', () => {
  it('collects entries and counts repeats of the previous one', () => {
    const store = new ConsoleStore();
    const changed = vi.fn();
    store.onChange.connect(changed);
    store.add(log('hello'));
    store.add(log('hello'));
    store.add(log('hello', 'warn'));
    store.add(log('hello', 'info', 'Player'));
    store.add(log('hello'));

    expect(store.entries.map((entry) => [entry.level, entry.source, entry.count])).toEqual([
      ['info', undefined, 2],
      ['warn', undefined, 1],
      ['info', 'Player', 1],
      ['info', undefined, 1],
    ]);
    expect(store.count('info')).toBe(4);
    expect(store.count('warn')).toBe(1);
    expect(store.count('error')).toBe(0);
    expect(changed).toHaveBeenCalledTimes(5);
    expect(new Set(store.entries.map((entry) => entry.id)).size).toBe(4);
  });

  it('gives React a new array and entry object on every change', () => {
    const store = new ConsoleStore();
    store.add(log('a'));
    const before = store.entries;
    store.add(log('a'));
    expect(store.entries).not.toBe(before);
    expect(store.entries[0]).not.toBe(before[0]);
  });

  it('keeps only the most recent thousand entries', () => {
    const store = new ConsoleStore();
    for (let index = 0; index < 1005; index++) {
      store.add(log(`message ${index}`));
    }
    expect(store.entries).toHaveLength(1000);
    expect(store.entries[0]!.message).toBe('message 5');
  });

  it('clears, notifying only when there was something to clear', () => {
    const store = new ConsoleStore();
    const changed = vi.fn();
    store.onChange.connect(changed);
    store.clear();
    expect(changed).not.toHaveBeenCalled();
    store.add(log('a'));
    store.clear();
    expect(store.entries).toEqual([]);
    expect(changed).toHaveBeenCalledTimes(2);
  });
});

describe.each([
  ['MemoryProjectStore', (now: () => number): ProjectStore => new MemoryProjectStore(now)],
  [
    'IndexedDbProjectStore',
    (now: () => number): ProjectStore => new IndexedDbProjectStore(new IDBFactory(), 'test', now),
  ],
])('%s', (_name, createStore) => {
  it('saves, lists most recent first, loads and deletes projects', async () => {
    let time = 100;
    const store = createStore(() => time);
    const first = createStarterProject('First');
    const second = createStarterProject('Second');
    await store.save(first.toArchive());
    time = 200;
    await store.save(second.toArchive());

    expect(await store.list()).toEqual([
      { id: second.id, name: 'Second', updatedAt: 200 },
      { id: first.id, name: 'First', updatedAt: 100 },
    ]);

    const loaded = Project.fromArchive((await store.load(first.id))!);
    expect(loaded.toArchive().manifest).toEqual(first.toArchive().manifest);

    await store.delete(first.id);
    expect(await store.load(first.id)).toBeNull();
    expect((await store.list()).map((summary) => summary.name)).toEqual(['Second']);
  });

  it('overwrites a project saved again and keeps binary content intact', async () => {
    let time = 1;
    const store = createStore(() => time);
    const project = createStarterProject('Game');
    const texture = project.assets.create({
      name: 'a.png',
      type: 'texture',
      mimeType: 'image/png',
      data: new Uint8Array([1, 2, 3, 250]),
    });
    await store.save(project.toArchive());
    project.settings.name = 'Renamed';
    time = 2;
    await store.save(project.toArchive());

    expect(await store.list()).toEqual([{ id: project.id, name: 'Renamed', updatedAt: 2 }]);
    const loaded = Project.fromArchive((await store.load(project.id))!);
    expect([...loaded.assets.getBytes(texture.id)]).toEqual([1, 2, 3, 250]);
  });

  it('does not share state with the project that was saved', async () => {
    const store = createStore(() => 1);
    const project = createStarterProject('Game');
    await store.save(project.toArchive());
    project.settings.physics.gravity[1] = 0;
    const loaded = await store.load(project.id);
    expect(loaded!.manifest.settings.physics.gravity[1]).toBe(-9.81);
  });

  it('returns null for an unknown project', async () => {
    const store = createStore(() => 1);
    expect(await store.load('missing')).toBeNull();
    await expect(store.delete('missing')).resolves.toBeUndefined();
  });
});

describe('IndexedDbProjectStore', () => {
  it('reopens the database after being closed', async () => {
    const factory = new IDBFactory();
    const store = new IndexedDbProjectStore(factory, 'reopen');
    const project = createStarterProject('Game');
    await store.save(project.toArchive());
    await store.close();
    expect((await store.list()).map((summary) => summary.id)).toEqual([project.id]);

    const otherConnection = new IndexedDbProjectStore(factory, 'reopen');
    expect(await otherConnection.load(project.id)).not.toBeNull();
  });

  it('reports a database that cannot be opened and can try again', async () => {
    const factory = new IDBFactory();
    const open = vi.spyOn(factory, 'open').mockImplementationOnce(() => {
      const request = { error: new DOMException('quota exceeded') } as IDBOpenDBRequest;
      queueMicrotask(() => {
        request.onerror?.(new Event('error'));
      });
      return request;
    });
    const store = new IndexedDbProjectStore(factory, 'broken');
    await expect(store.list()).rejects.toThrow(
      'Could not open the project database: quota exceeded',
    );
    expect(await store.list()).toEqual([]);
    expect(open).toHaveBeenCalledTimes(2);
  });
});

describe('project files', () => {
  it('round-trips a project with text and binary assets', () => {
    const project = createFeatureTestProject();
    const restored = Project.fromArchive(unpackProject(packProject(project.toArchive())));
    expect(restored.toArchive().manifest).toEqual(project.toArchive().manifest);
    for (const record of project.assets.list()) {
      expect(restored.assets.getData(record.id), record.name).toEqual(
        project.assets.getData(record.id),
      );
    }
  });

  it('stores a readable manifest and one file per asset', () => {
    const project = createStarterProject('Demo');
    const entries = unzipSync(packProject(project.toArchive()));
    const manifest = JSON.parse(strFromU8(entries['project.json']!)) as { settings: unknown };
    expect(manifest.settings).toEqual(project.settings);
    expect(Object.keys(entries).sort()).toEqual(
      ['project.json', ...project.assets.list().map((record) => `assets/${record.id}`)].sort(),
    );
  });

  it.each([
    [new Uint8Array([1, 2, 3]), 'This is not a Rowan project file'],
    [zipSync({ 'readme.txt': strToU8('hi') }), 'it has no project.json'],
    [zipSync({ 'project.json': strToU8('{oops') }), 'project.json is not valid JSON'],
    [zipSync({ 'project.json': strToU8('{"format":"other"}') }), 'expected format'],
  ])('rejects a file that is not a project %#', (bytes, message) => {
    expect(() => unpackProject(bytes)).toThrow(message);
  });

  it('rejects a project file with a missing asset', () => {
    const project = createStarterProject('Demo');
    const entries = unzipSync(packProject(project.toArchive()));
    const script = project.assets.list('script')[0]!;
    delete entries[`assets/${script.id}`];
    expect(() => unpackProject(zipSync(entries))).toThrow(
      'missing the content of "Scripts/PlayerController.ts"',
    );
  });
});

describe('exportGame', () => {
  const PLAYER = 'var RowanPlayer = { boot: function () {} };';

  it('builds a zip with the page, the player, compiled scripts and assets', async () => {
    const project = createFeatureTestProject();
    const exported = exportGame(project, PLAYER, 'folder');
    expect(exported.fileName).toBe('rowan-feature-test.zip');
    expect(exported.mimeType).toBe('application/zip');

    const entries = unzipSync(exported.data);
    const textures = project.assets.list('texture');
    const sounds = project.assets.list('audio');
    expect(Object.keys(entries).sort()).toEqual(
      [
        'index.html',
        'rowan-player.js',
        'game/game.json',
        'game/scripts.js',
        ...textures.map((record) => `game/assets/${record.id}.png`),
        ...sounds.map((record) => `game/assets/${record.id}.wav`),
      ].sort(),
    );
    expect(strFromU8(entries['rowan-player.js']!)).toBe(PLAYER);
    expect(strFromU8(entries['index.html']!)).toContain('<title>Rowan Feature Test</title>');

    const scripts = strFromU8(entries['game/scripts.js']!);
    expect(scripts).toContain('__ROWAN_SCRIPTS__');
    // Compiled output: the TypeScript type annotations are gone.
    expect(scripts).not.toContain('implements ScriptLifecycle');

    const bundle = JSON.parse(strFromU8(entries['game/game.json']!)) as GameBundle;
    expect(bundle.format).toBe(GAME_BUNDLE_FORMAT);
    const loaded = await loadGameBundle(bundle, (path) =>
      Promise.resolve(entries[`game/${path}`]!),
    );
    expect(loaded.assets.size).toBe(project.assets.size);
    expect(loaded.assets.getBytes(textures[0]!.id)).toEqual(
      project.assets.getBytes(textures[0]!.id),
    );
  });

  it('ships scripts compiled, not as source assets', () => {
    const project = createFeatureTestProject();
    const entries = unzipSync(exportGame(project, PLAYER, 'folder').data);
    const bundle = JSON.parse(strFromU8(entries['game/game.json']!)) as GameBundle;
    const scripts = bundle.assets.filter((asset) => asset.type === 'script');
    expect(scripts.length).toBeGreaterThan(0);
    expect(scripts.every((asset) => asset.text === '')).toBe(true);
    expect(strFromU8(entries['game/game.json']!)).not.toContain('extends Behaviour');
  });

  it('builds a single page with everything embedded', () => {
    const project = createFeatureTestProject();
    const exported = exportGame(project, PLAYER, 'single-file');
    expect(exported.fileName).toBe('rowan-feature-test.html');
    expect(exported.mimeType).toBe('text/html');
    const html = strFromU8(exported.data);
    expect(html).toContain(PLAYER);
    expect(html).toContain('__ROWAN_SCRIPTS__');
    expect(html).toContain('"format":"rowan.game"');
    expect(html).not.toContain('src="');
  });

  it('refuses to export a project without scenes or with a broken script', () => {
    const empty = new Project(createDefaultSettings('Empty'));
    expect(() => exportGame(empty, PLAYER, 'folder')).toThrow('has no scene to start in');

    const broken = createStarterProject('Broken');
    broken.assets.create({
      name: 'Scripts/Oops.ts',
      type: 'script',
      mimeType: 'text/typescript',
      data: 'export default class {',
    });
    expect(() => exportGame(broken, PLAYER, 'single-file')).toThrow(
      'Script "Scripts/Oops.ts" has a syntax error',
    );
  });

  it('derives safe file names from project names', () => {
    expect(toFileName('My Cool Game!')).toBe('my-cool-game');
    expect(toFileName('  Špeciálna_hra  2 ')).toBe('specialna-hra-2');
    expect(toFileName('../../etc/passwd')).toBe('etcpasswd');
    expect(toFileName('???')).toBe('game');
  });
});

describe('templates', () => {
  it('creates a starter project that is ready to play', () => {
    const project = createStarterProject('Demo');
    expect(project.settings.name).toBe('Demo');
    const scene = project.assets.get(project.settings.startScene!);
    expect(scene?.name).toBe('Scenes/Main.scene');
    expect(project.assets.findByName('Scripts/PlayerController.ts')?.type).toBe('script');
    expect(project.assets.getText(scene!.id)).toContain('"Main Camera"');
  });

  it('adds scenes as assets and creates empty scenes with a camera', () => {
    const assets = new AssetDatabase();
    const scene = createEmptyScene('Level 2');
    expect(scene.findByName('Main Camera')).not.toBeNull();
    const record = addSceneAsset(assets, scene, 'Levels');
    expect(record.name).toBe('Levels/Level 2.scene');
    expect(JSON.parse(assets.getText(record.id))).toEqual(serializeScene(scene));
  });

  it('names the class of a new script after its file', () => {
    expect(toClassName('enemy-ai.ts')).toBe('EnemyAi');
    expect(toClassName('Scripts/player controller.ts')).toBe('PlayerController');
    expect(toClassName('2fast.ts')).toBe('Script2fast');
    expect(toClassName('---.ts')).toBe('NewScript');
    expect(createScriptSource('Spinner.ts')).toContain(
      'export default class Spinner extends Behaviour',
    );
  });
});

describe('importAsset', () => {
  const png = encodePng(6, 3, new Uint8Array(6 * 3 * 4));
  const text = (value: string): Uint8Array => new TextEncoder().encode(value);

  it('imports an image into a folder and records its size', async () => {
    const assets = new AssetDatabase();
    const record = await importAsset(
      assets,
      { name: 'hero.png', bytes: png },
      'Art',
      decodeImageHeadless,
    );
    expect(record).toMatchObject({
      name: 'Art/hero.png',
      type: 'texture',
      mimeType: 'image/png',
      meta: { width: 6, height: 3 },
    });
    expect(assets.getBytes(record.id)).toBe(png);
  });

  it('imports audio, scripts, scenes and prefabs', async () => {
    const assets = new AssetDatabase();
    const scene = JSON.stringify(serializeScene(new Scene('Imported')));
    const prefab = JSON.stringify({
      format: 'rowan.prefab',
      version: 1,
      name: 'P',
      entities: [{ uuid: 'a', parent: null, components: {} }],
    });
    const files = [
      { name: 'beep.wav', bytes: new Uint8Array([1, 2]) },
      { name: 'Player.ts', bytes: text('export default 1;') },
      { name: 'Level.scene', bytes: text(scene) },
      { name: 'Crate.prefab', bytes: text(prefab) },
    ];
    const types: string[] = [];
    for (const file of files) {
      types.push((await importAsset(assets, file, '', decodeImageHeadless)).type);
    }
    expect(types).toEqual(['audio', 'script', 'scene', 'prefab']);
    expect(assets.getText(assets.findByName('Player.ts')!.id)).toBe('export default 1;');
    expect(assets.findByName('Level.scene')?.name).toBe('Level.scene');
  });

  it.each([
    [{ name: 'notes.txt', bytes: new Uint8Array() }, '"notes.txt" is not a supported file type'],
    [{ name: 'Level.scene', bytes: text('{nope') }, '"Level.scene" is not a valid scene'],
    [{ name: 'Level.scene', bytes: text('{"format":"x"}') }, 'is not a valid scene'],
    [{ name: 'Crate.prefab', bytes: text('{"format":"rowan.scene"}') }, 'is not a valid prefab'],
    [{ name: 'Bad.ts', bytes: new Uint8Array([0xff, 0xfe, 0xfd]) }, 'is not a UTF-8 text file'],
  ])('rejects %#', async (file, message) => {
    const assets = new AssetDatabase();
    await expect(importAsset(assets, file, '', decodeImageHeadless)).rejects.toThrow(message);
    expect(assets.size).toBe(0);
  });

  it('rejects an image that cannot be decoded', async () => {
    const assets = new AssetDatabase();
    const decode = (): Promise<never> => Promise.reject(new Error('corrupt data'));
    await expect(
      importAsset(assets, { name: 'bad.png', bytes: new Uint8Array(4) }, '', decode),
    ).rejects.toThrow('Could not read the image "bad.png": corrupt data');
    expect(assets.size).toBe(0);
  });
});
