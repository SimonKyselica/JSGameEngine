import { describe, expect, it } from 'vitest';
import { createDefaultSettings, parseSettings } from '../assets/project';
import { Vec2 } from '../math/vec2';
import { BoxCollider2D, Identity, Rigidbody2D } from '../scene/components';
import type { Entity } from '../scene/entity';
import { Scene } from '../scene/scene';
import { deserializeScene, serializeScene } from '../scene/serializer';
import {
  addCollisionLayer,
  CollisionLayers,
  createDefaultLayers,
  layersCollide,
  MAX_COLLISION_LAYERS,
  parseCollisionLayers,
  removeCollisionLayer,
  setLayersCollide,
  type CollisionLayerSettings,
} from './collisionLayers';
import { Physics2D, PhysicsSystem } from './physicsSystem';

const STEP = 1 / 60;

/** Player, enemies and bullets, where bullets pass through the player and through each other. */
function createShooterLayers(): CollisionLayerSettings {
  return {
    layers: ['Default', 'Player', 'Enemy', 'Bullet'],
    ignoredLayerPairs: [
      ['Player', 'Bullet'],
      ['Bullet', 'Bullet'],
    ],
  };
}

describe('collision layer settings', () => {
  it('start out as one layer that collides with itself', () => {
    const settings = createDefaultLayers();
    expect(settings).toEqual({ layers: ['Default'], ignoredLayerPairs: [] });
    expect(layersCollide(settings, 'Default', 'Default')).toBe(true);
  });

  it('always have the default layer first, and each name once', () => {
    expect(
      parseCollisionLayers(['Enemy', ' Player ', 'Default', 'Enemy', '', 7], []).layers,
    ).toEqual(['Default', 'Enemy', 'Player']);
    expect(parseCollisionLayers('nonsense', null)).toEqual(createDefaultLayers());
  });

  it('keep no more layers than the simulation has room for', () => {
    const many = Array.from({ length: 40 }, (_, index) => `Layer ${index}`);
    const { layers } = parseCollisionLayers(many, []);
    expect(layers).toHaveLength(MAX_COLLISION_LAYERS);
    expect(layers.at(-1)).toBe('Layer 14');
  });

  it('drop pairs that are malformed, repeated or name a layer that does not exist', () => {
    const { ignoredLayerPairs } = parseCollisionLayers(
      ['Player', 'Bullet'],
      [
        ['Player', 'Bullet'],
        ['Bullet', 'Player'],
        ['Player', 'Ghost'],
        ['Player'],
        'Bullet',
        [1, 2],
      ],
    );
    expect(ignoredLayerPairs).toEqual([['Player', 'Bullet']]);
  });

  it('are read from a project and default to one layer in older projects', () => {
    const settings = parseSettings({
      physics: { layers: ['Player', 'Bullet'], ignoredLayerPairs: [['Bullet', 'Player']] },
    });
    expect(settings.physics.layers).toEqual(['Default', 'Player', 'Bullet']);
    expect(settings.physics.ignoredLayerPairs).toEqual([['Bullet', 'Player']]);

    const old = parseSettings({ physics: { gravity: [0, -5] } });
    expect(old.physics.layers).toEqual(['Default']);
    expect(old.physics.gravity).toEqual([0, -5]);
    expect(createDefaultSettings().physics.layers).toEqual(['Default']);
  });

  it('gain a layer unless its name is empty or taken, or sixteen are in use', () => {
    const settings = createDefaultLayers();
    expect(addCollisionLayer(settings, '  Player ')).toBe(true);
    expect(addCollisionLayer(settings, 'Player')).toBe(false);
    expect(addCollisionLayer(settings, '   ')).toBe(false);
    expect(addCollisionLayer(settings, 'Default')).toBe(false);
    expect(settings.layers).toEqual(['Default', 'Player']);

    for (let index = 0; index < 20; index++) {
      addCollisionLayer(settings, `Layer ${index}`);
    }
    expect(settings.layers).toHaveLength(MAX_COLLISION_LAYERS);
  });

  it('lose a layer together with its pairs, but never the default layer', () => {
    const settings = createShooterLayers();
    expect(removeCollisionLayer(settings, 'Bullet')).toBe(true);
    expect(settings).toEqual({ layers: ['Default', 'Player', 'Enemy'], ignoredLayerPairs: [] });
    expect(removeCollisionLayer(settings, 'Default')).toBe(false);
    expect(removeCollisionLayer(settings, 'Ghost')).toBe(false);
    expect(settings.layers).toEqual(['Default', 'Player', 'Enemy']);
  });

  it('answer and change whether two layers collide, in either order', () => {
    const settings = createShooterLayers();
    expect(layersCollide(settings, 'Bullet', 'Player')).toBe(false);
    expect(layersCollide(settings, 'Player', 'Bullet')).toBe(false);
    expect(layersCollide(settings, 'Enemy', 'Bullet')).toBe(true);
    // A layer nobody has heard of collides with everything.
    expect(layersCollide(settings, 'Ghost', 'Player')).toBe(true);

    setLayersCollide(settings, 'Bullet', 'Player', true);
    expect(settings.ignoredLayerPairs).toEqual([['Bullet', 'Bullet']]);
    setLayersCollide(settings, 'Enemy', 'Enemy', false);
    setLayersCollide(settings, 'Enemy', 'Enemy', false);
    expect(settings.ignoredLayerPairs).toEqual([
      ['Bullet', 'Bullet'],
      ['Enemy', 'Enemy'],
    ]);
  });
});

describe('CollisionLayers', () => {
  it('gives every layer a bit of its own and the bits of the layers it collides with', () => {
    const layers = new CollisionLayers(createShooterLayers());
    expect(
      ['Default', 'Player', 'Enemy', 'Bullet'].map((name) => layers.getCategory(name)),
    ).toEqual([1, 2, 4, 8]);
    expect(layers.getMask('Default')).toBe(0b1111);
    expect(layers.getMask('Player')).toBe(0b0111);
    expect(layers.getMask('Enemy')).toBe(0b1111);
    expect(layers.getMask('Bullet')).toBe(0b0101);
  });

  it('treats a name that is not a layer as the default layer', () => {
    const layers = new CollisionLayers(createShooterLayers());
    expect(layers.getCategory('Ghost')).toBe(1);
    expect(layers.getMask('Ghost')).toBe(layers.getMask('Default'));
    expect(new CollisionLayers().getMask('Anything')).toBe(1);
  });
});

describe('collision layers in the simulation', () => {
  function createWorld(): {
    scene: Scene;
    physics: PhysicsSystem;
    simulate: (seconds: number) => void;
    add: (name: string, layer: string, x: number, y: number, dynamic: boolean) => Entity;
  } {
    const scene = new Scene();
    const physics = new PhysicsSystem(
      scene,
      new Vec2(0, -10),
      new CollisionLayers(createShooterLayers()),
    );
    physics.start();
    return {
      scene,
      physics,
      simulate(seconds) {
        for (let time = 0; time < seconds; time += STEP) {
          physics.step(STEP);
        }
      },
      add(name, layer, x, y, dynamic) {
        const entity = scene.createEntity(name);
        entity.layer = layer;
        entity.transform.position.set(x, y);
        if (dynamic) {
          entity.addComponent(Rigidbody2D);
        }
        entity.addComponent(BoxCollider2D, { size: new Vec2(dynamic ? 1 : 20, 1) });
        return entity;
      },
    };
  }

  it('lets bodies on layers that ignore each other pass through one another', () => {
    const { add, simulate } = createWorld();
    add('Player Platform', 'Player', 0, 0, false);
    const bullet = add('Bullet', 'Bullet', 0, 3, true);
    const enemy = add('Enemy', 'Enemy', 5, 3, true);
    simulate(2);
    // The enemy lands on the platform; the bullet falls straight through it.
    expect(enemy.transform.position.y).toBeCloseTo(1, 1);
    expect(bullet.transform.position.y).toBeLessThan(-5);
  });

  it('lets bodies of a layer that ignores itself pass through their own kind', () => {
    const { add, simulate, scene } = createWorld();
    add('Floor', 'Default', 0, 0, false);
    const lower = add('Lower', 'Bullet', 0, 1, true);
    const upper = add('Upper', 'Bullet', 0, 4, true);
    simulate(2);
    // Both come to rest on the floor, in the same place, instead of stacking.
    expect(lower.transform.position.y).toBeCloseTo(1, 1);
    expect(upper.transform.position.y).toBeCloseTo(1, 1);
    expect(scene.entityCount).toBe(3);
  });

  it('follows an entity that a script moves to another layer', () => {
    const { add, simulate } = createWorld();
    add('Player Platform', 'Player', 0, 0, false);
    const box = add('Box', 'Enemy', 0, 3, true);
    simulate(2);
    expect(box.transform.position.y).toBeCloseTo(1, 1);

    box.layer = 'Bullet';
    simulate(1);
    expect(box.transform.position.y).toBeLessThan(0);
  });

  it('keeps triggers quiet about layers they ignore', () => {
    const { add, scene, physics } = createWorld();
    const zone = add('Zone', 'Player', 0, 0, false);
    zone.requireComponent(BoxCollider2D).isTrigger = true;
    add('Bullet', 'Bullet', 0, 0.2, true);
    add('Enemy', 'Enemy', 3, 0.2, true);
    const entered: string[] = [];
    for (let step = 0; step < 10; step++) {
      for (const event of physics.step(STEP)) {
        if (event.kind === 'triggerEnter' && event.entity === zone) {
          entered.push(event.other.name);
        }
      }
    }
    expect(entered).toEqual(['Enemy']);
    expect(scene.findByName('Bullet')).not.toBeNull();
  });

  it('still finds every layer with a raycast or an overlap query', () => {
    const { add, physics } = createWorld();
    const bullet = add('Bullet', 'Bullet', 0, 0, false);
    physics.step(STEP);
    const queries = new Physics2D(physics);
    expect(queries.raycast(new Vec2(0, 5), new Vec2(0, -1))?.entity).toBe(bullet);
    expect(queries.overlapPoint(new Vec2(0, 0))).toEqual([bullet]);
  });

  it('puts an entity whose layer the project does not have on the default layer', () => {
    const { add, simulate } = createWorld();
    add('Floor', 'Default', 0, 0, false);
    const stray = add('Stray', 'No Such Layer', 0, 3, true);
    simulate(2);
    expect(stray.transform.position.y).toBeCloseTo(1, 1);
  });
});

describe('the layer of an entity', () => {
  it('is Default until it is set, and is saved with the scene', () => {
    const scene = new Scene();
    const entity = scene.createEntity('Bullet');
    expect(entity.layer).toBe('Default');
    entity.layer = 'Bullet';
    expect(entity.requireComponent(Identity).layer).toBe('Bullet');

    const copy = deserializeScene(serializeScene(scene));
    expect(copy.findByName('Bullet')!.layer).toBe('Bullet');
  });

  it('is Default in scenes that were saved before there were layers', () => {
    const data = serializeScene(new Scene());
    data.entities.push({
      uuid: 'old',
      parent: null,
      components: { Identity: { name: 'Old', tag: '', active: true } },
    });
    expect(deserializeScene(data).findByName('Old')!.layer).toBe('Default');
  });
});
