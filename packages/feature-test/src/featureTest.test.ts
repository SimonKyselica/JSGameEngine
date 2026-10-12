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
  SCRIPT_PROPERTY_TYPES,
  Time,
  Vec2,
  type Collision,
  type HeadlessGame,
  type RaycastHit,
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
/** RenderProbe changes sprites and the camera in this frame. */
const RENDER_CHANGE_FRAME = 20;
const MAX_FRAMES = 60 * 20;

interface Run {
  headless: HeadlessGame;
  report: FeatureTestReport;
  /** Quads drawn just before and just after RenderProbe's changes, and the clear colors. */
  before: { quads: RecordedQuad[]; clearColor: string; halfHeight: number };
  after: { quads: RecordedQuad[]; clearColor: string; halfHeight: number };
  frames: number;
}

async function runFeatureTest(): Promise<Run> {
  clearFeatureTestReport();
  const project = createFeatureTestProject();
  const headless = createHeadlessGame(project, new SourceScriptProvider(project.assets));
  const { game, renderer } = headless;
  await game.start();

  const snapshot = (): Run['before'] => {
    game.render();
    return {
      quads: [...renderer.quads],
      clearColor: renderer.clearColor.toHex(),
      halfHeight: game.getCameraView()?.halfHeight ?? 0,
    };
  };

  let before: Run['before'] | undefined;
  let after: Run['after'] | undefined;
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
