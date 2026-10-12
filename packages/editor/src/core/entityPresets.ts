import {
  AudioSource,
  BoxCollider2D,
  Camera,
  CircleCollider2D,
  Color,
  encodePng,
  Rigidbody2D,
  SpriteRenderer,
  TextRenderer,
  type AssetDatabase,
  type Entity,
  type Scene,
} from '@rowan/core';

export const ENTITY_PRESETS = [
  { id: 'empty', label: 'Empty Entity' },
  { id: 'sprite', label: 'Sprite' },
  { id: 'text', label: 'Text' },
  { id: 'camera', label: 'Camera' },
  { id: 'physics-box', label: 'Physics Box' },
  { id: 'physics-circle', label: 'Physics Circle' },
  { id: 'static-box', label: 'Static Platform' },
  { id: 'trigger', label: 'Trigger Zone' },
  { id: 'audio', label: 'Audio Source' },
] as const;

export type EntityPresetId = (typeof ENTITY_PRESETS)[number]['id'];

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
