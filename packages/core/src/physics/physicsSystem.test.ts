import { describe, expect, it } from 'vitest';
import { Vec2 } from '../math/vec2';
import { BoxCollider2D, CircleCollider2D, Rigidbody2D } from '../scene/components';
import type { Entity } from '../scene/entity';
import { Scene } from '../scene/scene';
import { Physics2D, PhysicsSystem, type ContactEvent } from './physicsSystem';

const STEP = 1 / 60;

interface World {
  scene: Scene;
  physics: PhysicsSystem;
  /** Steps the simulation and returns every contact event that occurred. */
  simulate(seconds: number): ContactEvent[];
}

function createWorld(gravity = new Vec2(0, -10)): World {
  const scene = new Scene();
  const physics = new PhysicsSystem(scene, gravity);
  physics.start();
  return {
    scene,
    physics,
    simulate(seconds) {
      const events: ContactEvent[] = [];
      for (let time = 0; time < seconds; time += STEP) {
        events.push(...physics.step(STEP));
      }
      return events;
    },
  };
}

function addBox(scene: Scene, name: string, x: number, y: number, dynamic: boolean): Entity {
  const entity = scene.createEntity(name);
  entity.transform.position.set(x, y);
  if (dynamic) {
    entity.addComponent(Rigidbody2D);
  }
  entity.addComponent(BoxCollider2D);
  return entity;
}

function addGround(scene: Scene): Entity {
  const ground = scene.createEntity('Ground');
  ground.addComponent(BoxCollider2D, { size: new Vec2(20, 1) });
  return ground;
}

const kinds = (events: ContactEvent[], entity: Entity): string[] =>
  events.filter((event) => event.entity === entity).map((event) => event.kind);

describe('PhysicsSystem simulation', () => {
  it('makes dynamic bodies fall under gravity', () => {
    const { scene, simulate } = createWorld();
    const box = addBox(scene, 'Box', 0, 10, true);
    simulate(1);
    // Free fall for one second covers about half of g; damping and stepping cost a little.
    expect(box.transform.position.y).toBeLessThan(5.5);
    expect(box.transform.position.y).toBeGreaterThan(4);
    expect(box.transform.position.x).toBe(0);
  });

  it('leaves bodies alone when gravity is zero or scaled away', () => {
    const { scene, simulate } = createWorld();
    const floating = addBox(scene, 'Floating', 0, 10, true);
    floating.requireComponent(Rigidbody2D).gravityScale = 0;
    simulate(0.5);
    expect(floating.transform.position.y).toBe(10);
  });

  it('rests dynamic bodies on static colliders', () => {
    const { scene, simulate } = createWorld();
    addGround(scene);
    const box = addBox(scene, 'Box', 0, 3, true);
    simulate(3);
    // Ground top is at 0.5 and the box is one unit tall.
    expect(box.transform.position.y).toBeCloseTo(1, 1);
  });

  it('does not move static or collider-only entities', () => {
    const { scene, simulate } = createWorld();
    const ground = addGround(scene);
    const staticBody = addBox(scene, 'Static', 5, 5, false);
    staticBody.addComponent(Rigidbody2D, { bodyType: 'static' });
    simulate(0.5);
    expect(ground.transform.position.toArray()).toEqual([0, 0]);
    expect(staticBody.transform.position.toArray()).toEqual([5, 5]);
  });

  it('moves kinematic bodies by their velocity, ignoring gravity', () => {
    const { scene, physics, simulate } = createWorld();
    const platform = addBox(scene, 'Platform', 0, 0, false);
    platform.addComponent(Rigidbody2D, { bodyType: 'kinematic' });
    physics.setLinearVelocity(platform, new Vec2(2, 0));
    simulate(1);
    expect(platform.transform.position.x).toBeCloseTo(2, 1);
    expect(platform.transform.position.y).toBe(0);
  });

  it('bounces according to restitution', () => {
    const { scene, simulate } = createWorld();
    addGround(scene);
    const ball = scene.createEntity('Ball');
    ball.transform.position.set(0, 5);
    ball.addComponent(Rigidbody2D);
    ball.addComponent(CircleCollider2D, { restitution: 0.9 });
    let lowest = Infinity;
    let reboundPeak = -Infinity;
    for (let step = 0; step < 240; step++) {
      simulate(STEP);
      const y = ball.transform.position.y;
      if (y < lowest) {
        lowest = y;
        reboundPeak = -Infinity;
      }
      reboundPeak = Math.max(reboundPeak, y);
    }
    expect(lowest).toBeCloseTo(1, 1);
    expect(reboundPeak).toBeGreaterThan(3);
  });

  it('honours fixed rotation', () => {
    const { scene, physics, simulate } = createWorld(new Vec2());
    const free = addBox(scene, 'Free', 0, 0, true);
    const locked = addBox(scene, 'Locked', 5, 0, true);
    locked.requireComponent(Rigidbody2D).fixedRotation = true;
    physics.applyTorque(free, 50);
    physics.applyTorque(locked, 50);
    simulate(0.5);
    expect(Math.abs(free.transform.rotation)).toBeGreaterThan(0.1);
    expect(locked.transform.rotation).toBe(0);
  });

  it('writes world positions back through a transformed parent', () => {
    const { scene, simulate } = createWorld();
    const parent = scene.createEntity('Parent');
    parent.transform.position.set(100, 0);
    parent.transform.scale.set(2, 2);
    const child = addBox(scene, 'Child', 0, 0, true);
    child.setParent(parent, false);
    child.transform.position.set(1, 5);

    simulate(0.5);
    expect(child.worldPosition.x).toBeCloseTo(102);
    expect(child.worldPosition.y).toBeLessThan(10);
    expect(child.transform.position.x).toBeCloseTo(1);
  });
});

describe('PhysicsSystem synchronization', () => {
  it('creates bodies for entities added while running and removes them again', () => {
    const { scene, physics, simulate } = createWorld();
    expect(physics.bodyCount).toBe(0);
    const box = addBox(scene, 'Box', 0, 0, true);
    expect(physics.hasBody(box)).toBe(true);
    simulate(STEP);
    expect(physics.bodyCount).toBe(1);

    box.removeComponent(Rigidbody2D);
    box.removeComponent(BoxCollider2D);
    simulate(STEP);
    expect(physics.bodyCount).toBe(0);
    expect(physics.hasBody(box)).toBe(false);
  });

  it('removes the body as soon as its entity is destroyed', () => {
    const { scene, physics, simulate } = createWorld();
    const box = addBox(scene, 'Box', 0, 0, true);
    simulate(STEP);
    box.destroy();
    expect(physics.bodyCount).toBe(0);
    expect(physics.hasBody(box)).toBe(false);
  });

  it('teleports the body when game code moves the transform', () => {
    const { scene, simulate } = createWorld(new Vec2());
    const box = addBox(scene, 'Box', 0, 0, true);
    simulate(STEP);
    box.transform.position.set(7, -3);
    box.transform.rotation = 1;
    simulate(STEP);
    expect(box.transform.position.toArray()).toEqual([7, -3]);
    expect(box.transform.rotation).toBe(1);
  });

  it('follows changes to rigidbody settings', () => {
    const { scene, simulate } = createWorld();
    const box = addBox(scene, 'Box', 0, 0, true);
    const body = box.requireComponent(Rigidbody2D);
    body.bodyType = 'static';
    simulate(0.2);
    expect(box.transform.position.y).toBe(0);

    body.bodyType = 'dynamic';
    body.gravityScale = -1;
    simulate(0.2);
    expect(box.transform.position.y).toBeGreaterThan(0);
  });

  it('applies damping and continuous-collision settings', () => {
    const { scene, physics, simulate } = createWorld(new Vec2());
    const damped = addBox(scene, 'Damped', 0, 0, true);
    const free = addBox(scene, 'Free', 0, 5, true);
    Object.assign(damped.requireComponent(Rigidbody2D), {
      linearDamping: 5,
      angularDamping: 5,
      continuous: true,
    });
    physics.setLinearVelocity(damped, new Vec2(10, 0));
    physics.setLinearVelocity(free, new Vec2(10, 0));
    simulate(1);
    expect(damped.transform.position.x).toBeLessThan(free.transform.position.x / 2);
  });

  it('rebuilds a collider when its shape or the entity scale changes', () => {
    const { scene, physics, simulate } = createWorld(new Vec2());
    const wall = addBox(scene, 'Wall', 0, 0, false);
    simulate(STEP);
    const above = new Vec2(0, 2);
    expect(physics.overlapPoint(above)).toEqual([]);

    wall.requireComponent(BoxCollider2D).size.set(1, 5);
    simulate(STEP);
    expect(physics.overlapPoint(above)).toEqual([wall]);

    wall.requireComponent(BoxCollider2D).size.set(1, 1);
    wall.transform.scale.set(1, 6);
    simulate(STEP);
    expect(physics.overlapPoint(above)).toEqual([wall]);

    wall.requireComponent(BoxCollider2D).offset.set(10, 0);
    simulate(STEP);
    expect(physics.overlapPoint(above)).toEqual([]);
    expect(physics.overlapPoint(new Vec2(10, 0))).toEqual([wall]);
  });

  it('scales circles by the larger axis and removes colliders that are taken away', () => {
    const { scene, physics, simulate } = createWorld(new Vec2());
    const disc = scene.createEntity('Disc');
    disc.transform.scale.set(1, 4);
    disc.addComponent(CircleCollider2D, { radius: 0.5 });
    simulate(STEP);
    expect(physics.overlapPoint(new Vec2(1.9, 0))).toEqual([disc]);

    disc.addComponent(BoxCollider2D);
    disc.removeComponent(CircleCollider2D);
    simulate(STEP);
    expect(physics.overlapPoint(new Vec2(1.9, 0))).toEqual([]);
    expect(physics.overlapPoint(new Vec2(0, 1.9))).toEqual([disc]);
  });

  it('skips degenerate shapes instead of failing', () => {
    const { scene, physics, simulate } = createWorld();
    const flat = addBox(scene, 'Flat', 0, 0, true);
    flat.transform.scale.set(0, 1);
    const dot = scene.createEntity('Dot');
    dot.addComponent(CircleCollider2D, { radius: 0 });
    expect(() => simulate(0.1)).not.toThrow();
    expect(physics.overlapPoint(new Vec2())).toEqual([]);
  });

  it('survives non-finite transforms, sizes and negative materials', () => {
    const { scene, physics, simulate } = createWorld();
    addGround(scene);
    const lost = addBox(scene, 'Lost', 0, 5, true);
    const huge = addBox(scene, 'Huge', 5, 5, false);
    const odd = addBox(scene, 'Odd', -5, 2, true);
    Object.assign(odd.requireComponent(BoxCollider2D), {
      density: -3,
      friction: Number.NaN,
      restitution: -1,
    });
    simulate(STEP);

    lost.transform.position.x = Number.NaN;
    huge.transform.scale.x = Infinity;
    expect(() => simulate(1)).not.toThrow();
    // The body keeps simulating from its last valid position.
    expect(Number.isFinite(lost.transform.position.y)).toBe(true);
    // A negative density counts as zero, and the solver gives massless dynamic bodies mass 1.
    expect(physics.getMass(odd)).toBe(1);
    expect(Number.isFinite(odd.transform.position.y)).toBe(true);
  });

  it('takes inactive entities out of the simulation', () => {
    const { scene, simulate } = createWorld();
    const box = addBox(scene, 'Box', 0, 10, true);
    box.active = false;
    simulate(0.5);
    expect(box.transform.position.y).toBe(10);
    box.active = true;
    simulate(0.5);
    expect(box.transform.position.y).toBeLessThan(10);
  });

  it('starts from the bodies that already exist and forgets them on stop', () => {
    const scene = new Scene();
    const box = addBox(scene, 'Box', 0, 0, true);
    const physics = new PhysicsSystem(scene, new Vec2(0, -10));
    physics.start();
    expect(physics.bodyCount).toBe(1);
    expect(physics.overlapPoint(new Vec2())).toEqual([box]);

    physics.stop();
    expect(physics.bodyCount).toBe(0);
    expect(physics.getGravity().toArray()).toEqual([0, -10]);
    box.destroy();
    expect(physics.bodyCount).toBe(0);
  });
});

describe('PhysicsSystem body control', () => {
  it('sets and reads velocities', () => {
    const { scene, physics, simulate } = createWorld(new Vec2());
    const box = addBox(scene, 'Box', 0, 0, true);
    physics.setLinearVelocity(box, new Vec2(3, 4));
    physics.setAngularVelocity(box, 2);
    expect(physics.getLinearVelocity(box).toArray()).toEqual([3, 4]);
    expect(physics.getAngularVelocity(box)).toBe(2);
    simulate(1);
    expect(box.transform.position.x).toBeCloseTo(3, 1);
    expect(box.transform.position.y).toBeCloseTo(4, 1);
    expect(box.transform.rotation).toBeGreaterThan(1.5);
  });

  it('applies forces and impulses according to mass', () => {
    const { scene, physics, simulate } = createWorld(new Vec2());
    const box = addBox(scene, 'Box', 0, 0, true);
    expect(physics.getMass(box)).toBeCloseTo(1);

    physics.applyImpulse(box, new Vec2(5, 0));
    expect(physics.getLinearVelocity(box).x).toBeCloseTo(5);

    physics.setLinearVelocity(box, new Vec2());
    for (let step = 0; step < 60; step++) {
      physics.applyForce(box, new Vec2(0, 2));
      simulate(STEP);
    }
    expect(physics.getLinearVelocity(box).y).toBeCloseTo(2, 1);
  });

  it('controls a body in the same frame its entity was created', () => {
    const { scene, physics, simulate } = createWorld(new Vec2());
    simulate(STEP);
    const bullet = addBox(scene, 'Bullet', 0, 0, true);
    physics.setLinearVelocity(bullet, new Vec2(10, 0));
    simulate(STEP);
    expect(bullet.transform.position.x).toBeGreaterThan(0);
  });

  it('explains what is missing when an entity has no body', () => {
    const { scene, physics } = createWorld();
    const plain = scene.createEntity('Plain');
    expect(() => physics.setLinearVelocity(plain, new Vec2())).toThrow(
      '"Plain" has no physics body. Add a Rigidbody2D or a collider component first.',
    );
    expect(() => physics.getMass(plain)).toThrow('has no physics body');
    plain.destroy();
    expect(() => physics.getLinearVelocity(plain)).toThrow('destroyed entity');
  });

  it('changes gravity and wakes sleeping bodies', () => {
    const { scene, physics, simulate } = createWorld(new Vec2());
    const box = addBox(scene, 'Box', 0, 0, true);
    simulate(2);
    physics.setGravity(new Vec2(0, 5));
    expect(physics.getGravity().toArray()).toEqual([0, 5]);
    simulate(0.5);
    expect(box.transform.position.y).toBeGreaterThan(0);
  });
});

describe('PhysicsSystem queries', () => {
  it('casts rays to the closest solid collider', () => {
    const { scene, physics, simulate } = createWorld(new Vec2());
    const near = addBox(scene, 'Near', 5, 0, false);
    addBox(scene, 'Far', 10, 0, false);
    simulate(STEP);

    const hit = physics.raycast(new Vec2(0, 0), new Vec2(2, 0));
    expect(hit?.entity).toBe(near);
    expect(hit?.distance).toBeCloseTo(4.5);
    expect(hit?.point.equals(new Vec2(4.5, 0), 1e-3)).toBe(true);
    expect(hit?.normal.equals(new Vec2(-1, 0), 1e-3)).toBe(true);
  });

  it('respects the ray length and direction', () => {
    const { scene, physics, simulate } = createWorld(new Vec2());
    addBox(scene, 'Target', 5, 0, false);
    simulate(STEP);
    expect(physics.raycast(new Vec2(), new Vec2(1, 0), 2)).toBeNull();
    expect(physics.raycast(new Vec2(), new Vec2(-1, 0))).toBeNull();
    expect(physics.raycast(new Vec2(), new Vec2(0, 0))).toBeNull();
    expect(physics.raycast(new Vec2(), new Vec2(1, 0), 0)).toBeNull();
    expect(physics.raycast(new Vec2(), new Vec2(1, 0), Infinity)).toBeNull();
  });

  it('ignores triggers unless asked to include them', () => {
    const { scene, physics, simulate } = createWorld(new Vec2());
    const trigger = addBox(scene, 'Trigger', 3, 0, false);
    trigger.requireComponent(BoxCollider2D).isTrigger = true;
    const wall = addBox(scene, 'Wall', 6, 0, false);
    simulate(STEP);
    expect(physics.raycast(new Vec2(), new Vec2(1, 0))?.entity).toBe(wall);
    expect(physics.raycast(new Vec2(), new Vec2(1, 0), 100, true)?.entity).toBe(trigger);
  });

  it('finds every collider containing a point', () => {
    const { scene, physics, simulate } = createWorld(new Vec2());
    const box = addBox(scene, 'Box', 0, 0, false);
    const disc = scene.createEntity('Disc');
    disc.addComponent(CircleCollider2D, { radius: 2, isTrigger: true });
    simulate(STEP);
    expect(new Set(physics.overlapPoint(new Vec2(0.2, 0.2)))).toEqual(new Set([box, disc]));
    expect(physics.overlapPoint(new Vec2(1.5, 0))).toEqual([disc]);
    expect(physics.overlapPoint(new Vec2(9, 9))).toEqual([]);
  });
});

describe('PhysicsSystem contacts', () => {
  it('reports collisions to both entities with opposite normals', () => {
    const { scene, simulate } = createWorld();
    const ground = addGround(scene);
    const box = addBox(scene, 'Box', 0, 2, true);
    const events = simulate(2);

    const boxEnter = events.find(
      (event) => event.entity === box && event.kind === 'collisionEnter',
    );
    const groundEnter = events.find(
      (event) => event.entity === ground && event.kind === 'collisionEnter',
    );
    expect(boxEnter?.other).toBe(ground);
    expect(groundEnter?.other).toBe(box);
    expect(boxEnter?.normal?.y).toBeCloseTo(-1, 1);
    expect(groundEnter?.normal?.y).toBeCloseTo(1, 1);
    expect(boxEnter?.point?.y).toBeCloseTo(0.5, 1);
    expect(kinds(events, box)).toEqual(['collisionEnter']);
  });

  it('reports the end of a collision', () => {
    const { scene, physics, simulate } = createWorld();
    addGround(scene);
    const box = addBox(scene, 'Box', 0, 1.2, true);
    simulate(1);
    physics.setLinearVelocity(box, new Vec2(0, 20));
    const events = simulate(0.5);
    expect(kinds(events, box)).toContain('collisionExit');
    expect(events.find((event) => event.kind === 'collisionExit')?.normal).toBeNull();
  });

  it('reports trigger overlaps without blocking movement', () => {
    const { scene, simulate } = createWorld();
    const zone = scene.createEntity('Zone');
    zone.addComponent(BoxCollider2D, { size: new Vec2(4, 1), isTrigger: true });
    const box = addBox(scene, 'Box', 0, 3, true);
    const events = simulate(2);

    expect(kinds(events, box)).toEqual(['triggerEnter', 'triggerExit']);
    expect(kinds(events, zone)).toEqual(['triggerEnter', 'triggerExit']);
    expect(events[0]!.point).toBeNull();
    expect(box.transform.position.y).toBeLessThan(-5);
  });

  it('does not report contacts that end because an entity was destroyed', () => {
    const { scene, simulate } = createWorld();
    const ground = addGround(scene);
    const box = addBox(scene, 'Box', 0, 1.2, true);
    simulate(1);
    box.destroy();
    const events = simulate(0.1);
    expect(kinds(events, ground)).toEqual([]);
  });
});

describe('Physics2D', () => {
  it('exposes the system to scripts', () => {
    const { scene, physics, simulate } = createWorld(new Vec2());
    const api = new Physics2D(physics);
    const box = addBox(scene, 'Box', 0, 0, true);
    const wall = addBox(scene, 'Wall', 5, 0, false);
    simulate(STEP);

    expect(api.hasBody(box)).toBe(true);
    expect(api.hasBody(scene.createEntity('Plain'))).toBe(false);
    api.gravity = new Vec2(0, -3);
    expect(api.gravity.toArray()).toEqual([0, -3]);
    api.gravity = new Vec2();

    api.setVelocity(box, new Vec2(1, 2));
    expect(api.getVelocity(box).toArray()).toEqual([1, 2]);
    api.setAngularVelocity(box, 3);
    expect(api.getAngularVelocity(box)).toBe(3);
    expect(api.getMass(box)).toBeCloseTo(1);

    api.setVelocity(box, new Vec2());
    api.applyImpulse(box, new Vec2(2, 0));
    expect(api.getVelocity(box).x).toBeCloseTo(2);
    api.applyForce(box, new Vec2(0, 60));
    api.setAngularVelocity(box, 0);
    api.applyTorque(box, 10);
    simulate(STEP);
    expect(api.getVelocity(box).y).toBeCloseTo(1);
    expect(api.getAngularVelocity(box)).toBeGreaterThan(0);

    expect(api.raycast(new Vec2(0, 5), new Vec2(1, 0))).toBeNull();
    expect(api.raycast(new Vec2(2, 0), new Vec2(1, 0), 10)?.entity).toBe(wall);
    expect(api.overlapPoint(new Vec2(5, 0))).toEqual([wall]);
  });
});
