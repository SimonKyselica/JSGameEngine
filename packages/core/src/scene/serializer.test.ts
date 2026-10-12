import { describe, expect, it, vi } from 'vitest';
import { RowanError } from '../core/assert';
import { Color } from '../math/color';
import { Vec2 } from '../math/vec2';
import {
  AudioSource,
  BoxCollider2D,
  Camera,
  CircleCollider2D,
  COMPONENT_TYPES,
  getComponentTypeByName,
  Rigidbody2D,
  ScriptComponent,
  SpriteRenderer,
} from './components';
import { Scene } from './scene';
import {
  copyComponent,
  deserializeComponent,
  formatFieldLabel,
  serializeComponent,
} from './schema';
import {
  cloneScene,
  createPrefab,
  deserializeScene,
  duplicateEntity,
  instantiatePrefab,
  makeUniqueName,
  PREFAB_FORMAT,
  SCENE_FORMAT,
  SCENE_VERSION,
  serializeScene,
  type SceneData,
} from './serializer';

/** A scene that uses every component type with non-default values. */
function createFullScene(): Scene {
  const scene = new Scene('Full');
  const camera = scene.createEntity('Camera');
  camera.addComponent(Camera, { orthographicSize: 7, backgroundColor: new Color(0.1, 0.2, 0.3) });

  const player = scene.createEntity('Player');
  player.tag = 'player';
  player.transform.position.set(1, 2);
  player.transform.rotation = 0.5;
  player.transform.scale.set(2, 3);
  player.addComponent(SpriteRenderer, {
    texture: 'texture-id',
    color: new Color(1, 0, 0, 0.5),
    flipX: true,
    sortingOrder: 4,
    pixelsPerUnit: 32,
  });
  player.addComponent(Rigidbody2D, { bodyType: 'kinematic', gravityScale: 0, continuous: true });
  player.addComponent(BoxCollider2D, { size: new Vec2(2, 1), offset: new Vec2(0, 0.5) });
  player.addComponent(CircleCollider2D, { radius: 0.25, isTrigger: true });
  player.addComponent(AudioSource, { clip: 'clip-id', volume: 0.5, loop: true });
  player.addComponent(ScriptComponent, {
    scripts: [{ script: 'script-id', enabled: false, properties: { speed: 5, dir: [1, 0] } }],
  });

  const child = scene.createEntity('Child', { parent: player });
  child.active = false;
  return scene;
}

describe('component schemas', () => {
  it('has a unique serialized name for every component type', () => {
    const componentNames = COMPONENT_TYPES.map((type) => type.schema.name);
    expect(new Set(componentNames).size).toBe(componentNames.length);
    for (const type of COMPONENT_TYPES) {
      expect(getComponentTypeByName(type.schema.name)).toBe(type);
    }
    expect(getComponentTypeByName('Nope')).toBeUndefined();
  });

  it('describes exactly the fields each component has', () => {
    for (const type of COMPONENT_TYPES) {
      const instance = new type() as Record<string, unknown>;
      for (const field of Object.keys(type.schema.fields)) {
        expect(instance, `${type.schema.name}.${field}`).toHaveProperty(field);
      }
    }
  });

  it('serializes a component to plain JSON', () => {
    const sprite = new SpriteRenderer();
    sprite.color = new Color(0.5, 0.25, 0, 1);
    expect(serializeComponent(sprite, SpriteRenderer.schema)).toEqual({
      texture: null,
      color: [0.5, 0.25, 0, 1],
      flipX: false,
      flipY: false,
      sortingOrder: 0,
      pixelsPerUnit: 100,
      visible: true,
    });
  });

  it('keeps defaults for fields missing from the data', () => {
    const body = new Rigidbody2D();
    deserializeComponent(body, Rigidbody2D.schema, { gravityScale: 3 }, 'body');
    expect(body.gravityScale).toBe(3);
    expect(body.bodyType).toBe('dynamic');
  });

  it.each([
    [Rigidbody2D, { gravityScale: 'heavy' }, 'expected a finite number'],
    [Rigidbody2D, { gravityScale: Number.NaN }, 'expected a finite number'],
    [Rigidbody2D, { bodyType: 'floating' }, 'expected one of "static", "kinematic", "dynamic"'],
    [Rigidbody2D, { fixedRotation: 1 }, 'expected a boolean'],
    [BoxCollider2D, { size: [1] }, 'expected an array of 2 numbers'],
    [BoxCollider2D, { size: [1, 'a'] }, 'size[1]: expected a finite number'],
    [SpriteRenderer, { color: [1, 1] }, 'expected an array of 3 to 4 numbers'],
    [SpriteRenderer, { texture: 5 }, 'expected an asset id or null'],
    [ScriptComponent, { scripts: {} }, 'expected an array of script bindings'],
    [ScriptComponent, { scripts: [{ script: 7 }] }, 'scripts[0].script'],
    [ScriptComponent, { scripts: [{ script: null, properties: [] }] }, 'scripts[0].properties'],
  ])('rejects invalid data for %o', (type, data, message) => {
    expect(() => deserializeComponent(new type(), type.schema, data, 'c')).toThrow(message);
  });

  it('rejects data that is not an object', () => {
    expect(() => deserializeComponent(new Camera(), Camera.schema, [], 'c')).toThrow(RowanError);
    expect(() => deserializeComponent(new Camera(), Camera.schema, null, 'c')).toThrow(RowanError);
  });

  it('accepts three-channel colors and fills in script binding defaults', () => {
    const sprite = new SpriteRenderer();
    deserializeComponent(sprite, SpriteRenderer.schema, { color: [0, 0, 0] }, 'c');
    expect(sprite.color.toArray()).toEqual([0, 0, 0, 1]);

    const script = new ScriptComponent();
    deserializeComponent(script, ScriptComponent.schema, { scripts: [{ script: 'id' }] }, 'c');
    expect(script.scripts).toEqual([{ script: 'id', enabled: true, properties: {} }]);
  });

  it('deep-copies components', () => {
    const source = new BoxCollider2D();
    source.size.set(4, 5);
    const target = new BoxCollider2D();
    copyComponent(source, target, BoxCollider2D.schema);
    source.size.set(9, 9);
    expect(target.size.toArray()).toEqual([4, 5]);
  });

  it('turns field names into labels', () => {
    expect(formatFieldLabel('gravityScale')).toBe('Gravity Scale');
    expect(formatFieldLabel('isTrigger')).toBe('Is Trigger');
    expect(formatFieldLabel('size')).toBe('Size');
  });
});

describe('scene serialization', () => {
  it('writes a versioned document with entities in hierarchy order', () => {
    const data = serializeScene(createFullScene());
    expect(data.format).toBe(SCENE_FORMAT);
    expect(data.version).toBe(SCENE_VERSION);
    expect(data.name).toBe('Full');
    expect(data.entities.map((entity) => entity.components.Identity?.name)).toEqual([
      'Camera',
      'Player',
      'Child',
    ]);
    expect(data.entities[2]!.parent).toBe(data.entities[1]!.uuid);
    expect(Object.keys(data.entities[1]!.components)).toEqual([
      'Identity',
      'Transform',
      'SpriteRenderer',
      'Rigidbody2D',
      'BoxCollider2D',
      'CircleCollider2D',
      'AudioSource',
      'Script',
    ]);
  });

  it('round-trips every component through JSON without loss', () => {
    const original = serializeScene(createFullScene());
    const restored = deserializeScene(JSON.parse(JSON.stringify(original)));
    expect(serializeScene(restored)).toEqual(original);
  });

  it('restores hierarchy, uuids and component values', () => {
    const source = createFullScene();
    const restored = cloneScene(source);
    const player = restored.findByName('Player')!;
    expect(player.uuid).toBe(source.findByName('Player')!.uuid);
    expect(player.tag).toBe('player');
    expect(player.children.map((child) => child.name)).toEqual(['Child']);
    expect(player.children[0]!.active).toBe(false);
    expect(player.requireComponent(SpriteRenderer).color.toArray()).toEqual([1, 0, 0, 0.5]);
    expect(player.requireComponent(Rigidbody2D).bodyType).toBe('kinematic');
    expect(player.requireComponent(ScriptComponent).scripts[0]!.properties).toEqual({
      speed: 5,
      dir: [1, 0],
    });
  });

  it('does not share state between a scene and its clone', () => {
    const source = createFullScene();
    const clone = cloneScene(source);
    clone.findByName('Player')!.transform.position.set(99, 99);
    clone.findByName('Player')!.requireComponent(ScriptComponent).scripts[0]!.properties.speed = 1;
    const player = source.findByName('Player')!;
    expect(player.transform.position.toArray()).toEqual([1, 2]);
    expect(player.requireComponent(ScriptComponent).scripts[0]!.properties.speed).toBe(5);
  });

  it('skips unknown components with a warning', () => {
    const data = serializeScene(createFullScene());
    data.entities[0]!.components.Hologram = { intensity: 3 };
    const onWarning = vi.fn();
    const scene = deserializeScene(data, { onWarning });
    expect(scene.entityCount).toBe(3);
    expect(onWarning).toHaveBeenCalledExactlyOnceWith(
      'entities[0]: skipped unknown component "Hologram"',
    );
  });

  it('moves entities with a missing or cyclic parent to the root', () => {
    const data: SceneData = {
      format: SCENE_FORMAT,
      version: SCENE_VERSION,
      name: 'Broken',
      entities: [
        { uuid: 'a', parent: 'b', components: { Identity: { name: 'A' } } },
        { uuid: 'b', parent: 'a', components: { Identity: { name: 'B' } } },
        { uuid: 'c', parent: 'gone', components: { Identity: { name: 'C' } } },
      ],
    };
    const onWarning = vi.fn();
    const scene = deserializeScene(data, { onWarning });
    expect(scene.findByName('A')!.parent?.name).toBe('B');
    expect(scene.findByName('B')!.parent).toBeNull();
    expect(scene.findByName('C')!.parent).toBeNull();
    expect(onWarning).toHaveBeenCalledTimes(2);
  });

  it.each([
    [null, 'scene: expected an object'],
    [{ format: 'other', version: 1, entities: [] }, 'expected format "rowan.scene"'],
    [{ format: SCENE_FORMAT, entities: [] }, 'missing or invalid version'],
    [{ format: SCENE_FORMAT, version: 99, entities: [] }, 'newer version of Rowan'],
    [{ format: SCENE_FORMAT, version: 1 }, 'scene.entities: expected an array'],
    [{ format: SCENE_FORMAT, version: 1, entities: [7] }, 'entities[0]: expected an object'],
    [
      { format: SCENE_FORMAT, version: 1, entities: [{ uuid: '', parent: null, components: {} }] },
      'uuid: expected a non-empty string',
    ],
    [
      { format: SCENE_FORMAT, version: 1, entities: [{ uuid: 'a', parent: 3, components: {} }] },
      'parent: expected a uuid or null',
    ],
    [
      { format: SCENE_FORMAT, version: 1, entities: [{ uuid: 'a', parent: null }] },
      'components: expected an object',
    ],
    [
      {
        format: SCENE_FORMAT,
        version: 1,
        entities: [{ uuid: 'a', parent: null, components: { Transform: 1 } }],
      },
      'components.Transform: expected an object',
    ],
    [
      {
        format: SCENE_FORMAT,
        version: 1,
        entities: [
          { uuid: 'a', parent: null, components: {} },
          { uuid: 'a', parent: null, components: {} },
        ],
      },
      'duplicate uuid "a"',
    ],
    [
      {
        format: SCENE_FORMAT,
        version: 1,
        entities: [{ uuid: 'a', parent: null, components: { Transform: { rotation: 'x' } } }],
      },
      'entities[0].components.Transform.rotation: expected a finite number',
    ],
  ])('rejects malformed scene data %#', (data, message) => {
    expect(() => deserializeScene(data)).toThrow(message);
  });

  it('names a scene without a name "Untitled"', () => {
    expect(deserializeScene({ format: SCENE_FORMAT, version: 1, entities: [] }).name).toBe(
      'Untitled',
    );
  });
});

describe('prefabs', () => {
  it('captures a subtree with the root detached from its parent', () => {
    const scene = createFullScene();
    const prefab = createPrefab(scene.findByName('Player')!);
    expect(prefab.format).toBe(PREFAB_FORMAT);
    expect(prefab.name).toBe('Player');
    expect(prefab.entities).toHaveLength(2);
    expect(prefab.entities[0]!.parent).toBeNull();
    expect(prefab.entities[1]!.parent).toBe(prefab.entities[0]!.uuid);
  });

  it('instantiates copies with fresh uuids', () => {
    const scene = createFullScene();
    const original = scene.findByName('Player')!;
    const prefab = createPrefab(original);
    const first = instantiatePrefab(scene, prefab);
    const second = instantiatePrefab(scene, JSON.parse(JSON.stringify(prefab)));

    expect(new Set([original.uuid, first.uuid, second.uuid]).size).toBe(3);
    expect(first.children).toHaveLength(1);
    expect(first.children[0]!.uuid).not.toBe(original.children[0]!.uuid);
    expect(first.requireComponent(BoxCollider2D).size.toArray()).toEqual([2, 1]);
    expect(scene.entityCount).toBe(7);
  });

  it('applies the parent, name, position and rotation options', () => {
    const scene = new Scene();
    const parent = scene.createEntity('Parent');
    parent.transform.position.set(10, 0);
    const source = scene.createEntity('Bullet');
    const prefab = createPrefab(source);

    const copy = instantiatePrefab(scene, prefab, {
      parent,
      name: 'Shot',
      position: new Vec2(12, 3),
      rotation: 1.5,
    });
    expect(copy.parent).toBe(parent);
    expect(copy.name).toBe('Shot');
    expect(copy.transform.position.toArray()).toEqual([2, 3]);
    expect(copy.worldRotation).toBeCloseTo(1.5);
  });

  it.each([
    [{ format: PREFAB_FORMAT, version: 1, entities: [] }, 'at least one entity'],
    [
      { format: PREFAB_FORMAT, version: 1, entities: [{ uuid: 'a', parent: 'b', components: {} }] },
      'first entity must be the root',
    ],
    [{ format: SCENE_FORMAT, version: 1, entities: [] }, 'expected format "rowan.prefab"'],
  ])('rejects malformed prefab data %#', (data, message) => {
    expect(() => instantiatePrefab(new Scene(), data)).toThrow(message);
  });

  it('duplicates an entity next to the original with a unique name', () => {
    const scene = new Scene();
    const parent = scene.createEntity('Parent');
    const crate = scene.createEntity('Crate', { parent });
    crate.transform.position.set(3, 4);
    scene.createEntity('Lid', { parent: crate });
    scene.createEntity('Barrel', { parent });

    const copy = duplicateEntity(crate);
    const again = duplicateEntity(copy);
    expect(parent.children.map((child) => child.name)).toEqual([
      'Crate',
      'Crate (1)',
      'Crate (2)',
      'Barrel',
    ]);
    expect(copy.transform.position.toArray()).toEqual([3, 4]);
    expect(copy.children.map((child) => child.name)).toEqual(['Lid']);
    expect(again.uuid).not.toBe(copy.uuid);
  });

  it('duplicates root entities', () => {
    const scene = new Scene();
    const root = scene.createEntity('Root');
    scene.createEntity('Other');
    duplicateEntity(root);
    expect(scene.rootEntities.map((entity) => entity.name)).toEqual(['Root', 'Root (1)', 'Other']);
  });

  it('makes names unique by counting up', () => {
    expect(makeUniqueName('Crate', [])).toBe('Crate');
    expect(makeUniqueName('Crate', ['Crate'])).toBe('Crate (1)');
    expect(makeUniqueName('Crate (1)', ['Crate', 'Crate (1)', 'Crate (2)'])).toBe('Crate (3)');
  });
});
