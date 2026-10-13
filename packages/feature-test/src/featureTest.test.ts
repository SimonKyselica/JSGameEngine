import { beforeAll, describe, expect, it } from 'vitest';
import {
  AssetsApi,
  AudioApi,
  Behaviour,
  COMPONENT_TYPES,
  createHeadlessGame,
  Color,
  Entity,
  Input,
  MathUtils,
  MouseButton,
  Physics2D,
  Scene,
  SceneApi,
  ScriptApi,
  StorageApi,
  SCRIPT_PROPERTY_TYPES,
  Time,
  Vec2,
  type Collision,
  type HeadlessGame,
  type RaycastHit,
  type RasterizedText,
  type RecordedQuad,
  type SceneData,
  type ScriptLifecycle,
  type ScriptPropertyDefinition,
  type SpawnOptions,
} from '@rowan/core';
import { SourceScriptProvider } from '@rowan/core/compiler';
import {
  clearFeatureTestReport,
  createFeatureTestProject,
  driveFeatureTestInput,
  FEATURE_TEST_SCRIPTS,
  getFeatureTestReport,
  type FeatureTestReport,
} from './index';

const FRAME = 1 / 60;
/** RenderProbe and TextProbe change what is drawn in this frame. */
const RENDER_CHANGE_FRAME = 20;
const MAX_FRAMES = 60 * 20;

/** What one frame drew. */
interface Snapshot {
  quads: RecordedQuad[];
  /** Every text rasterized up to and including this frame. */
  texts: RasterizedText[];
  clearColor: string;
  halfHeight: number;
}

interface Run {
  headless: HeadlessGame;
  report: FeatureTestReport;
  /** The frames just before and just after the probes change what is drawn. */
  before: Snapshot;
  after: Snapshot;
  frames: number;
}

/** The quad whose center is at a world position, if one was drawn there. */
function quadAt(quads: readonly RecordedQuad[], x: number, y: number): RecordedQuad | undefined {
  return quads.find((quad) => {
    const center = quad.transform.getTranslation();
    return Math.abs(center.x - x) < 1e-6 && Math.abs(center.y - y) < 1e-6;
  });
}

/** Rounds away floating-point noise so sizes can be compared exactly. */
const rounded = (values: readonly number[]): number[] =>
  values.map((value) => Math.round(value * 1e6) / 1e6);

async function runFeatureTest(): Promise<Run> {
  clearFeatureTestReport();
  const project = createFeatureTestProject();
  const headless = createHeadlessGame(project, new SourceScriptProvider(project.assets));
  const { game, renderer } = headless;
  await game.start();

  const snapshot = (): Snapshot => {
    game.render();
    return {
      quads: [...renderer.quads],
      texts: [...headless.text.rasterized],
      clearColor: renderer.clearColor.toHex(),
      halfHeight: game.getCameraView()?.halfHeight ?? 0,
    };
  };

  let before: Snapshot | undefined;
  let after: Snapshot | undefined;
  let frame = 0;
  while (!getFeatureTestReport()?.done && frame < MAX_FRAMES) {
    frame++;
    driveFeatureTestInput(game.input, frame);
    if (frame === RENDER_CHANGE_FRAME) {
      before = snapshot();
    }
    game.update(FRAME);
    if (frame === RENDER_CHANGE_FRAME) {
      after = snapshot();
    }
  }

  const report = getFeatureTestReport();
  if (!report || !before || !after) {
    throw new Error(`The feature test did not get going within ${frame} frames`);
  }
  return { headless, report, before, after, frames: frame };
}

describe('feature-test scene, run headless', () => {
  let run: Run;

  beforeAll(async () => {
    run = await runFeatureTest();
  });

  it('finishes both scenes well before the timeout', () => {
    expect(run.report.done).toBe(true);
    expect(run.report.pending).toEqual([]);
    expect(run.headless.game.scene.name).toBe('Finish');
    // The physics sequence takes about 2.2 seconds; the timeout is 15.
    expect(run.frames).toBeLessThan(60 * 4);
  });

  it('passes every check', () => {
    const failed = run.report.checks.filter((check) => !check.passed);
    expect(failed).toEqual([]);
    expect(run.report.checks.length).toBeGreaterThan(150);
  });

  it('sees the scripts of the first scene being told that it is unloaded', () => {
    expect(run.report.checks).toContainEqual({
      name: 'onDestroy runs when a scene is unloaded',
      passed: true,
      detail: '',
    });
  });

  it('ran the checks that only start when a finger touches the screen', () => {
    // TouchProbe announces these when the first finger arrives, so that a person at a
    // computer is not kept waiting for them. Here the fingers did arrive.
    const names = run.report.checks.map((check) => check.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'Input.touches reports a finger that touches the screen',
        'Input.touchCount counts the fingers that are down',
        'a second finger presses a button while the first is held',
        'TouchPoint.ended is true in the frame a finger is lifted',
      ]),
    );
  });

  it('gives every check a unique name', () => {
    const names = run.report.checks.map((check) => check.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('logs no errors and only the summary and expected messages', () => {
    const { logs } = run.headless;
    expect(logs.filter((entry) => entry.level === 'error')).toEqual([]);
    expect(logs.filter((entry) => entry.level === 'warn')).toEqual([]);
    expect(logs.at(-1)?.message).toMatch(/^Feature test finished: (\d+) of \1 checks passed$/);
  });

  it('draws the sprites the scene describes', () => {
    const { quads, clearColor, halfHeight } = run.before;
    expect(clearColor).toBe('#1a1f33');
    expect(halfHeight).toBe(6);

    // Backdrop first (lowest order); the hidden and the inactive sprite are not drawn.
    expect(quads[0]!.color.toHex()).toBe('#292e47');
    const textured = quads.filter((quad) => quad.texture !== null);
    const checker = textured.filter((quad) => quad.transform.getTranslation().y === 4.5);
    expect(checker.map((quad) => quad.transform.getTranslation().x)).toEqual([-7.5, -6, -9]);
    const flipped = checker[0]!;
    expect([flipped.flipX, flipped.flipY]).toEqual([true, true]);
    expect(checker[1]!.color.toHex()).toBe('#ff0000');
    // 32 pixels at 32 pixels per unit is exactly one unit.
    expect(checker[2]!.transform.getScale().toArray()).toEqual([1, 1]);
  });

  it('reflects sprite and camera changes made by scripts in the next frame', () => {
    const { quads, clearColor, halfHeight } = run.after;
    expect(clearColor).toBe('#331a1a');
    expect(halfHeight).toBe(7);

    const row = quads.filter((quad) => quad.transform.getTranslation().y === 4.5);
    const byX = new Map(row.map((quad) => [quad.transform.getTranslation().x, quad]));
    // The hidden sprite at x = -4.5 is now visible.
    expect([...byX.keys()].sort((a, b) => a - b)).toEqual([-9, -7.5, -6, -4.5]);
    expect(byX.get(-7.5)!.flipX).toBe(false);
    expect(byX.get(-6)!.color.toHex()).toBe('#00ff00');
    // Halving pixels per unit doubles the checker sprite, and it now sorts last in its row.
    expect(byX.get(-9)!.transform.getScale().toArray()).toEqual([2, 2]);
    expect(row.at(-1)).toBe(byX.get(-9));
    expect(byX.get(-9)!.texture).toBe(byX.get(-6)!.texture);
  });

  it('draws the texts the scene describes', () => {
    const { quads, texts } = run.before;
    // The camera shows 12 units on 720 pixels: 60 pixels per unit, so a font size of 0.4
    // is 24 pixels. The hidden and the empty text are not rasterized at all.
    expect(texts).toEqual([
      {
        text: 'Rowan\nFeature Test',
        style: { font: 'serif', bold: true, italic: true },
        pixelsPerEm: 24,
      },
      {
        text: 'Frame 0',
        style: { font: 'monospace', bold: false, italic: false },
        pixelsPerEm: 30,
      },
      // On the screen a font size is in pixels, and is rasterized at exactly that many.
      { text: 'HUD', style: { font: 'sans-serif', bold: false, italic: false }, pixelsPerEm: 28 },
      {
        text: 'Clicked',
        style: { font: 'sans-serif', bold: false, italic: false },
        pixelsPerEm: 32,
      },
      { text: 'Touch', style: { font: 'sans-serif', bold: false, italic: false }, pixelsPerEm: 28 },
    ]);

    // Aligned left and top, the title starts at (-9, 3) and extends right and down. The
    // headless rasterizer makes it 6 em wide and, with a line height of 1.5, 3 em high.
    const title = quadAt(quads, -7.8, 2.4)!;
    expect(title.texture).toEqual({ width: 156, height: 84 });
    expect(rounded(title.transform.getScale().toArray())).toEqual([2.6, 1.4]);
    expect(title.color.toHex()).toBe('#ffe666');
    // With a sorting order of 3 it is drawn after the other texts of the world. Only what
    // is on the screen comes later still.
    expect(quads.indexOf(title)).toBeGreaterThan(quads.indexOf(quadAt(quads, -3, 3)!));
    // The counter is centered on its entity, like a sprite: 4.2 em by 1.2 em at 30 pixels
    // per em, plus 8 pixels of padding on every side.
    expect(quadAt(quads, -3, 3)?.texture).toEqual({ width: 142, height: 52 });
  });

  it('reflects text changes made by scripts in the next frame', () => {
    const { quads, texts } = run.after;
    // The camera now shows 14 units, so the same font sizes cover fewer pixels.
    expect(texts.slice(run.before.texts.length)).toEqual([
      {
        text: 'Rowan\nFeature Test',
        style: { font: 'serif', bold: false, italic: true },
        pixelsPerEm: 42,
      },
      {
        text: 'Frame 20',
        style: { font: 'monospace', bold: false, italic: false },
        pixelsPerEm: 26,
      },
      {
        text: 'Now you see me',
        style: { font: 'sans-serif', bold: false, italic: false },
        pixelsPerEm: 26,
      },
    ]);
    // Twice the font size and centered: the title now hangs centered below (-9, 3).
    const title = quadAt(quads, -9, 1.8)!;
    expect(title.texture).toEqual({ width: 274, height: 148 });
    expect(quadAt(quads, -3, 3)).toBeDefined();
    // The text that was hidden is drawn where its entity is.
    expect(quadAt(quads, 2, 3)).toBeDefined();
  });

  it('draws one frame of a sprite sheet at a time', () => {
    const quadOf = (quads: readonly RecordedQuad[]): RecordedQuad => quadAt(quads, 10, 2.5)!;
    const { texture, region, transform } = quadOf(run.before.quads);
    // Four columns and two rows of 16x16 pixels, at 16 pixels per unit: one unit square.
    expect(texture).toEqual({ width: 64, height: 32 });
    expect(rounded(transform.getScale().toArray())).toEqual([1, 1]);
    // A quarter of the width and half of the height, less half a pixel all round.
    expect(rounded([region!.width, region!.height])).toEqual(
      rounded([0.25 - 1 / 64, 0.5 - 1 / 32]),
    );
    // By now the looping clip is over and the second one was stopped on its second frame,
    // which is the second frame of the second row.
    const frozen = quadOf(run.after.quads).region!;
    expect(rounded([frozen.x, frozen.y])).toEqual(rounded([0.25 + 0.5 / 64, 0.5 + 0.5 / 32]));
  });

  it('draws the tiles of a tilemap, each from its part of the tileset', () => {
    const { quads } = run.before;
    // Three cells of half a unit, starting at (3, -5.6).
    const tiles = [3.25, 3.75, 4.25].map((x) => quadAt(quads, x, -5.35)!);
    expect(tiles.map((quad) => rounded(quad.transform.getScale().toArray()))).toEqual([
      [0.5, 0.5],
      [0.5, 0.5],
      [0.5, 0.5],
    ]);
    // Tiles 0, 5 and 7 of a tileset of four columns and two rows.
    expect(
      tiles.map((quad) => rounded([quad.region!.x - 0.5 / 64, quad.region!.y - 0.5 / 32])),
    ).toEqual([
      [0, 0],
      [0.25, 0.5],
      [0.75, 0.5],
    ]);
    expect(tiles[0]!.color.a).toBe(0.9);
  });

  it('draws what is on the screen over the world, in pixels of the screen', () => {
    const { quads } = run.before;
    // The camera shows 12 units on a screen 720 pixels high: 60 pixels per unit. The
    // button is 240x120 pixels, centered 320 pixels right of and 180 below the top-left
    // corner, which is at (-10.667, 6) in the world.
    const background = quadAt(quads, -1280 / 2 / 60 + 320 / 60, 6 - 180 / 60)!;
    expect(rounded(background.transform.getScale().toArray())).toEqual([4, 2]);
    // By this frame the pointer has come, clicked and gone, so the button looks as authored.
    expect(background.color.toHex()).toBe('#334d80');

    // A button that is not interactable is drawn in its disabled color: here half as
    // bright and half as opaque as its sprite.
    const disabled = quadAt(quads, 1280 / 2 / 60 - 140 / 60, 6 - 60 / 60)!;
    expect(disabled.color.toHex()).toBe('#80661a');
    expect(disabled.color.a).toBe(0.5);

    // Everything on the screen comes after everything in the world.
    const firstOnScreen = Math.min(quads.indexOf(background), quads.indexOf(disabled));
    expect(quads.length - firstOnScreen).toBe(5);
    expect(run.before.texts.map((entry) => entry.text)).toEqual(
      expect.arrayContaining(['HUD', 'Clicked']),
    );
  });

  it('keeps what is on the screen in place when the camera changes', () => {
    // RenderProbe widens the view to 14 units. The same pixels are now elsewhere in the
    // world, and larger there, which is exactly what keeps them unchanged on the screen.
    const unitsPerPixel = 14 / 720;
    const background = quadAt(
      run.after.quads,
      (-1280 / 2 + 320) * unitsPerPixel,
      7 - 180 * unitsPerPixel,
    )!;
    expect(rounded(background.transform.getScale().toArray())).toEqual(
      rounded([240 * unitsPerPixel, 120 * unitsPerPixel]),
    );
  });

  it('stores what the scripts saved', () => {
    const { storage } = run.headless;
    expect(JSON.parse(storage.read()!)).toEqual({
      visits: 1,
      trail: {
        points: [
          [1, 2],
          [3, 4],
        ],
        label: 'trail',
      },
    });
  });

  it('plays the sounds the scene and its scripts ask for', () => {
    const { voices, masterVolume } = run.headless.audio;
    const music = voices[0]!;
    // Started by "play on start", then retuned by AudioProbe while playing.
    expect(music).toMatchObject({ loop: true, volume: 0.25, pitch: 1.5 });
    expect(voices.filter((voice) => !voice.loop && voice.volume === 0.8)).toHaveLength(1);
    expect(voices.filter((voice) => voice.volume === 0.5 && voice.pitch === 1.5)).toHaveLength(1);
    expect(voices.length).toBe(4);
    expect(masterVolume).toBe(1);
    // Leaving the Main scene stops its sounds.
    expect(voices.every((voice) => !voice.isPlaying)).toBe(true);
  });

  it.each([1, 2, 10, 31, 60, 120])(
    'reports no failure when it is stopped after %i frames, before it has finished',
    async (frames) => {
      clearFeatureTestReport();
      const project = createFeatureTestProject();
      const headless = createHeadlessGame(project, new SourceScriptProvider(project.assets));
      await headless.game.start();
      for (let frame = 1; frame <= frames; frame++) {
        driveFeatureTestInput(headless.game.input, frame);
        headless.game.update(FRAME);
      }
      // What the Stop button of the editor does. Stopping is not something that went wrong.
      headless.game.stop();

      const problems = headless.logs.filter((entry) => entry.level !== 'info');
      expect(problems.map((entry) => entry.message)).toEqual([]);
      expect(headless.logs.at(-1)?.message).toMatch(
        /^The feature test was stopped before it had finished\. It was still waiting for: /,
      );
      expect(getFeatureTestReport()?.done).toBe(false);
    },
  );

  it('is deterministic: a second run takes the same number of frames', async () => {
    const second = await runFeatureTest();
    expect(second.frames).toBe(run.frames);
    expect(second.report.checks.map((check) => check.name)).toEqual(
      run.report.checks.map((check) => check.name),
    );
  });
});

describe('feature-test scene coverage', () => {
  const sources = Object.values(FEATURE_TEST_SCRIPTS).join('\n');
  const usesMember = (name: string): boolean => new RegExp(`\\b${name}\\b`).test(sources);

  const project = createFeatureTestProject();
  const mainScene = JSON.parse(
    project.assets.getText(project.assets.findByName('Scenes/Main.scene')!.id),
  ) as SceneData;

  /** Public instance members declared on a class, found by reflection. */
  function prototypeMembers(type: { prototype: object }): string[] {
    return Object.getOwnPropertyNames(type.prototype).filter((name) => name !== 'constructor');
  }

  function staticMembers(type: object): string[] {
    return Object.getOwnPropertyNames(type).filter(
      (name) => !['length', 'name', 'prototype'].includes(name),
    );
  }

  // Interfaces cannot be reflected on, so these lists are checked by the compiler instead:
  // adding a member to the interface without listing it here is a type error.
  const lifecycleHooks: Record<keyof ScriptLifecycle, true> = {
    onStart: true,
    onUpdate: true,
    onFixedUpdate: true,
    onLateUpdate: true,
    onDestroy: true,
    onCollisionEnter: true,
    onCollisionExit: true,
    onTriggerEnter: true,
    onTriggerExit: true,
    onPointerEnter: true,
    onPointerExit: true,
    onPointerDown: true,
    onPointerUp: true,
    onClick: true,
    onAnimationEnd: true,
  };
  const collisionFields: Record<keyof Collision, true> = { other: true, point: true, normal: true };
  const raycastFields: Record<keyof RaycastHit, true> = {
    entity: true,
    point: true,
    normal: true,
    distance: true,
  };
  const spawnOptions: Record<keyof SpawnOptions, true> = {
    position: true,
    rotation: true,
    parent: true,
    name: true,
  };
  const propertyFields: Record<keyof ScriptPropertyDefinition, true> = {
    type: true,
    default: true,
    label: true,
    min: true,
    max: true,
    step: true,
  };

  const scene = new Scene();
  const apiMembers: Record<string, string[]> = {
    'module exports': Object.keys(ScriptApi),
    Behaviour: [...prototypeMembers(Behaviour), 'enabled'],
    ScriptLifecycle: Object.keys(lifecycleHooks),
    Entity: [...prototypeMembers(Entity), ...Object.keys(scene.createEntity())],
    SceneApi: prototypeMembers(SceneApi),
    Input: prototypeMembers(Input),
    MouseButton: Object.keys(MouseButton),
    Physics2D: prototypeMembers(Physics2D),
    AudioApi: prototypeMembers(AudioApi),
    AssetsApi: prototypeMembers(AssetsApi),
    StorageApi: prototypeMembers(StorageApi),
    Time: Object.keys(new Time()),
    Vec2: [...prototypeMembers(Vec2), ...staticMembers(Vec2), ...Object.keys(new Vec2())],
    Color: [...prototypeMembers(Color), ...staticMembers(Color), ...Object.keys(new Color())],
    MathUtils: Object.keys(MathUtils),
    Collision: Object.keys(collisionFields),
    RaycastHit: Object.keys(raycastFields),
    SpawnOptions: Object.keys(spawnOptions),
    ScriptPropertyDefinition: Object.keys(propertyFields),
    'script property types': [...SCRIPT_PROPERTY_TYPES],
  };

  it.each(Object.entries(apiMembers))('scripts exercise every member of %s', (_name, members) => {
    expect(members.length).toBeGreaterThan(0);
    expect(members.filter((member) => !usesMember(member))).toEqual([]);
  });

  it('uses every component type in the Main scene', () => {
    const used = new Set(mainScene.entities.flatMap((entity) => Object.keys(entity.components)));
    expect(
      COMPONENT_TYPES.map((type) => type.schema.name).filter((name) => !used.has(name)),
    ).toEqual([]);
  });

  it.each(COMPONENT_TYPES.map((type) => [type.schema.name, type] as const))(
    'scripts read or write every field of %s',
    (_name, type) => {
      const fields = Object.keys(new type());
      expect(fields.filter((field) => !usesMember(field))).toEqual([]);
    },
  );

  it('uses every body type and both collider kinds as triggers and solids', () => {
    const components = (name: string): Record<string, unknown>[] =>
      mainScene.entities.flatMap((entity) =>
        entity.components[name] ? [entity.components[name]] : [],
      );
    const bodyTypes = new Set(components('Rigidbody2D').map((body) => body.bodyType));
    // Entities with only a collider are the static bodies.
    expect(bodyTypes).toEqual(new Set(['dynamic', 'kinematic']));
    expect(sources).toContain(`bodyType = 'static'`);
    expect(components('BoxCollider2D').some((collider) => collider.isTrigger === true)).toBe(true);
    expect(components('BoxCollider2D').some((collider) => collider.isTrigger === false)).toBe(true);
    expect(components('CircleCollider2D').length).toBeGreaterThan(0);
  });

  it('contains a script for every script file', () => {
    const scriptAssets = project.assets.list('script').map((record) => record.name);
    expect(scriptAssets).toEqual(
      Object.keys(FEATURE_TEST_SCRIPTS)
        .map((name) => `Scripts/${name}.ts`)
        .sort((a, b) => a.localeCompare(b)),
    );
  });
});
