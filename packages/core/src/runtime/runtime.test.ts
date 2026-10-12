import { describe, expect, it, vi } from 'vitest';
import { encodePng } from '../assets/png';
import { createDefaultSettings, Project } from '../assets/project';
import { SourceScriptProvider } from '../compiler';
import { Color } from '../math/color';
import { Camera, SpriteRenderer } from '../scene/components';
import { Scene } from '../scene/scene';
import { serializeScene } from '../scene/serializer';
import {
  addScene,
  addScript,
  attachScript,
  createTestProject,
  FRAME,
  startTestGame,
} from '../testing/fixtures';
import { ENGINE_VERSION } from '../version';
import { createGameBundle, GAME_BUNDLE_FORMAT, loadGameBundle } from './bundle';
import { GameLoop, type FrameScheduler } from './gameLoop';
import { createHeadlessGame } from './headless';
import { computeFitRect } from './viewport';

/** Logs how many fixed and regular updates happened. */
const COUNTER = `
  import { Behaviour } from 'rowan';
  export default class Counter extends Behaviour {
    fixed = 0; updates = 0;
    onFixedUpdate() { this.fixed++; }
    onUpdate() { this.updates++; }
  }`;

function counterOf(game: Awaited<ReturnType<typeof startTestGame>>): {
  fixed: number;
  updates: number;
} {
  const { scene, sceneRuntime } = game.game;
  return sceneRuntime.scripts.getScript(scene.findByName('Counter')!, 'Counter') as never;
}

function createCounterProject(): Project {
  return createTestProject((scene, { assets }) => {
    attachScript(scene.createEntity('Counter'), addScript(assets, 'Counter.ts', COUNTER));
  });
}

describe('Game startup', () => {
  it('starts in the project start scene', async () => {
    const project = createTestProject((scene) => void scene.createEntity('InMain'));
    addScene(project, new Scene('Aaa'));
    const game = await startTestGame(project);
    expect(game.game.isRunning).toBe(true);
    expect(game.game.scene.name).toBe('Main');
    expect(game.game.scene.findByName('InMain')).not.toBeNull();
  });

  it('falls back to the first scene when the start scene is unset or stale', async () => {
    const project = createTestProject();
    addScene(project, new Scene('Aaa'));
    project.settings.startScene = 'no-longer-exists';
    expect((await startTestGame(project)).game.scene.name).toBe('Aaa');
  });

  it('starts in a named scene or in scene data handed to it', async () => {
    const project = createTestProject();
    addScene(project, new Scene('Level2'));
    const provider = new SourceScriptProvider(project.assets);

    const byName = createHeadlessGame(project, provider).game;
    await byName.start({ scene: 'Level2' });
    expect(byName.scene.name).toBe('Level2');

    const unsaved = new Scene('Unsaved');
    unsaved.createEntity('Draft');
    const byData = createHeadlessGame(project, provider).game;
    await byData.start({ sceneData: serializeScene(unsaved) });
    expect(byData.scene.findByName('Draft')).not.toBeNull();
  });

  it('fails clearly when there is nothing to run', async () => {
    const empty = new Project(createDefaultSettings());
    const provider = new SourceScriptProvider(empty.assets);
    await expect(createHeadlessGame(empty, provider).game.start()).rejects.toThrow(
      'The project has no scenes to run',
    );

    const project = createTestProject();
    project.assets.create({ name: 'Bad.scene', type: 'scene', mimeType: 'x', data: '{not json' });
    const game = createHeadlessGame(project, new SourceScriptProvider(project.assets)).game;
    await expect(game.start({ scene: 'Nope' })).rejects.toThrow('Scene "Nope" does not exist');
    await expect(game.start({ scene: 'Bad' })).rejects.toThrow('"Bad.scene" is not valid JSON');
    await expect(game.start({ sceneData: { format: 'x' } })).rejects.toThrow('expected format');
  });

  it('refuses to start twice or to update before starting', async () => {
    const project = createTestProject();
    const { game } = createHeadlessGame(project, new SourceScriptProvider(project.assets));
    expect(() => game.update(FRAME)).toThrow('The game is not running');
    expect(() => game.scene).toThrow('The game is not running');
    await game.start();
    await expect(game.start()).rejects.toThrow('already been started');
  });

  it('preloads textures and reports scene warnings', async () => {
    const project = createTestProject((scene, { assets }) => {
      assets.create({
        name: 'a.png',
        type: 'texture',
        mimeType: 'image/png',
        data: encodePng(2, 2, new Uint8Array(16)),
      });
      scene.createEntity('E');
    });
    const sceneId = project.settings.startScene!;
    const data = JSON.parse(project.assets.getText(sceneId)) as {
      entities: { components: Record<string, unknown> }[];
    };
    data.entities[0]!.components.Mystery = {};
    project.assets.setData(sceneId, JSON.stringify(data));

    const game = await startTestGame(project);
    expect(game.renderer.textureCount).toBe(1);
    expect(game.messages()).toEqual([
      'warn: While loading scene "Main.scene": entities[0]: skipped unknown component "Mystery"',
    ]);
  });

  it('uses the pixel-art setting to choose texture filtering', async () => {
    const project = createTestProject((_scene, { assets }) => {
      assets.create({
        name: 'a.png',
        type: 'texture',
        mimeType: 'image/png',
        data: encodePng(1, 1, new Uint8Array(4)),
      });
    });
    project.settings.rendering.pixelArt = true;
    const headless = createHeadlessGame(project, new SourceScriptProvider(project.assets));
    const createTexture = vi.spyOn(headless.renderer, 'createTexture');
    await headless.game.start();
    expect(createTexture).toHaveBeenCalledExactlyOnceWith(expect.anything(), 'nearest');
  });
});

describe('Game loop timing', () => {
  it('runs one fixed step per frame when the frame matches the fixed step', async () => {
    const game = await startTestGame(createCounterProject());
    game.step(120);
    expect(counterOf(game)).toMatchObject({ fixed: 120, updates: 120 });
  });

  it('runs several fixed steps to catch up after a long frame', async () => {
    const game = await startTestGame(createCounterProject());
    game.game.update(FRAME * 3);
    expect(counterOf(game)).toMatchObject({ fixed: 3, updates: 1 });
  });

  it('carries leftover time over to the next frame', async () => {
    const game = await startTestGame(createCounterProject());
    game.game.update(FRAME * 0.6);
    expect(counterOf(game).fixed).toBe(0);
    game.game.update(FRAME * 0.6);
    expect(counterOf(game).fixed).toBe(1);
  });

  it('caps a huge frame and drops the backlog', async () => {
    const game = await startTestGame(createCounterProject());
    game.game.update(30);
    expect(game.game.time.unscaledDeltaTime).toBe(0.25);
    expect(counterOf(game).fixed).toBe(8);
    game.game.update(FRAME);
    expect(counterOf(game).fixed).toBe(9);
  });

  it('ignores negative frame times', async () => {
    const game = await startTestGame(createCounterProject());
    game.game.update(-1);
    expect(game.game.time.deltaTime).toBe(0);
    expect(counterOf(game)).toMatchObject({ fixed: 0, updates: 1 });
  });

  it('scales game time but not unscaled time', async () => {
    const game = await startTestGame(createCounterProject());
    const { time } = game.game;
    time.timeScale = 0.5;
    game.step(4);
    expect(counterOf(game)).toMatchObject({ fixed: 2, updates: 4 });
    expect(time.deltaTime).toBeCloseTo(FRAME / 2);
    expect(time.unscaledDeltaTime).toBeCloseTo(FRAME);
    expect(time.elapsed).toBeCloseTo(FRAME * 2);
    expect(time.frameCount).toBe(4);

    time.timeScale = 0;
    game.step(4);
    expect(counterOf(game)).toMatchObject({ fixed: 2, updates: 8 });
    expect(time.deltaTime).toBe(0);
  });

  it('takes the fixed step from the project settings', async () => {
    const project = createCounterProject();
    project.settings.physics.fixedTimeStep = 1 / 30;
    const game = await startTestGame(project);
    expect(game.game.time.fixedDeltaTime).toBe(1 / 30);
    game.step(60);
    expect(counterOf(game).fixed).toBe(30);
  });

  it('clears per-frame input after each update', async () => {
    const project = createTestProject((scene, { assets }) => {
      const script = addScript(
        assets,
        'Presses.ts',
        `import { Behaviour } from 'rowan';
         export default class Presses extends Behaviour {
           onUpdate() { if (this.input.wasKeyPressed('KeyE')) this.log('pressed'); }
         }`,
      );
      attachScript(scene.createEntity('E'), script);
    });
    const game = await startTestGame(project);
    game.game.input.handleKeyDown('KeyE');
    game.step(3);
    expect(game.messages()).toEqual(['pressed']);
  });
});

describe('Game scenes and rendering', () => {
  it('switches scenes at the end of the frame and restarts the clock', async () => {
    const project = createTestProject((scene, { assets }) => {
      const script = addScript(
        assets,
        'Portal.ts',
        `import { Behaviour } from 'rowan';
         export default class Portal extends Behaviour {
           onUpdate() {
             if (this.time.frameCount === 2) { this.scene.load('Level2'); this.log('requested'); }
             this.log('frame in', this.scene.name);
           }
           onDestroy() { this.log('left', this.scene.name); }
         }`,
      );
      attachScript(scene.createEntity('Portal'), script);
    });
    addScene(project, new Scene('Level2'));
    const game = await startTestGame(project);
    const loaded = vi.fn();
    game.game.onSceneLoaded.connect(loaded);

    game.step(2);
    expect(game.messages()).toEqual(['frame in Main', 'requested', 'frame in Main', 'left Main']);
    expect(game.game.scene.name).toBe('Level2');
    expect(game.game.time.frameCount).toBe(0);
    expect(game.game.time.elapsed).toBe(0);
    expect(loaded).toHaveBeenCalledExactlyOnceWith(game.game.scene);
  });

  it('keeps running the current scene when the requested one cannot load', async () => {
    const game = await startTestGame(createCounterProject());
    game.game.requestSceneLoad('Nowhere');
    game.step();
    expect(game.messages()).toEqual(['error: Scene "Nowhere" does not exist']);
    expect(game.game.scene.name).toBe('Main');
    game.step();
    expect(counterOf(game).updates).toBe(2);
  });

  it('draws the scene through its camera', async () => {
    const project = createTestProject((scene) => {
      scene.createEntity('Camera').addComponent(Camera, {
        orthographicSize: 4,
        backgroundColor: new Color(0, 1, 0),
      });
      scene.createEntity('Sprite').addComponent(SpriteRenderer);
    });
    project.settings.rendering.width = 400;
    project.settings.rendering.height = 200;
    const game = await startTestGame(project);

    game.game.render();
    expect(game.renderer.quads).toHaveLength(1);
    expect(game.renderer.clearColor.toHex()).toBe('#00ff00');
    expect(game.game.renderTarget).toBe(game.renderer);
    const view = game.game.getCameraView();
    expect(view?.halfHeight).toBe(4);
    expect(view?.aspect).toBe(2);
  });

  it('has no camera view without a camera or when stopped', async () => {
    const game = await startTestGame(createTestProject());
    expect(game.game.getCameraView()).toBeNull();
    game.game.render();
    expect(game.renderer.quads).toHaveLength(0);
    game.game.stop();
    expect(game.game.getCameraView()).toBeNull();
  });

  it('maps the pointer into world space through the camera', async () => {
    const project = createTestProject((scene, { assets }) => {
      scene.createEntity('Camera').addComponent(Camera, { orthographicSize: 5 });
      const script = addScript(
        assets,
        'Pointer.ts',
        `import { Behaviour, MouseButton } from 'rowan';
         export default class Pointer extends Behaviour {
           onUpdate() {
             if (this.input.wasMouseButtonPressed(MouseButton.Left)) {
               const world = this.input.mouseWorldPosition;
               this.log(this.input.mousePosition.x, world.x.toFixed(2), world.y.toFixed(2),
                 this.input.isMouseButtonDown(MouseButton.Left), this.input.scrollDelta);
             }
             if (this.input.wasMouseButtonReleased(MouseButton.Left)) this.log('released');
             if (this.input.wasKeyReleased('KeyQ')) this.log('q up', this.input.isKeyDown('KeyQ'));
           }
         }`,
      );
      attachScript(scene.createEntity('E'), script);
    });
    const game = await startTestGame(project);
    const { input } = game.game;
    // The game is 1280x720, so the camera sees 17.78 x 10 world units.
    input.handlePointerMove(1280, 0, 1280, 720);
    input.handlePointerDown(0);
    input.handleWheel(3);
    input.handleKeyDown('KeyQ');
    game.step();
    input.handlePointerUp(0);
    input.handleKeyUp('KeyQ');
    game.step();
    expect(game.messages()).toEqual(['1280 8.89 5.00 true 3', 'released', 'q up false']);
  });

  it('stops cleanly, can restart, and frees textures on dispose', async () => {
    const project = createTestProject((scene, { assets }) => {
      assets.create({
        name: 'a.png',
        type: 'texture',
        mimeType: 'image/png',
        data: encodePng(1, 1, new Uint8Array(4)),
      });
      attachScript(scene.createEntity('Counter'), addScript(assets, 'Counter.ts', COUNTER));
    });
    const game = await startTestGame(project);
    game.game.input.handleKeyDown('KeyA');
    game.step(5);

    game.game.stop();
    expect(game.game.isRunning).toBe(false);
    expect(game.game.input.keysDown.size).toBe(0);
    expect(() => game.game.stop()).not.toThrow();

    await game.game.start();
    game.step();
    expect(counterOf(game).updates).toBe(1);

    game.game.dispose();
    expect(game.renderer.textureCount).toBe(0);
  });
});

describe('GameLoop', () => {
  function createScheduler(): FrameScheduler & { fire(timeMs: number): void; pending: number } {
    let nextHandle = 1;
    const callbacks = new Map<number, (timeMs: number) => void>();
    return {
      get pending() {
        return callbacks.size;
      },
      requestFrame(callback) {
        callbacks.set(nextHandle, callback);
        return nextHandle++;
      },
      cancelFrame(handle) {
        callbacks.delete(handle);
      },
      fire(timeMs) {
        const due = [...callbacks.values()];
        callbacks.clear();
        for (const callback of due) {
          callback(timeMs);
        }
      },
    };
  }

  it('reports the time between frames, starting from zero', () => {
    const scheduler = createScheduler();
    const deltas: number[] = [];
    const loop = new GameLoop((delta) => deltas.push(delta), scheduler);
    loop.start();
    expect(loop.isRunning).toBe(true);
    scheduler.fire(1000);
    scheduler.fire(1016);
    scheduler.fire(1049);
    expect(deltas).toEqual([0, 0.016, 0.033]);
  });

  it('does not report the time spent stopped', () => {
    const scheduler = createScheduler();
    const deltas: number[] = [];
    const loop = new GameLoop((delta) => deltas.push(delta), scheduler);
    loop.start();
    scheduler.fire(0);
    loop.stop();
    expect(loop.isRunning).toBe(false);
    expect(scheduler.pending).toBe(0);
    loop.start();
    scheduler.fire(60_000);
    expect(deltas).toEqual([0, 0]);
  });

  it('never reports negative time and ignores a second start', () => {
    const scheduler = createScheduler();
    const deltas: number[] = [];
    const loop = new GameLoop((delta) => deltas.push(delta), scheduler);
    loop.start();
    loop.start();
    expect(scheduler.pending).toBe(1);
    scheduler.fire(100);
    scheduler.fire(50);
    expect(deltas).toEqual([0, 0]);
  });

  it('can be stopped from inside the frame callback', () => {
    const scheduler = createScheduler();
    let frames = 0;
    const loop: GameLoop = new GameLoop(() => {
      frames++;
      loop.stop();
    }, scheduler);
    loop.start();
    scheduler.fire(0);
    scheduler.fire(16);
    expect(frames).toBe(1);
    expect(scheduler.pending).toBe(0);
  });
});

describe('computeFitRect', () => {
  it('letterboxes a container that is too wide', () => {
    expect(computeFitRect(400, 100, 2)).toEqual({ x: 100, y: 0, width: 200, height: 100 });
  });

  it('letterboxes a container that is too tall', () => {
    expect(computeFitRect(200, 400, 2)).toEqual({ x: 0, y: 150, width: 200, height: 100 });
  });

  it('fills a container with the same aspect ratio', () => {
    expect(computeFitRect(320, 180, 16 / 9)).toEqual({ x: 0, y: 0, width: 320, height: 180 });
  });

  it('returns an empty rectangle for degenerate input', () => {
    const empty = { x: 0, y: 0, width: 0, height: 0 };
    expect(computeFitRect(0, 100, 1)).toEqual(empty);
    expect(computeFitRect(100, 100, 0)).toEqual(empty);
    expect(computeFitRect(100, 100, Number.NaN)).toEqual(empty);
  });
});

describe('game bundles', () => {
  function createBundleProject(): Project {
    return createTestProject((scene, { assets }) => {
      scene.createEntity('E');
      addScript(assets, 'Scripts/Main.ts', COUNTER);
      assets.create({
        name: 'Art/hero.png',
        type: 'texture',
        mimeType: 'image/png',
        data: encodePng(2, 2, new Uint8Array(16)),
        meta: { width: 2, height: 2 },
      });
    });
  }

  it('stores binary assets as separate files and leaves script sources out', () => {
    const project = createBundleProject();
    const { bundle, files } = createGameBundle(project, { inlineBinaryAssets: false });
    const hero = project.assets.findByName('hero.png')!;

    expect(bundle).toMatchObject({
      format: GAME_BUNDLE_FORMAT,
      version: 1,
      engineVersion: ENGINE_VERSION,
      projectId: project.id,
      settings: project.settings,
    });
    expect([...files.keys()]).toEqual([`assets/${hero.id}.png`]);
    const byName = Object.fromEntries(bundle.assets.map((asset) => [asset.name, asset]));
    expect(byName['Art/hero.png']).toMatchObject({ file: `assets/${hero.id}.png` });
    expect(byName['Scripts/Main.ts']!.text).toBe('');
    expect(byName['Main.scene']!.text).toContain('rowan.scene');
    expect(JSON.stringify(bundle)).not.toContain('onFixedUpdate');
  });

  it('round-trips through separate files', async () => {
    const project = createBundleProject();
    const { bundle, files } = createGameBundle(project, { inlineBinaryAssets: false });
    const readFile = vi.fn((path: string) => Promise.resolve(files.get(path)!));
    const loaded = await loadGameBundle(JSON.parse(JSON.stringify(bundle)), readFile);

    expect(readFile).toHaveBeenCalledOnce();
    expect(loaded.id).toBe(project.id);
    expect(loaded.settings).toEqual(project.settings);
    expect(loaded.assets.list().map((record) => record.name)).toEqual(
      project.assets.list().map((record) => record.name),
    );
    const hero = loaded.assets.findByName('hero.png')!;
    expect(loaded.assets.getBytes(hero.id)).toEqual(project.assets.getBytes(hero.id));
    expect(hero.meta).toEqual({ width: 2, height: 2 });
  });

  it('round-trips with everything embedded', async () => {
    const project = createBundleProject();
    const { bundle, files } = createGameBundle(project, { inlineBinaryAssets: true });
    expect(files.size).toBe(0);
    const readFile = vi.fn();
    const loaded = await loadGameBundle(JSON.parse(JSON.stringify(bundle)), readFile);
    expect(readFile).not.toHaveBeenCalled();
    const hero = loaded.assets.findByName('hero.png')!;
    expect(loaded.assets.getBytes(hero.id)).toEqual(project.assets.getBytes(hero.id));
  });

  it.each([
    [null, 'game bundle: expected an object'],
    [{ format: 'zip' }, 'expected format "rowan.game"'],
    [{ format: GAME_BUNDLE_FORMAT, version: 99 }, 'version 99 is not supported'],
    [{ format: GAME_BUNDLE_FORMAT }, 'version undefined is not supported'],
    [{ format: GAME_BUNDLE_FORMAT, version: 1 }, 'expected an array of assets'],
    [
      {
        format: GAME_BUNDLE_FORMAT,
        version: 1,
        assets: [{ id: 'a', name: 'a.png', type: 'texture' }],
      },
      'asset "a.png" has no content',
    ],
  ])('rejects the malformed bundle %#', async (data, message) => {
    await expect(loadGameBundle(data, vi.fn())).rejects.toThrow(message);
  });
});
