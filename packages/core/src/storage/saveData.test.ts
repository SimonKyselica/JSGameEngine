// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { RowanError } from '../core/assert';
import { Logger } from '../core/logger';
import { Vec2 } from '../math/vec2';
import { Scene } from '../scene/scene';
import {
  addScene,
  addScript,
  attachScript,
  createTestProject,
  startTestGame,
} from '../testing/fixtures';
import { createHeadlessGame } from '../runtime/headless';
import { SourceScriptProvider } from '../compiler';
import {
  getSaveKey,
  LocalStorageBackend,
  MemoryStorageBackend,
  SaveData,
  StorageApi,
  type StorageBackend,
} from './saveData';

function createSaveData(backend: StorageBackend = new MemoryStorageBackend()): {
  data: SaveData;
  storage: StorageApi;
  messages: string[];
} {
  const messages: string[] = [];
  const logger = new Logger();
  logger.addSink((entry) => messages.push(`${entry.level}: ${entry.message}`));
  const data = new SaveData(backend, logger);
  return { data, storage: new StorageApi(data), messages };
}

describe('StorageApi', () => {
  it('remembers values by name and gives the fallback for names it does not know', () => {
    const { storage } = createSaveData();
    expect(storage.get('highScore')).toBeUndefined();
    expect(storage.get('highScore', 0)).toBe(0);
    expect(storage.has('highScore')).toBe(false);

    storage.set('highScore', 1200);
    storage.set('name', 'Ada');
    storage.set('muted', false);
    storage.set('last', null);
    expect(storage.get('highScore', 0)).toBe(1200);
    expect(storage.get('name')).toBe('Ada');
    // A saved false or null is a value, not a missing one.
    expect(storage.get('muted', true)).toBe(false);
    expect(storage.get('last', 'fallback')).toBeNull();
    expect(storage.has('muted')).toBe(true);
    expect(storage.keys()).toEqual(['highScore', 'name', 'muted', 'last']);
  });

  it('forgets one value or all of them', () => {
    const { storage } = createSaveData();
    storage.set('a', 1);
    storage.set('b', 2);
    expect(storage.remove('a')).toBe(true);
    expect(storage.remove('a')).toBe(false);
    expect(storage.keys()).toEqual(['b']);
    storage.clear();
    expect(storage.keys()).toEqual([]);
  });

  it('keeps arrays and objects as copies, in both directions', () => {
    const { storage } = createSaveData();
    const unlocked = ['forest', 'cave'];
    storage.set('unlocked', unlocked);
    unlocked.push('castle');
    expect(storage.get('unlocked')).toEqual(['forest', 'cave']);

    const read = storage.get('unlocked', [] as string[]);
    read.push('tower');
    expect(storage.get('unlocked')).toEqual(['forest', 'cave']);

    storage.set('settings', { volume: 0.5, keys: { jump: 'Space' } });
    expect(storage.get('settings')).toEqual({ volume: 0.5, keys: { jump: 'Space' } });
  });

  it('refuses values that would not come back as they went in, and says what to do', () => {
    const { storage } = createSaveData();
    const set =
      (value: unknown): (() => void) =>
      () =>
        storage.set('key', value as never);
    expect(set(Number.NaN)).toThrow('The value for "key" is NaN, which cannot be saved');
    expect(set(Infinity)).toThrow(RowanError);
    expect(set(undefined)).toThrow('is undefined, which cannot be saved');
    expect(set(() => 1)).toThrow('is a function, which cannot be saved');
    expect(set(new Vec2(1, 2))).toThrow('for example position.toArray() for a Vec2');
    expect(set({ scores: [1, { best: Number.NaN }] })).toThrow(
      'The value for "key".scores[1].best is NaN',
    );
    expect(set(new Map())).toThrow('is an object of a class');
    expect(storage.has('key')).toBe(false);
  });

  it('needs a name for every value', () => {
    const { storage } = createSaveData();
    expect(() => storage.set('', 1)).toThrow('A saved value needs a name');
    expect(() => storage.set(5 as never, 1)).toThrow(RowanError);
  });
});

describe('SaveData', () => {
  it('writes only when something has changed', () => {
    const backend = new MemoryStorageBackend();
    const { data, storage } = createSaveData(backend);
    data.flush();
    expect(backend.writes).toBe(0);

    storage.set('coins', 3);
    storage.set('coins', 4);
    data.flush();
    data.flush();
    expect(backend.writes).toBe(1);
    expect(JSON.parse(backend.text!)).toEqual({ coins: 4 });

    // Removing what is not there and clearing what is empty change nothing.
    storage.remove('gems');
    data.flush();
    expect(backend.writes).toBe(1);
    storage.clear();
    data.flush();
    expect(backend.writes).toBe(2);
    expect(backend.text).toBe('{}');
    storage.clear();
    data.flush();
    expect(backend.writes).toBe(2);
  });

  it('starts from what was stored the last time', () => {
    const backend = new MemoryStorageBackend();
    const first = createSaveData(backend);
    first.storage.set('level', 3);
    first.storage.set('unlocked', ['forest']);
    first.data.flush();

    const second = createSaveData(backend);
    expect(second.storage.get('level')).toBe(3);
    expect(second.storage.get('unlocked')).toEqual(['forest']);
    expect(second.messages).toEqual([]);
  });

  it('starts empty and says so when what is stored is damaged', () => {
    for (const text of ['{not json', '[1, 2]', '"text"', '{"a": {"b": null}, "c": 1e999}']) {
      const backend = new MemoryStorageBackend();
      backend.text = text;
      const { storage, messages } = createSaveData(backend);
      expect(storage.keys(), text).toEqual([]);
      expect(messages).toHaveLength(1);
      expect(messages[0]).toMatch(/^warn: The stored save data is damaged/);
    }
  });

  it('keeps the game going when the data cannot be read or stored', () => {
    const blocked: StorageBackend = {
      read() {
        throw new Error('storage is blocked');
      },
      write() {
        throw new Error('the quota is used up');
      },
      clear() {
        throw new Error('storage is blocked');
      },
    };
    const { data, storage, messages } = createSaveData(blocked);
    expect(messages).toEqual([
      'warn: Save data could not be read, so the game starts without it: storage is blocked',
    ]);

    storage.set('coins', 1);
    data.flush();
    storage.set('coins', 2);
    data.flush();
    // Reported once, not in every frame, and the value is still there while the game runs.
    expect(messages.slice(1)).toEqual([
      'warn: Save data could not be stored and will be lost when the game is closed: the quota is used up',
    ]);
    expect(storage.get('coins')).toBe(2);
  });
});

describe('LocalStorageBackend', () => {
  beforeEach(() => window.localStorage.clear());

  it('keeps the data of each project under a name of its own', () => {
    const mine = new LocalStorageBackend(getSaveKey('project-a'));
    const other = new LocalStorageBackend(getSaveKey('project-b'));
    expect(mine.read()).toBeNull();
    mine.write('{"coins":1}');
    other.write('{"coins":9}');
    expect(mine.read()).toBe('{"coins":1}');
    expect(window.localStorage.getItem('rowan.save.project-a')).toBe('{"coins":1}');

    mine.clear();
    expect(mine.read()).toBeNull();
    expect(other.read()).toBe('{"coins":9}');
  });

  it('does not touch the storage until it is used', () => {
    let asked = 0;
    const backend = new LocalStorageBackend('key', () => {
      asked++;
      throw new Error('blocked by the browser');
    });
    expect(asked).toBe(0);
    expect(() => backend.read()).toThrow('blocked by the browser');
  });
});

describe('save data in a game', () => {
  /** Adds one to a counter every frame, and remembers the scene it ran in. */
  const COUNTER = `
    import { Behaviour } from 'rowan';
    export default class Counter extends Behaviour {
      onUpdate() {
        this.storage.set('frames', this.storage.get('frames', 0) + 1);
        this.storage.set('scene', this.scene.name);
        if (this.input.wasKeyPressed('KeyN')) this.scene.load('Next');
      }
      onDestroy() { this.storage.set('goodbye from', this.scene.name); }
    }`;

  function createCounterProject(): ReturnType<typeof createTestProject> {
    return createTestProject((scene, project) => {
      const script = addScript(project.assets, 'Counter.ts', COUNTER);
      attachScript(scene.createEntity('Counter'), script);
      const next = new Scene('Next');
      attachScript(next.createEntity('Counter'), script);
      addScene(project, next);
    });
  }

  it('is written at the end of every frame in which it changed', async () => {
    const game = await startTestGame(createCounterProject());
    const backend = game.storage as MemoryStorageBackend;
    expect(backend.text).toBeNull();
    game.step(3);
    expect(JSON.parse(backend.text!)).toEqual({ frames: 3, scene: 'Main' });
    expect(backend.writes).toBe(3);
  });

  it('outlives the scene, and takes in what scripts save while it is unloaded', async () => {
    const game = await startTestGame(createCounterProject());
    game.step(2);
    game.game.input.handleKeyDown('KeyN');
    game.step(1);
    expect(game.game.scene.name).toBe('Next');
    game.step(1);
    expect(JSON.parse((game.storage as MemoryStorageBackend).text!)).toEqual({
      frames: 4,
      scene: 'Next',
      'goodbye from': 'Main',
    });
  });

  it('is written once more when the game stops, for what scripts save on their way out', async () => {
    const game = await startTestGame(createCounterProject());
    game.step(1);
    game.game.stop();
    expect(JSON.parse((game.storage as MemoryStorageBackend).text!)).toMatchObject({
      'goodbye from': 'Main',
    });
  });

  it('is there again the next time the game is opened', async () => {
    const backend = new MemoryStorageBackend();
    for (const expected of [2, 4]) {
      const project = createCounterProject();
      const headless = createHeadlessGame(
        project,
        new SourceScriptProvider(project.assets),
        backend,
      );
      await headless.game.start();
      headless.game.update(1 / 60);
      headless.game.update(1 / 60);
      expect(JSON.parse(backend.text!)).toMatchObject({ frames: expected });
      headless.game.dispose();
    }
  });

  it('reports a value that cannot be saved as an error of the script, and carries on', async () => {
    const project = createTestProject((scene, { assets }) => {
      const script = `
        import { Behaviour } from 'rowan';
        export default class Saver extends Behaviour {
          onStart() { this.storage.set('position', this.transform.position); }
          onUpdate() { this.storage.set('alive', true); }
        }`;
      attachScript(scene.createEntity('Saver'), addScript(assets, 'Saver.ts', script));
    });
    const game = await startTestGame(project);
    game.step(1);
    expect(game.messages()).toEqual([
      expect.stringMatching(
        /^error: onStart failed on "Saver": The value for "position" is an object of a class/,
      ),
    ]);
    expect(JSON.parse((game.storage as MemoryStorageBackend).text!)).toEqual({ alive: true });
  });
});
