import {
  AudioSource,
  BoxCollider2D,
  Button,
  Camera,
  CircleCollider2D,
  Color,
  encodePng,
  ParticleEmitter,
  Rigidbody2D,
  ScreenAnchor,
  SpriteRenderer,
  TextRenderer,
  Tilemap,
  Vec2,
  type AssetDatabase,
  type Entity,
  type Scene,
} from '@rowan/core';

export const ENTITY_PRESETS = [
  { id: 'empty', label: 'Empty Entity' },
  { id: 'sprite', label: 'Sprite' },
  { id: 'text', label: 'Text' },
  { id: 'tilemap', label: 'Tilemap' },
  { id: 'particles', label: 'Particles' },
  { id: 'camera', label: 'Camera' },
  { id: 'physics-box', label: 'Physics Box' },
  { id: 'physics-circle', label: 'Physics Circle' },
  { id: 'static-box', label: 'Static Platform' },
  { id: 'trigger', label: 'Trigger Zone' },
  { id: 'audio', label: 'Audio Source' },
  { id: 'screen-text', label: 'Screen Text' },
  { id: 'button', label: 'Button' },
] as const;

export type EntityPresetId = (typeof ENTITY_PRESETS)[number]['id'];

/** The size of a new button in pixels of the screen. */
const BUTTON_SIZE = new Vec2(220, 64);
/** Font sizes on the screen are in pixels, where the 0.5 of a text in the world would vanish. */
const SCREEN_FONT_SIZE = 32;

/** A new tilemap: this many cells, drawn from a small tileset that is made on the spot. */
const TILEMAP_WIDTH = 18;
const TILEMAP_HEIGHT = 10;
const TILESET_ASSET_NAME = 'Sprites/tiles.png';
const TILE_PIXELS = 16;
/** The tiles of that tileset: grass, earth, stone and water. */
const TILESET_COLORS: readonly (readonly [number, number, number])[] = [
  [86, 168, 92],
  [140, 98, 62],
  [128, 132, 140],
  [64, 132, 214],
];

const CIRCLE_ASSET_NAME = 'Sprites/circle.png';
const CIRCLE_SIZE = 64;

/** Creates an entity from one of the presets in the editor's Create menu. */
export function createPresetEntity(
  scene: Scene,
  assets: AssetDatabase,
  preset: EntityPresetId,
  parent: Entity | null,
): Entity {
  const label = ENTITY_PRESETS.find((candidate) => candidate.id === preset)!.label;
  const entity = scene.createEntity(preset === 'empty' ? 'Entity' : label, { parent });

  switch (preset) {
    case 'empty':
      break;
    case 'sprite':
      entity.addComponent(SpriteRenderer);
      break;
    case 'text':
      entity.addComponent(TextRenderer);
      break;
    case 'particles':
      // A small fire: warm sparks that rise, shrink and fade.
      entity.addComponent(ParticleEmitter, {
        rate: 40,
        lifetime: 1.2,
        speed: 1.5,
        startSize: 0.25,
        startColor: new Color(1, 0.75, 0.25, 1),
        endColor: new Color(1, 0.2, 0.1, 0),
      });
      break;
    case 'tilemap': {
      // As large as the view of a new camera, with a floor to stand on and to paint from.
      entity.transform.position.set(-TILEMAP_WIDTH / 2, -TILEMAP_HEIGHT / 2);
      const map = entity.addComponent(Tilemap, {
        texture: ensureTilesetTexture(assets),
        columns: TILESET_COLORS.length,
        solid: true,
      });
      map.resize(TILEMAP_WIDTH, TILEMAP_HEIGHT);
      for (let column = 0; column < TILEMAP_WIDTH; column++) {
        map.setTile(column, 0, 0);
      }
      break;
    }
    case 'camera':
      // Only the first camera in a scene should claim to be the primary one.
      entity.addComponent(Camera, { primary: scene.registry.count(Camera) === 0 });
      break;
    case 'physics-box':
      entity.addComponent(SpriteRenderer, { color: new Color(0.82, 0.6, 0.36, 1) });
      entity.addComponent(Rigidbody2D);
      entity.addComponent(BoxCollider2D);
      break;
    case 'physics-circle':
      entity.addComponent(SpriteRenderer, {
        texture: ensureCircleTexture(assets),
        pixelsPerUnit: CIRCLE_SIZE,
        color: new Color(0.4, 0.8, 1, 1),
      });
      entity.addComponent(Rigidbody2D);
      entity.addComponent(CircleCollider2D);
      break;
    case 'static-box':
      entity.transform.scale.set(6, 1);
      entity.addComponent(SpriteRenderer, { color: new Color(0.33, 0.62, 0.38, 1) });
      entity.addComponent(BoxCollider2D);
      break;
    case 'trigger':
      entity.transform.scale.set(2, 2);
      entity.addComponent(BoxCollider2D, { isTrigger: true });
      break;
    case 'audio':
      entity.addComponent(AudioSource);
      break;
    case 'screen-text':
      // In the top-left corner, where a score usually goes, and growing to the right.
      entity.addComponent(ScreenAnchor, { horizontal: 'left', vertical: 'top' });
      entity.transform.position.set(24, -24);
      entity.addComponent(TextRenderer, {
        fontSize: SCREEN_FONT_SIZE,
        align: 'left',
        verticalAlign: 'top',
      });
      break;
    case 'button': {
      entity.addComponent(ScreenAnchor);
      entity.addComponent(Button, { size: BUTTON_SIZE.clone() });
      entity.addComponent(TextRenderer, { text: 'Button', fontSize: 28 });
      // The background is a child, because it gets its size from its scale, and a scale
      // on the button itself would stretch the text along with it.
      const background = scene.createEntity('Background', { parent: entity });
      background.transform.scale.copy(BUTTON_SIZE);
      background.addComponent(SpriteRenderer, { color: new Color(0.2, 0.45, 0.85, 1) });
      break;
    }
  }
  return entity;
}

/** Returns the id of the built-in circle sprite, adding it to the project on first use. */
function ensureCircleTexture(assets: AssetDatabase): string {
  const existing = assets.findByName(CIRCLE_ASSET_NAME, 'texture');
  if (existing) {
    return existing.id;
  }
  return assets.create({
    name: CIRCLE_ASSET_NAME,
    type: 'texture',
    mimeType: 'image/png',
    data: encodePng(CIRCLE_SIZE, CIRCLE_SIZE, drawCircle(CIRCLE_SIZE)),
    meta: { width: CIRCLE_SIZE, height: CIRCLE_SIZE },
  }).id;
}

function ensureTilesetTexture(assets: AssetDatabase): string {
  const existing = assets.findByName(TILESET_ASSET_NAME, 'texture');
  if (existing) {
    return existing.id;
  }
  const width = TILESET_COLORS.length * TILE_PIXELS;
  return assets.create({
    name: TILESET_ASSET_NAME,
    type: 'texture',
    mimeType: 'image/png',
    data: encodePng(width, TILE_PIXELS, drawTileset()),
    meta: { width, height: TILE_PIXELS },
  }).id;
}

/** One square per color, each with a darker rim so that neighbouring tiles can be told apart. */
function drawTileset(): Uint8Array {
  const width = TILESET_COLORS.length * TILE_PIXELS;
  const pixels = new Uint8Array(width * TILE_PIXELS * 4);
  for (let y = 0; y < TILE_PIXELS; y++) {
    for (let x = 0; x < width; x++) {
      const [red, green, blue] = TILESET_COLORS[Math.floor(x / TILE_PIXELS)]!;
      const inTile = x % TILE_PIXELS;
      const onRim = inTile === 0 || y === 0 || inTile === TILE_PIXELS - 1 || y === TILE_PIXELS - 1;
      const shade = onRim ? 0.8 : 1;
      pixels.set([red * shade, green * shade, blue * shade, 255], (y * width + x) * 4);
    }
  }
  return pixels;
}

/** A white disc on a transparent background with a one-pixel soft edge. */
function drawCircle(size: number): Uint8Array {
  const pixels = new Uint8Array(size * size * 4);
  const center = (size - 1) / 2;
  const radius = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const distance = Math.hypot(x - center, y - center);
      const alpha = Math.max(0, Math.min(1, radius - distance));
      pixels.set([255, 255, 255, Math.round(alpha * 255)], (y * size + x) * 4);
    }
  }
  return pixels;
}
