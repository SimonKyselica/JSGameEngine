import {
  AudioSource,
  BoxCollider2D,
  Camera,
  CircleCollider2D,
  Color,
  createDefaultSettings,
  createPrefab,
  encodePng,
  encodeWav,
  generateTone,
  Project,
  Rigidbody2D,
  Scene,
  ScriptComponent,
  serializeScene,
  SpriteRenderer,
  type Entity,
  type ScriptPropertyValue,
} from '@rowan/core';
import { FEATURE_TEST_SCRIPTS } from './scripts';

const TEXTURE_SIZE = 32;

/**
 * Builds the feature-test project: a "Main" scene that uses every component and whose
 * scripts exercise the whole scripting API, and a "Finish" scene that closes the report.
 *
 * Everything is generated in code, including textures and sounds, so the project has no
 * binary files to keep in sync.
 */
export function createFeatureTestProject(): Project {
  const project = new Project(createDefaultSettings('Rowan Feature Test'));
  const { assets } = project;

  const scripts = new Map<string, string>();
  for (const [name, source] of Object.entries(FEATURE_TEST_SCRIPTS)) {
    const record = assets.create({
      name: `Scripts/${name}.ts`,
      type: 'script',
      mimeType: 'text/typescript',
      data: source,
    });
    scripts.set(name, record.id);
  }
  const script = (name: string): string => {
    const id = scripts.get(name);
    if (!id) {
      throw new Error(`The feature test has no script called "${name}"`);
    }
    return id;
  };

  const createTexture = (name: string, pixels: Uint8Array): string =>
    assets.create({
      name: `Textures/${name}.png`,
      type: 'texture',
      mimeType: 'image/png',
      data: encodePng(TEXTURE_SIZE, TEXTURE_SIZE, pixels),
      meta: { width: TEXTURE_SIZE, height: TEXTURE_SIZE },
    }).id;
  const checker = createTexture('checker', drawChecker());
  const disc = createTexture('disc', drawDisc());

  const createSound = (name: string, frequency: number, seconds: number): string =>
    assets.create({
      name: `Sounds/${name}.wav`,
      type: 'audio',
      mimeType: 'audio/wav',
      data: encodeWav(generateTone(frequency, seconds), 22050),
    }).id;
  const beep = createSound('beep', 880, 0.15);
  const music = createSound('music', 220, 1);

  const attach = (
    entity: Entity,
    scriptName: string,
    properties: Record<string, ScriptPropertyValue> = {},
  ): void => {
    const component = entity.getComponent(ScriptComponent) ?? entity.addComponent(ScriptComponent);
    component.scripts.push({ script: script(scriptName), enabled: true, properties });
  };

  const bulletPrefab = assets.create({
    name: 'Prefabs/Bullet.prefab',
    type: 'prefab',
    mimeType: 'application/json',
    data: JSON.stringify(createPrefab(createBullet(disc, attach)), null, 2),
  }).id;

  const main = new Scene('Main');
  const at = (name: string, x: number, y: number, parent?: Entity): Entity => {
    const entity = main.createEntity(name, { parent });
    entity.transform.position.set(x, y);
    return entity;
  };
  const box = (entity: Entity, width: number, height: number, color: Color): Entity => {
    entity.transform.scale.set(width, height);
    entity.addComponent(SpriteRenderer, { color });
    entity.addComponent(BoxCollider2D);
    return entity;
  };

  attach(at('Harness', 0, 0), 'TestHarness', { timeout: 15, nextScene: 'Finish' });
  at('Main Camera', 0, 0).addComponent(Camera, {
    orthographicSize: 6,
    backgroundColor: new Color(0.1, 0.12, 0.2, 1),
  });
  at('Alt Camera', 0, 0).addComponent(Camera, { orthographicSize: 3, primary: false });

  const backdrop = at('Backdrop', 0, 0);
  backdrop.transform.scale.set(30, 14);
  backdrop.addComponent(SpriteRenderer, {
    color: new Color(0.16, 0.18, 0.28, 1),
    sortingOrder: -10,
  });

  // A row of sprites that covers every SpriteRenderer field.
  const sprites = at('Sprites', -9, 4.5);
  attach(sprites, 'RenderProbe');
  at('Checker', 0, 0, sprites).addComponent(SpriteRenderer, {
    texture: checker,
    pixelsPerUnit: 32,
    sortingOrder: 1,
  });
  at('Flipped', 1.5, 0, sprites).addComponent(SpriteRenderer, {
    texture: checker,
    pixelsPerUnit: 32,
    flipX: true,
    flipY: true,
  });
  at('Tinted', 3, 0, sprites).addComponent(SpriteRenderer, {
    texture: disc,
    pixelsPerUnit: 32,
    color: new Color(1, 0, 0, 1),
  });
  at('Hidden', 4.5, 0, sprites).addComponent(SpriteRenderer, {
    texture: disc,
    pixelsPerUnit: 32,
    visible: false,
  });
  const inactive = at('Inactive', 6, 0, sprites);
  inactive.addComponent(SpriteRenderer, { texture: disc, pixelsPerUnit: 32 });
  inactive.active = false;

  attach(at('Math Probe', 0, 0), 'MathProbe');
  attach(at('Lifecycle Probe', 0, 0), 'LifecycleProbe');
  attach(at('Counter', 0, 0), 'Counter');
  attach(at('Input Probe', 0, 0), 'InputProbe');

  const entityProbe = at('Entity Probe', 2, 1);
  entityProbe.tag = 'probe';
  entityProbe.transform.rotation = Math.PI / 2;
  entityProbe.transform.scale.set(2, 2);
  at('Probe Child', 1, 0, entityProbe);
  attach(entityProbe, 'EntityProbe');

  // A crate that lands on the ground, jumps and lands again.
  box(at('Ground', -6, -3), 4, 1, new Color(0.3, 0.6, 0.35, 1));
  const crate = box(at('Crate', -6, 0), 1, 1, new Color(0.8, 0.55, 0.3, 1));
  crate.addComponent(Rigidbody2D);
  attach(crate, 'PhysicsProbe');

  // A ball that falls through a trigger zone and bounces on the floor below it.
  box(at('Ball Floor', 0, -3), 3, 1, new Color(0.3, 0.6, 0.35, 1));
  const zone = at('Trigger Zone', 0, 0);
  zone.addComponent(SpriteRenderer, { color: new Color(1, 1, 0.3, 0.25) });
  zone.transform.scale.set(3, 0.5);
  zone.addComponent(BoxCollider2D, { isTrigger: true });
  attach(zone, 'TriggerProbe');
  const ball = at('Ball', 0, 2);
  ball.addComponent(SpriteRenderer, {
    texture: disc,
    pixelsPerUnit: 64,
    color: new Color(0.4, 0.8, 1, 1),
  });
  ball.addComponent(Rigidbody2D);
  ball.addComponent(CircleCollider2D, { radius: 0.25, restitution: 0.8 });

  const floater = box(at('Floater', 4.5, 2), 1, 1, new Color(0.7, 0.4, 0.9, 1));
  floater.addComponent(Rigidbody2D, { gravityScale: 0, angularDamping: 0 });
  const platform = box(at('Platform', 7, -3), 1.5, 0.5, new Color(0.9, 0.9, 0.9, 1));
  platform.addComponent(Rigidbody2D, { bodyType: 'kinematic' });
  box(at('Wall', 9, 0), 1, 1, new Color(0.5, 0.5, 0.55, 1));

  at('Music', 0, 0).addComponent(AudioSource, { clip: music, loop: true, volume: 0.5 });
  const sfx = at('Sfx', 0, 0);
  sfx.addComponent(AudioSource, { clip: beep, volume: 0.8, playOnStart: false });
  attach(sfx, 'AudioProbe');

  // Kept out of the sprite row above, so the host can tell bullets and row sprites apart.
  attach(at('Spawner', 3, 3.25), 'Spawner', {
    count: 2,
    label: 'shot',
    offset: [1, 0],
    sprite: disc,
    sound: beep,
    prefab: bulletPrefab,
  });

  const finish = new Scene('Finish');
  finish.createEntity('Main Camera').addComponent(Camera, {
    backgroundColor: new Color(0.1, 0.25, 0.15, 1),
  });
  const done = finish.createEntity('Done');
  done.addComponent(SpriteRenderer, {
    texture: disc,
    pixelsPerUnit: 8,
    color: new Color(0.4, 1, 0.5, 1),
  });
  attach(done, 'FinishProbe');

  for (const scene of [main, finish]) {
    const record = assets.create({
      name: `Scenes/${scene.name}.scene`,
      type: 'scene',
      mimeType: 'application/json',
      data: JSON.stringify(serializeScene(scene), null, 2),
    });
    if (scene === main) {
      project.settings.startScene = record.id;
    }
  }
  return project;
}

/** Builds the entity the Bullet prefab is made from, in a scratch scene. */
function createBullet(
  texture: string,
  attach: (
    entity: Entity,
    script: string,
    properties?: Record<string, ScriptPropertyValue>,
  ) => void,
): Entity {
  const bullet = new Scene('Prefab').createEntity('Bullet');
  bullet.tag = 'bullet';
  bullet.addComponent(SpriteRenderer, { texture, pixelsPerUnit: 128, sortingOrder: 2 });
  bullet.addComponent(Rigidbody2D, { gravityScale: 0 });
  bullet.addComponent(CircleCollider2D, { radius: 0.125, isTrigger: true });
  attach(bullet, 'Bullet', { lifetime: 0.5 });
  return bullet;
}

/** An opaque checkerboard of 8-pixel squares. The top-left square is white. */
function drawChecker(): Uint8Array {
  const pixels = new Uint8Array(TEXTURE_SIZE * TEXTURE_SIZE * 4);
  for (let y = 0; y < TEXTURE_SIZE; y++) {
    for (let x = 0; x < TEXTURE_SIZE; x++) {
      const light = (Math.floor(x / 8) + Math.floor(y / 8)) % 2 === 0;
      pixels.set(light ? [255, 255, 255, 255] : [40, 60, 120, 255], (y * TEXTURE_SIZE + x) * 4);
    }
  }
  return pixels;
}

/** A white disc on a transparent background, with a soft one-pixel edge. */
function drawDisc(): Uint8Array {
  const pixels = new Uint8Array(TEXTURE_SIZE * TEXTURE_SIZE * 4);
  const center = (TEXTURE_SIZE - 1) / 2;
  const radius = TEXTURE_SIZE / 2 - 1;
  for (let y = 0; y < TEXTURE_SIZE; y++) {
    for (let x = 0; x < TEXTURE_SIZE; x++) {
      const distance = Math.hypot(x - center, y - center);
      const alpha = Math.max(0, Math.min(1, radius - distance + 0.5));
      pixels.set([255, 255, 255, Math.round(alpha * 255)], (y * TEXTURE_SIZE + x) * 4);
    }
  }
  return pixels;
}
