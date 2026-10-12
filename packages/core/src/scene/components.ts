import { RowanError } from '../core/assert';
import type { EntityId } from '../ecs/registry';
import { Color } from '../math/color';
import { Vec2 } from '../math/vec2';
import type { ComponentSchema, ComponentType } from './schema';

/** Name, tag and active flag. Every entity has exactly one. */
export class Identity {
  static readonly schema: ComponentSchema = {
    name: 'Identity',
    displayName: 'Entity',
    category: 'Core',
    removable: false,
    fields: {
      name: { type: 'string' },
      tag: { type: 'string' },
      active: { type: 'boolean' },
    },
  };

  /** Stable id used for serialization and cross-references. Assigned by the scene. */
  uuid = '';
  /** The name of the entity, as shown in the editor's hierarchy. */
  name = 'Entity';
  /** A free-form label for finding groups of entities from scripts. */
  tag = '';
  /** Inactive entities, and all of their descendants, are not updated, simulated or drawn. */
  active = true;
}

/** Position, rotation and scale relative to the parent entity. Every entity has exactly one. */
export class Transform {
  static readonly schema: ComponentSchema = {
    name: 'Transform',
    displayName: 'Transform',
    category: 'Core',
    removable: false,
    fields: {
      position: { type: 'vec2' },
      rotation: { type: 'angle' },
      scale: { type: 'vec2' },
    },
  };

  /** Position relative to the parent, in world units. World Y points up. */
  position = new Vec2(0, 0);
  /** Counter-clockwise rotation in radians. */
  rotation = 0;
  /** Scale relative to the parent. 1 is the original size; a negative value mirrors. */
  scale = new Vec2(1, 1);
}

/**
 * Parent and child links. Owned and kept consistent by the scene; change the hierarchy
 * through `Scene.setParent`, never by editing this component directly.
 */
export class Hierarchy {
  parent: EntityId | null = null;
  children: EntityId[] = [];
}

/** Draws a textured or solid-colored quad. */
export class SpriteRenderer {
  static readonly schema: ComponentSchema = {
    name: 'SpriteRenderer',
    displayName: 'Sprite Renderer',
    category: 'Rendering',
    removable: true,
    fields: {
      texture: { type: 'asset', assetType: 'texture' },
      color: { type: 'color' },
      flipX: { type: 'boolean' },
      flipY: { type: 'boolean' },
      sortingOrder: { type: 'number', step: 1 },
      pixelsPerUnit: { type: 'number', min: 0.01 },
      visible: { type: 'boolean' },
    },
  };

  /** Texture asset id. Without a texture the sprite is a 1x1 unit square in `color`. */
  texture: string | null = null;
  /** Tint multiplied with the texture. */
  color = Color.white();
  /** Mirrors the sprite horizontally. */
  flipX = false;
  /** Mirrors the sprite vertically. */
  flipY = false;
  /** Sprites with a higher order are drawn on top. */
  sortingOrder = 0;
  /** How many texture pixels cover one world unit. */
  pixelsPerUnit = 100;
  /** A sprite that is not visible is not drawn. The rest of the entity keeps working. */
  visible = true;
}

export const TEXT_FONTS = ['sans-serif', 'serif', 'monospace'] as const;
/**
 * The fonts text can be drawn in. Each one stands for the browser's own font of that kind, so
 * the exact letter shapes, and with them the width of a text, differ a little between devices.
 */
export type TextFont = (typeof TEXT_FONTS)[number];

export const TEXT_ALIGNMENTS = ['left', 'center', 'right'] as const;
/** Where a text sits horizontally, relative to its entity. See `TextRenderer.align`. */
export type TextAlign = (typeof TEXT_ALIGNMENTS)[number];

export const TEXT_VERTICAL_ALIGNMENTS = ['top', 'middle', 'bottom'] as const;
/** Where a text sits vertically, relative to its entity. See `TextRenderer.verticalAlign`. */
export type TextVerticalAlign = (typeof TEXT_VERTICAL_ALIGNMENTS)[number];

/**
 * Draws text at the entity's position. The text follows the entity's rotation and scale, and
 * is sorted together with sprites.
 */
export class TextRenderer {
  static readonly schema: ComponentSchema = {
    name: 'TextRenderer',
    displayName: 'Text Renderer',
    category: 'Rendering',
    removable: true,
    fields: {
      text: { type: 'string', multiline: true },
      font: { type: 'enum', options: TEXT_FONTS },
      fontSize: { type: 'number', min: 0, step: 0.1 },
      bold: { type: 'boolean' },
      italic: { type: 'boolean' },
      color: { type: 'color' },
      align: { type: 'enum', options: TEXT_ALIGNMENTS },
      verticalAlign: { type: 'enum', options: TEXT_VERTICAL_ALIGNMENTS },
      lineHeight: { type: 'number', min: 0.1, step: 0.1 },
      sortingOrder: { type: 'number', step: 1 },
      visible: { type: 'boolean' },
    },
  };

  /** What is written. A line break (`\n`) starts a new line. */
  text = 'Text';
  /** The font the text is drawn in. */
  font: TextFont = 'sans-serif';
  /** The height of the font in world units, before the entity's scale is applied. */
  fontSize = 0.5;
  /** Draws the text in a heavier weight. */
  bold = false;
  /** Draws the text slanted. */
  italic = false;
  /** The color of the text. Its alpha makes the text see-through. */
  color = Color.white();
  /**
   * Where the text sits horizontally: `left` starts it at the entity's position, `center`
   * centers it there and `right` ends it there. Lines of different length line up the same way.
   */
  align: TextAlign = 'center';
  /**
   * Where the text sits vertically: `top` hangs it below the entity's position, `middle`
   * centers it there and `bottom` stands it on top.
   */
  verticalAlign: TextVerticalAlign = 'middle';
  /** The distance from one line to the next, as a multiple of `fontSize`. */
  lineHeight = 1.2;
  /**
   * Text with a higher order is drawn on top. The order is shared with `SpriteRenderer`; where
   * a text and a sprite have the same order, the text is on top.
   */
  sortingOrder = 0;
  /** A text that is not visible is not drawn. The rest of the entity keeps working. */
  visible = true;
}

/** An orthographic camera. The scene is drawn from the first active primary camera. */
export class Camera {
  static readonly schema: ComponentSchema = {
    name: 'Camera',
    displayName: 'Camera',
    category: 'Rendering',
    removable: true,
    fields: {
      orthographicSize: { type: 'number', min: 0.01 },
      primary: { type: 'boolean' },
      backgroundColor: { type: 'color' },
    },
  };

  /** Half of the visible height in world units. */
  orthographicSize = 5;
  /**
   * Marks the camera the game is drawn from. When several are marked, the first active one is used.
   */
  primary = true;
  /** The color the view is cleared to before the sprites are drawn. */
  backgroundColor = new Color(0.12, 0.13, 0.17, 1);
}

export const BODY_TYPES = ['static', 'kinematic', 'dynamic'] as const;
/** How a physics body moves. See `Rigidbody2D.bodyType`. */
export type BodyType = (typeof BODY_TYPES)[number];

/** Makes the entity a physics body. */
export class Rigidbody2D {
  static readonly schema: ComponentSchema = {
    name: 'Rigidbody2D',
    displayName: 'Rigidbody 2D',
    category: 'Physics',
    removable: true,
    fields: {
      bodyType: { type: 'enum', options: BODY_TYPES },
      gravityScale: { type: 'number' },
      linearDamping: { type: 'number', min: 0 },
      angularDamping: { type: 'number', min: 0 },
      fixedRotation: { type: 'boolean' },
      continuous: { type: 'boolean', label: 'Continuous Collision' },
      initialVelocity: { type: 'vec2' },
      initialAngularVelocity: { type: 'angle' },
    },
  };

  /**
   * `dynamic` bodies are moved by forces and collisions, `kinematic` bodies move only by their
   * velocity, and `static` bodies never move.
   */
  bodyType: BodyType = 'dynamic';
  /**
   * How strongly gravity pulls on the body. 0 switches gravity off for it; a negative value makes
   * it rise.
   */
  gravityScale = 1;
  /** Slows movement down over time, like air resistance. 0 never slows the body. */
  linearDamping = 0;
  /** Slows spinning down over time. 0 never slows the spin. */
  angularDamping = 0.05;
  /** Prevents collisions and torques from rotating the body. */
  fixedRotation = false;
  /** Enables continuous collision detection for fast-moving bodies. */
  continuous = false;
  /**
   * The velocity the body starts with, in world units per second. It is applied once,
   * when the rigidbody starts to exist; afterwards use `physics.setVelocity`.
   */
  initialVelocity = new Vec2(0, 0);
  /** The spin the body starts with, in radians per second, counter-clockwise. */
  initialAngularVelocity = 0;
}

/** A box collision shape. Without a {@link Rigidbody2D} the entity acts as a static body. */
export class BoxCollider2D {
  static readonly schema: ComponentSchema = {
    name: 'BoxCollider2D',
    displayName: 'Box Collider 2D',
    category: 'Physics',
    removable: true,
    fields: {
      offset: { type: 'vec2' },
      size: { type: 'vec2' },
      density: { type: 'number', min: 0 },
      friction: { type: 'number', min: 0 },
      restitution: { type: 'number', min: 0 },
      isTrigger: { type: 'boolean' },
    },
  };

  /** Center of the box relative to the entity, in local units. */
  offset = new Vec2(0, 0);
  /** Full width and height in local units, before the entity's scale is applied. */
  size = new Vec2(1, 1);
  /** Mass per unit of area. Together with the size it gives a dynamic body its mass. */
  density = 1;
  /** How much the surface resists sliding. 0 is as slippery as ice. */
  friction = 0.4;
  /** Bounciness. 0 does not bounce, 1 keeps all energy. */
  restitution = 0;
  /** Triggers detect overlaps and raise trigger events but do not collide. */
  isTrigger = false;
}

/** A circle collision shape. Without a {@link Rigidbody2D} the entity acts as a static body. */
export class CircleCollider2D {
  static readonly schema: ComponentSchema = {
    name: 'CircleCollider2D',
    displayName: 'Circle Collider 2D',
    category: 'Physics',
    removable: true,
    fields: {
      offset: { type: 'vec2' },
      radius: { type: 'number', min: 0.0001 },
      density: { type: 'number', min: 0 },
      friction: { type: 'number', min: 0 },
      restitution: { type: 'number', min: 0 },
      isTrigger: { type: 'boolean' },
    },
  };

  /** Center of the circle relative to the entity, in local units. */
  offset = new Vec2(0, 0);
  /** Radius in local units. The larger of the entity's scale axes is applied to it. */
  radius = 0.5;
  /** Mass per unit of area. Together with the radius it gives a dynamic body its mass. */
  density = 1;
  /** How much the surface resists sliding. 0 is as slippery as ice. */
  friction = 0.4;
  /** Bounciness. 0 does not bounce, 1 keeps all energy. */
  restitution = 0;
  /** Triggers detect overlaps and raise trigger events but do not collide. */
  isTrigger = false;
}

/** Plays an audio clip. */
export class AudioSource {
  static readonly schema: ComponentSchema = {
    name: 'AudioSource',
    displayName: 'Audio Source',
    category: 'Audio',
    removable: true,
    fields: {
      clip: { type: 'asset', assetType: 'audio' },
      volume: { type: 'number', min: 0, max: 1, step: 0.01 },
      pitch: { type: 'number', min: 0.01, max: 4, step: 0.01 },
      loop: { type: 'boolean' },
      playOnStart: { type: 'boolean' },
    },
  };

  /** Audio asset id. */
  clip: string | null = null;
  /** Loudness, from 0 (silent) to 1 (full). */
  volume = 1;
  /** Playback rate. 1 is the original pitch. */
  pitch = 1;
  /** Starts the clip over when it ends, until it is stopped. */
  loop = false;
  /** Starts playing as soon as the scene starts. */
  playOnStart = true;
}

/** A value a script property can hold in a saved scene. */
export type ScriptPropertyValue = number | boolean | string | number[] | null;

/** One script attached to an entity, with the property values set in the inspector. */
export interface ScriptBinding {
  /** Script asset id. */
  script: string | null;
  /**
   * Whether the script starts out enabled. A script that starts disabled is not started, and gets
   * no callbacks, until its `enabled` is set to `true`.
   */
  enabled: boolean;
  /** The values set in the inspector, by property name. Vectors and colors are stored as arrays. */
  properties: Record<string, ScriptPropertyValue>;
}

/** Attaches behaviour scripts to an entity. */
export class ScriptComponent {
  static readonly schema: ComponentSchema = {
    name: 'Script',
    displayName: 'Script',
    category: 'Scripting',
    removable: true,
    fields: {
      scripts: { type: 'json', hidden: true, parse: parseScriptBindings },
    },
  };

  /** The scripts attached to the entity, in the order they run. */
  scripts: ScriptBinding[] = [];
}

function parseScriptBindings(value: unknown, path: string): ScriptBinding[] {
  if (!Array.isArray(value)) {
    throw new RowanError(`${path}: expected an array of script bindings`);
  }
  return value.map((item: unknown, index) => {
    const itemPath = `${path}[${index}]`;
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      throw new RowanError(`${itemPath}: expected an object`);
    }
    const binding = item as Partial<Record<keyof ScriptBinding, unknown>>;
    if (binding.script !== null && typeof binding.script !== 'string') {
      throw new RowanError(`${itemPath}.script: expected an asset id or null`);
    }
    const properties = binding.properties ?? {};
    if (typeof properties !== 'object' || properties === null || Array.isArray(properties)) {
      throw new RowanError(`${itemPath}.properties: expected an object`);
    }
    return {
      script: binding.script,
      enabled: binding.enabled !== false,
      properties: properties as Record<string, ScriptPropertyValue>,
    };
  });
}

/**
 * Every serializable component, in the order editors list them.
 * Add new component types here; serialization, cloning and the inspector follow from it.
 */
export const COMPONENT_TYPES: readonly ComponentType[] = [
  Identity,
  Transform,
  SpriteRenderer,
  TextRenderer,
  Camera,
  Rigidbody2D,
  BoxCollider2D,
  CircleCollider2D,
  AudioSource,
  ScriptComponent,
];

const COMPONENT_TYPES_BY_NAME: ReadonlyMap<string, ComponentType> = new Map(
  COMPONENT_TYPES.map((type) => [type.schema.name, type]),
);

/** Finds a component type by its serialized name. */
export function getComponentTypeByName(name: string): ComponentType | undefined {
  return COMPONENT_TYPES_BY_NAME.get(name);
}
