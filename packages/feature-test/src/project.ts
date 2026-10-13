import {
  AudioSource,
  BoxCollider2D,
  Button,
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
  ScreenAnchor,
  ScriptComponent,
  serializeScene,
  SpriteAnimator,
  SpriteRenderer,
  TextRenderer,
  Vec2,
  type Entity,
  type ScriptPropertyValue,
} from '@rowan/core';
import { FEATURE_TEST_SCRIPTS } from './scripts';

const TEXTURE_SIZE = 32;
/** The sprite sheet: frames of this many pixels, in this many columns and rows. */
const FRAME_SIZE = 16;
const SHEET_COLUMNS = 4;
const SHEET_ROWS = 2;
/** One color per frame of the sheet, in frame order. The last one is cyan. */
const SHEET_COLORS: readonly (readonly [number, number, number])[] = [
  [255, 64, 64],
  [255, 160, 64],
  [255, 255, 64],
  [64, 255, 64],
  [64, 64, 255],
  [160, 64, 255],
  [255, 64, 255],
  [0, 255, 255],
];

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
  // A second collision layer that passes through everything on the default one.
  project.settings.physics.layers.push('Phantom');
  project.settings.physics.ignoredLayerPairs.push(['Phantom', 'Default']);

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
  const sheet = assets.create({
    name: 'Textures/sheet.png',
    type: 'texture',
    mimeType: 'image/png',
    data: encodePng(SHEET_COLUMNS * FRAME_SIZE, SHEET_ROWS * FRAME_SIZE, drawSheet()),
    meta: { width: SHEET_COLUMNS * FRAME_SIZE, height: SHEET_ROWS * FRAME_SIZE },
  }).id;

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

  // A row of texts. "Title" sets every TextRenderer field to something other than its default.
  const texts = at('Texts', -9, 3);
  attach(texts, 'TextProbe');
  at('Title', 0, 0, texts).addComponent(TextRenderer, {
    text: 'Rowan\nFeature Test',
    font: 'serif',
    fontSize: 0.4,
    bold: true,
    italic: true,
    color: new Color(1, 0.9, 0.4, 1),
    align: 'left',
    verticalAlign: 'top',
    lineHeight: 1.5,
    sortingOrder: 3,
  });
  at('Frame Counter', 6, 0, texts).addComponent(TextRenderer, {
    text: 'Frame 0',
    font: 'monospace',
  });
  at('Hidden Text', 11, 0, texts).addComponent(TextRenderer, {
    text: 'Now you see me',
    visible: false,
  });

  // A sprite sheet of eight frames in eight colors, and two animations over them.
  const animated = at('Animated', 10, 2.5);
  animated.addComponent(SpriteRenderer, {
    texture: sheet,
    pixelsPerUnit: FRAME_SIZE,
    columns: SHEET_COLUMNS,
    rows: SHEET_ROWS,
  });
  animated.addComponent(SpriteAnimator, {
    clips: [
      { name: 'blink', firstFrame: 0, lastFrame: 3, framesPerSecond: 30, loop: true },
      { name: 'once', firstFrame: 4, lastFrame: 6, framesPerSecond: 30, loop: false },
    ],
    clip: 'blink',
  });
  attach(animated, 'AnimationProbe');

  // On the screen: a label in a corner, and a button where the hosts put the pointer, a
  // quarter of the way in from the top-left corner of the 1280x720 screen.
  const hudLabel = at('Hud Label', 24, -24);
  hudLabel.addComponent(ScreenAnchor, { horizontal: 'left', vertical: 'top' });
  hudLabel.addComponent(TextRenderer, {
    text: 'HUD',
    fontSize: 28,
    align: 'left',
    verticalAlign: 'top',
  });
  const hudButton = at('Hud Button', 320, -180);
  hudButton.addComponent(ScreenAnchor, { horizontal: 'left', vertical: 'top' });
  hudButton.addComponent(Button, {
    size: new Vec2(240, 120),
    hoverColor: new Color(1, 1, 0.6, 1),
    pressedColor: new Color(1, 0.6, 0.6, 1),
  });
  hudButton.addComponent(TextRenderer, { text: 'Click me', fontSize: 32 });
  const hudBackground = at('Background', 0, 0, hudButton);
  hudBackground.transform.scale.set(240, 120);
  hudBackground.addComponent(SpriteRenderer, { color: new Color(0.2, 0.3, 0.5, 0.6) });
  attach(hudButton, 'UiProbe');
  const disabledButton = at('Disabled Button', -140, -60);
  disabledButton.transform.scale.set(200, 60);
  disabledButton.addComponent(ScreenAnchor, { horizontal: 'right', vertical: 'top' });
  disabledButton.addComponent(Button, { interactable: false });
  disabledButton.addComponent(SpriteRenderer, { color: new Color(1, 0.8, 0.2, 1) });

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
  // Starts out moving and spinning, in a corner where nothing is in its way.
  const launched = box(at('Launched', -9.5, -5), 0.5, 0.5, new Color(1, 0.8, 0.3, 1));
  launched.addComponent(Rigidbody2D, {
    gravityScale: 0,
    initialVelocity: new Vec2(0, 2),
    initialAngularVelocity: 1,
  });

  at('Music', 0, 0).addComponent(AudioSource, { clip: music, loop: true, volume: 0.5 });
  const sfx = at('Sfx', 0, 0);
  sfx.addComponent(AudioSource, { clip: beep, volume: 0.8, playOnStart: false });
  attach(sfx, 'AudioProbe');

  // Collision layers, off to the right where nothing else comes by: a body on the Phantom
  // layer falls through the first floor and, moved to the default layer, lands on the second.
  const phantom = box(at('Phantom', 13.5, 1), 0.5, 0.5, new Color(0.8, 0.8, 1, 0.6));
  phantom.layer = 'Phantom';
  phantom.addComponent(Rigidbody2D);
  attach(phantom, 'LayerProbe');
  box(at('Thin Floor', 13.5, 0), 1.5, 0.25, new Color(0.6, 0.6, 0.7, 1));
  box(at('Catch Floor', 13.5, -3), 1.5, 0.25, new Color(0.6, 0.6, 0.7, 1));

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
  // The last frame of the sheet is the only cyan thing there is, so the browser tests can
  // tell that a sprite shows the frame it was given and nothing of its neighbours.
  const frame = finish.createEntity('Frame');
  frame.transform.position.set(-5, 0);
  frame.transform.scale.set(2, 2);
  frame.addComponent(SpriteRenderer, {
    texture: sheet,
    pixelsPerUnit: FRAME_SIZE,
    columns: SHEET_COLUMNS,
    rows: SHEET_ROWS,
    frame: SHEET_COLUMNS * SHEET_ROWS - 1,
  });
  // In a color nothing else has, so the browser tests can tell that text reaches the screen.
  const verdict = finish.createEntity('Verdict');
  verdict.transform.position.set(0, 3.2);
  verdict.addComponent(TextRenderer, {
    text: 'Finished',
    fontSize: 1.2,
    bold: true,
    color: new Color(1, 0, 1, 1),
  });

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
/** Every frame of the sheet filled with its own color, so each one can be told apart. */
function drawSheet(): Uint8Array {
  const width = SHEET_COLUMNS * FRAME_SIZE;
  const height = SHEET_ROWS * FRAME_SIZE;
  const pixels = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const frame = Math.floor(y / FRAME_SIZE) * SHEET_COLUMNS + Math.floor(x / FRAME_SIZE);
      pixels.set([...SHEET_COLORS[frame]!, 255], (y * width + x) * 4);
    }
  }
  return pixels;
}

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
